const axios = require('axios');
const {
  SPEC_FILE,
  getProviderProfiles,
  getModelRuntimeConfig,
  saveModelRuntimeConfig
} = require('./llm-config');
// Remove this line - we'll get ollamaService from main.js

/**
 * Strip TOOL:name{...} patterns from text (handles nested JSON braces)
 */
function stripToolPatterns(text) {
  if (!text) return '';
  let result = '';
  let i = 0;

  while (i < text.length) {
    // Check for TOOL: pattern
    const toolMatch = text.slice(i).match(/^TOOL:\w+\{/);
    if (toolMatch) {
      // Found TOOL:name{ — now find the matching closing brace
      const braceStart = i + toolMatch[0].length - 1;
      let depth = 1;
      let j = braceStart + 1;
      let inString = false;
      let escapeNext = false;

      while (j < text.length && depth > 0) {
        const char = text[j];
        if (escapeNext) { escapeNext = false; j++; continue; }
        if (char === '\\') { escapeNext = true; j++; continue; }
        if (char === '"') { inString = !inString; j++; continue; }
        if (!inString) {
          if (char === '{') depth++;
          else if (char === '}') depth--;
        }
        j++;
      }
      // Skip the entire TOOL:name{...} block
      i = j;
    } else {
      result += text[i];
      i++;
    }
  }

  return result.trim();
}

function stripReasoningBlocks(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function buildAssistantContent(response, runtimeConfig = {}) {
  const reasoning = String(response?.reasoning || '').trim();
  const content = String(response?.content || '').trim();
  const visibility = runtimeConfig?.reasoning?.visibility || 'show';

  if (!reasoning || visibility === 'hide') {
    return content;
  }

  return `<think>${reasoning}</think>\n\n${content}`.trim();
}

module.exports = function setupIpcHandlers(ipcMain, db, aiService, mcpServer, mainWindow, ollamaService, chainController, workflowManager, vectorStore, capabilityManager, portListenerManager, agentMemory, promptFileManager, agentLoop, connectorRuntime, dispatcher, agentManager, eventBus, memoryDaemon, workflowScheduler, sessionInitManager) {
  const USER_IDLE_DEBOUNCE_MS = 20 * 1000;
  let activeUserRequests = 0;
  let userIdleTimer = null;

  function markUserActive(sessionId = null) {
    if (!eventBus) return;

    if (userIdleTimer) {
      clearTimeout(userIdleTimer);
      userIdleTimer = null;
    }

    activeUserRequests += 1;
    if (activeUserRequests === 1) {
      eventBus.publish('chat:user-active', { sessionId });
    }
  }

  function markUserIdle(sessionId = null) {
    if (!eventBus) return;

    activeUserRequests = Math.max(0, activeUserRequests - 1);
    if (activeUserRequests > 0) {
      return;
    }

    if (userIdleTimer) {
      clearTimeout(userIdleTimer);
    }

    userIdleTimer = setTimeout(() => {
      if (activeUserRequests === 0) {
        eventBus.publish('chat:user-idle', { sessionId });
      }
    }, USER_IDLE_DEBOUNCE_MS);
  }

  async function syncDaemonEnabledSetting() {
    const enabled = Boolean((memoryDaemon && memoryDaemon.running) || (workflowScheduler && workflowScheduler.running));
    await db.saveSetting('baseinit.daemonEnabled', enabled ? 'true' : 'false');
  }

  // Provider model selection handlers — all go through aiService adapters now
  ipcMain.handle('getProviderModels', async (event, provider) => {
    try {
      const models = await aiService.getModels(provider);
      return { status: 'success', models };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  });

  ipcMain.handle('checkProviderStatus', async (event, provider) => {
    try {
      const models = await aiService.getModels(provider);
      return { connected: models.length > 0 };
    } catch (error) {
      return { connected: false };
    }
  });

  ipcMain.handle('setActiveModel', async (event, provider, model) => {
    await db.setActiveModel(provider, model);
    return { success: true };
  });

  ipcMain.handle('llm:get-models', async (event, provider, forceRefresh = false) => {
    console.log('llm:get-models called with provider:', provider, 'forceRefresh:', forceRefresh);
    try {
      const models = await aiService.getModels(provider.toLowerCase(), forceRefresh);
      console.log(`Models from ${provider}:`, models);
      return models;
    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
      return [];
    }
  });
  ipcMain.handle('llm:save-config', async (event, config) => {
    try {
      console.log('Saving config:', config);
      await db.saveSetting('llm.provider', config.provider);

      // Always save model if provided (required for Qwen OAuth)
      if (config.model) {
        await db.saveSetting('llm.model', config.model);

        // Save model type (local or cloud) for Ollama provider
        if (config.provider === 'ollama') {
          const isCloudModel = config.model.includes('-cloud');
          await db.saveSetting('llm.modelType', isCloudModel ? 'cloud' : 'local');
        }
      }

      if (config.apiKey) {
        await db.saveSetting(`llm.${config.provider}.apiKey`, config.apiKey);
      }
      if (config.url) {
        await db.saveSetting(`llm.${config.provider}.url`, config.url);
      }

      // Provider-specific mode/auth settings
      if (config.provider === 'qwen') {
        const existingMode = await db.getSetting('llm.qwen.mode');
        const existingUseOAuth = (await db.getSetting('llm.qwen.useOAuth')) === 'true';
        const mode = config.mode || existingMode || 'cli';
        const useOAuth = config.useOAuth !== undefined
          ? config.useOAuth === true
          : (mode === 'oauth' || existingUseOAuth);
        await db.saveSetting('llm.qwen.mode', mode);
        await db.saveSetting('llm.qwen.useOAuth', useOAuth ? 'true' : 'false');
      } else if (config.useOAuth) {
        await db.saveSetting(`llm.${config.provider}.useOAuth`, 'true');
      }

      // Update AI service provider
      await aiService.setProvider(config.provider);

      let resolvedRuntime = null;
      if (config.model) {
        if (config.runtimeConfig) {
          const savedRuntime = await saveModelRuntimeConfig(db, config.provider, config.model, config.runtimeConfig);
          resolvedRuntime = savedRuntime.runtime;
        } else {
          const currentRuntime = await getModelRuntimeConfig(db, config.provider, config.model);
          resolvedRuntime = currentRuntime.runtime;
        }
      }

      if (resolvedRuntime) {
        await db.saveSetting('llm.thinkingMode', resolvedRuntime.reasoning?.enabled ? 'think' : 'off');
        await db.saveSetting('llm.showThinking', resolvedRuntime.reasoning?.visibility === 'hide' ? 'false' : 'true');
        await db.saveSetting('llm.thinkingVisibility', resolvedRuntime.reasoning?.visibility || 'show');
      }

      // Background refresh models for the provider
      aiService.getModels(config.provider)
        .then(models => {
          console.log(`Refreshed ${models.length} models for ${config.provider}`);
        })
        .catch(err => {
          console.error(`Background model refresh failed for ${config.provider}:`, err);
        });

      console.log('Config saved successfully');
      return { success: true, runtimeConfig: resolvedRuntime };
    } catch (error) {
      console.error('Failed to save LLM config:', error);
      throw error;
    }
  });

  ipcMain.handle('llm:fetch-qwen-oauth', async () => {
    try {
      const os = require('os');
      const fs = require('fs');
      const path = require('path');

      const oauthPath = path.join(os.homedir(), '.qwen', 'oauth_creds.json');
      if (fs.existsSync(oauthPath)) {
        const oauthData = fs.readFileSync(oauthPath, 'utf-8');
        const creds = JSON.parse(oauthData);
        console.log('Qwen OAuth file structure:', Object.keys(creds));
        await db.saveSetting('llm.qwen.oauthCreds', JSON.stringify(creds));
        await db.saveSetting('llm.qwen.useOAuth', 'true');
        return creds;
      }
      throw new Error('Qwen OAuth credentials not found at ~/.qwen/oauth_creds.json');
    } catch (error) {
      console.error('Failed to fetch Qwen OAuth:', error);
      throw error;
    }
  });

  ipcMain.handle('llm:get-config', async () => {
    try {
      const provider = await db.getSetting('llm.provider');
      const model = await db.getSetting('llm.model');
      const config = { provider, model };

      if (provider) {
        const apiKey = await db.getSetting(`llm.${provider}.apiKey`);
        const url = await db.getSetting(`llm.${provider}.url`);
        const mode = await db.getSetting(`llm.${provider}.mode`);
        const useOAuth = await db.getSetting(`llm.${provider}.useOAuth`);
        if (apiKey) config.apiKey = apiKey;
        if (url) config.url = url;
        if (mode) config.mode = mode;
        if (useOAuth === 'true') config.useOAuth = true;
      }

      if (provider && model) {
        const { spec, runtime } = await getModelRuntimeConfig(db, provider, model);
        config.runtimeConfig = runtime;
        config.modelSpec = spec;
      }

      return config;
    } catch (error) {
      console.error('Failed to get LLM config:', error);
      return {};
    }
  });

  ipcMain.handle('llm:get-provider-profiles', async () => {
    return {
      specFile: SPEC_FILE,
      providers: getProviderProfiles()
    };
  });

  ipcMain.handle('llm:get-model-profile', async (event, provider, model) => {
    if (!provider || !model) {
      return null;
    }

    const { spec, runtime } = await getModelRuntimeConfig(db, provider, model);
    return {
      specFile: SPEC_FILE,
      spec,
      runtimeConfig: runtime
    };
  });


  // Database operations
  ipcMain.handle('get-calendar-events', async () => {
    return await db.getCalendarEvents();
  });

  ipcMain.handle('add-calendar-event', async (event, calendarEvent) => {
    const result = await db.addCalendarEvent(calendarEvent);
    mainWindow.webContents.send('calendar-update');
    return result;
  });

  ipcMain.handle('update-calendar-event', async (event, id, calendarEvent) => {
    const result = await db.updateCalendarEvent(id, calendarEvent);
    mainWindow.webContents.send('calendar-update');
    return result;
  });

  ipcMain.handle('delete-calendar-event', async (event, id) => {
    const result = await db.deleteCalendarEvent(id);
    mainWindow.webContents.send('calendar-update');
    return result;
  });

  ipcMain.handle('get-todos', async () => {
    return await db.getTodos();
  });

  ipcMain.handle('add-todo', async (event, todo) => {
    const result = await db.addTodo(todo);
    mainWindow.webContents.send('todo-update');
    return result;
  });

  ipcMain.handle('update-todo', async (event, id, todo) => {
    const result = await db.updateTodo(id, todo);
    mainWindow.webContents.send('todo-update');
    return result;
  });

  ipcMain.handle('delete-todo', async (event, id) => {
    const result = await db.deleteTodo(id);
    mainWindow.webContents.send('todo-update');
    return result;
  });

  ipcMain.handle('get-conversations', async (event, limit = 100, sessionId = null) => {
    return await db.getConversations(limit, sessionId);
  });

  ipcMain.handle('add-conversation', async (event, message) => {
    const result = await db.addConversation(message);
    mainWindow.webContents.send('conversation-update');
    return result;
  });

  ipcMain.handle('clear-conversations', async () => {
    try {
      // Create new session
      const newSession = await db.createChatSession();
      // Set it as current
      await db.setCurrentSession(newSession.id);
      mainWindow.webContents.send('conversation-update');
      return { cleared: true, sessionId: newSession.id };
    } catch (error) {
      console.error('Error clearing conversations:', error);
      throw error;
    }
  });

  // Prompt Rules operations (with file sync)
  ipcMain.handle('get-prompt-rules', async () => {
    return await db.getPromptRules();
  });

  ipcMain.handle('get-active-prompt-rules', async () => {
    return await db.getActivePromptRules();
  });

  ipcMain.handle('add-prompt-rule', async (event, rule) => {
    const result = await db.addPromptRule(rule);
    // Sync to files
    if (promptFileManager) {
      await promptFileManager.syncToFiles();
    }
    return result;
  });

  ipcMain.handle('update-prompt-rule', async (event, id, rule) => {
    const result = await db.updatePromptRule(id, rule);
    // Sync to files
    if (promptFileManager) {
      await promptFileManager.syncToFiles();
    }
    return result;
  });

  ipcMain.handle('toggle-prompt-rule', async (event, id, active) => {
    const result = await db.togglePromptRule(id, active);
    // Sync to files
    if (promptFileManager) {
      await promptFileManager.syncToFiles();
    }
    return result;
  });

  ipcMain.handle('delete-prompt-rule', async (event, id) => {
    const result = await db.deletePromptRule(id);
    // Sync to files
    if (promptFileManager) {
      await promptFileManager.syncToFiles();
    }
    return result;
  });

  // Chat Sessions operations
  ipcMain.handle('save-setting', async (event, key, value) => {
    return await db.saveSetting(key, value);
  });

  ipcMain.handle('create-chat-session', async () => {
    return await db.createChatSession();
  });

  ipcMain.handle('get-chat-sessions', async (event, date = null, limit = 6) => {
    return await db.getChatSessions(date, limit);
  });

  ipcMain.handle('load-chat-session', async (event, sessionId) => {
    return await db.loadChatSession(sessionId);
  });

  ipcMain.handle('switch-chat-session', async (event, sessionId) => {
    try {
      // Trigger agent loop close for the previous session
      if (agentLoop) {
        const prevSession = await db.getCurrentSession();
        if (prevSession && prevSession.id !== sessionId) {
          agentLoop.onSessionClose(prevSession.id).catch(e => console.error('[IPC] Session close error:', e));
        }
      }
      await db.setCurrentSession(sessionId);
      // Set current session in MCP server for automemory tool
      if (mcpServer.setCurrentSessionId) {
        mcpServer.setCurrentSessionId(sessionId);
      }
      return { success: true, sessionId };
    } catch (error) {
      console.error('Error switching session:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-chat-session', async (event, sessionId) => {
    try {
      await db.deleteChatSession(sessionId);
      mainWindow.webContents.send('conversation-update');
      return { success: true };
    } catch (error) {
      console.error('Error deleting chat session:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-all-conversations', async () => {
    try {
      await db.deleteAllConversations();
      mainWindow.webContents.send('conversation-update');
      return { success: true, message: 'All conversations deleted' };
    } catch (error) {
      console.error('Error deleting all conversations:', error);
      throw error;
    }
  });

  // AI operations - with tool chaining support
  ipcMain.handle('send-message', async (event, message, useChaining = true, sessionId = null) => {
    const activitySessionId = sessionId || 'default';
    markUserActive(activitySessionId);

    try {
      // Use explicit sessionId for per-chat isolation
      const conversations = await db.getConversations(20, sessionId);
      // Clean TOOL: patterns from history so model doesn't mimic past tool calls
      const conversationHistory = conversations.map(c => ({
        role: c.role,
        content: c.role === 'assistant'
          ? stripReasoningBlocks(stripToolPatterns(c.content))
          : c.content
      })).filter(c => c.content && c.content.trim().length > 0).reverse();

      // Record activity in agent loop and set current session
      if (agentLoop) {
        agentLoop.recordActivity(activitySessionId);
      }
      if (mcpServer.setCurrentSessionId) {
        mcpServer.setCurrentSessionId(activitySessionId);
      }

      // Record activity for session init tracking
      if (sessionInitManager) {
        sessionInitManager.recordActivity().catch(() => {});
      }

      await db.addConversation({ role: 'user', content: message }, sessionId);

      let response;

      // Check if this session belongs to an agent
      const sessionRow = sessionId ? db.get('SELECT agent_id FROM chat_sessions WHERE id = ?', [sessionId]) : null;
      const agentId = sessionRow ? sessionRow.agent_id : null;

      // Use chain controller if available and enabled
      if (chainController && useChaining) {
        console.log('[IPC] Using tool chain controller');
        response = await chainController.executeWithChaining(message, conversationHistory, { sessionId, agentId });

        if (response && response.needsPermission) {
          mainWindow.webContents.send('tool-permission-request', { ...response.permissionRequest, sessionId });
          return { needsPermission: true, sessionId, ...response.permissionRequest };
        }
      } else {
        // Fallback: route through dispatcher (unified path)
        response = await dispatcher.dispatch(message, conversationHistory, { mode: 'chat', sessionId, agentId });
      }

      // Safety check for null response
      if (!response || !response.content) {
        console.error('[IPC] No response from AI service');
        response = { content: 'Sorry, I was unable to generate a response. Please try again.', model: 'unknown' };
      }

      // Clean any leftover TOOL: patterns from the final response
      const activeProvider = await db.getSetting('llm.provider');
      const activeModel = await db.getSetting('llm.model');
      const { runtime: runtimeConfig } = activeProvider && activeModel
        ? await getModelRuntimeConfig(db, activeProvider, activeModel)
        : { runtime: null };
      const cleanContent = stripToolPatterns(buildAssistantContent(response, runtimeConfig));
      await db.addConversation({ role: 'assistant', content: cleanContent }, sessionId);
      mainWindow.webContents.send('conversation-update', { sessionId });
      return { ...response, content: cleanContent, sessionId };
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    } finally {
      markUserIdle(activitySessionId);
    }
  });

  // Interpret a tool result through the LLM (used by permission flow)
  ipcMain.handle('interpret-tool-result', async (event, toolName, params, toolResult, sessionId = null) => {
    const activitySessionId = sessionId || 'default';
    markUserActive(activitySessionId);

    try {
      const conversations = await db.getConversations(20, sessionId);
      const conversationHistory = conversations.map(c => ({
        role: c.role,
        content: c.role === 'assistant'
          ? stripReasoningBlocks(stripToolPatterns(c.content))
          : c.content
      })).filter(c => c.content && c.content.trim().length > 0).reverse();

      const toolContext = `Tool "${toolName}" was executed with parameters: ${JSON.stringify(params)}\n\nResult: ${JSON.stringify(toolResult, null, 2)}\n\nBased on this tool result, provide a natural, helpful response to the user. Do NOT call any tools.`;

      const response = await dispatcher.dispatch(toolContext, conversationHistory, { mode: 'chat', sessionId });
      const activeProvider = await db.getSetting('llm.provider');
      const activeModel = await db.getSetting('llm.model');
      const { runtime: runtimeConfig } = activeProvider && activeModel
        ? await getModelRuntimeConfig(db, activeProvider, activeModel)
        : { runtime: null };
      const cleanContent = stripToolPatterns(buildAssistantContent(response, runtimeConfig));

      await db.addConversation({ role: 'assistant', content: cleanContent }, sessionId);
      mainWindow.webContents.send('conversation-update', { sessionId });

      return { ...response, content: cleanContent, sessionId };
    } catch (error) {
      console.error('Error interpreting tool result:', error);
      // Fallback: return a basic formatted result
      return {
        content: `Tool ${toolName} returned: ${JSON.stringify(toolResult, null, 2)}`,
        model: 'fallback'
      };
    } finally {
      markUserIdle(activitySessionId);
    }
  });

  // Tool execution
  ipcMain.handle('execute-tool', async (event, toolName, params) => {
    try {
      const result = await mcpServer.executeTool(toolName, params);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Stop generation
  ipcMain.handle('stop-generation', async () => {
    const stopped = aiService.stopGeneration();
    // Also stop chain controller if running
    if (chainController && chainController.stopChain) {
      chainController.stopChain();
    }
    return { stopped };
  });

  // Check if generating
  ipcMain.handle('is-generating', async () => {
    return { generating: aiService.isGenerating };
  });

  ipcMain.handle('get-ai-providers', async () => {
    return aiService.getProviders();
  });

  ipcMain.handle('get-providers', async () => {
    return aiService.getProviders();
  });

  ipcMain.handle('get-models', async (event, provider) => {
    return await aiService.getModels(provider);
  });

  // Model refresh handler (works for any provider)
  ipcMain.handle('qwen:refresh-models', async () => {
    try {
      const models = await aiService.getModels('qwen');
      return { success: true, models };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Test a custom model (Phase 4: Ollama cloud / custom models)
  ipcMain.handle('llm:test-model', async (event, { provider, model }) => {
    try {
      const adapter = aiService.adapters[provider];
      if (!adapter) return { success: false, error: `Unknown provider: ${provider}` };
      const result = await adapter.call(
        [{ role: 'user', content: 'hello' }],
        { model, max_tokens: 10 }
      );
      return { success: true, model: result.model, content: result.content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Thinking mode settings
  ipcMain.handle('llm:set-thinking-mode', async (event, mode) => {
    const provider = await db.getSetting('llm.provider');
    const model = await db.getSetting('llm.model');

    if (provider && model) {
      const profile = await getModelRuntimeConfig(db, provider, model);
      const runtimeConfig = profile.runtime;

      runtimeConfig.reasoning.enabled = mode === 'think';
      const saved = await saveModelRuntimeConfig(db, provider, model, runtimeConfig);
      await db.saveSetting('llm.thinkingMode', saved.runtime.reasoning.enabled ? 'think' : 'off');
      await db.saveSetting('llm.showThinking', saved.runtime.reasoning.visibility === 'hide' ? 'false' : 'true');
      await db.saveSetting('llm.thinkingVisibility', saved.runtime.reasoning.visibility || 'show');
    } else {
      await db.saveSetting('llm.thinkingMode', mode);
    }

    return { success: true, mode };
  });

  ipcMain.handle('llm:get-thinking-mode', async () => {
    const provider = await db.getSetting('llm.provider');
    const model = await db.getSetting('llm.model');

    if (provider && model) {
      const { runtime } = await getModelRuntimeConfig(db, provider, model);
      return {
        mode: runtime.reasoning.enabled ? 'think' : 'off',
        showThinking: runtime.reasoning.visibility !== 'hide',
        visibility: runtime.reasoning.visibility
      };
    }

    const mode = await db.getSetting('llm.thinkingMode') || 'off';
    const show = await db.getSetting('llm.showThinking');
    return { mode, showThinking: show !== 'false', visibility: await db.getSetting('llm.thinkingVisibility') || 'show' };
  });

  ipcMain.handle('llm:set-show-thinking', async (event, show) => {
    const provider = await db.getSetting('llm.provider');
    const model = await db.getSetting('llm.model');

    if (provider && model) {
      const profile = await getModelRuntimeConfig(db, provider, model);
      profile.runtime.reasoning.visibility = show ? 'show' : 'hide';
      const saved = await saveModelRuntimeConfig(db, provider, model, profile.runtime);
      await db.saveSetting('llm.showThinking', saved.runtime.reasoning.visibility === 'hide' ? 'false' : 'true');
      await db.saveSetting('llm.thinkingVisibility', saved.runtime.reasoning.visibility || 'show');
    } else {
      await db.saveSetting('llm.showThinking', show ? 'true' : 'false');
    }

    return { success: true };
  });

  // Qwen API key verification handler
  ipcMain.handle('verify-qwen-key', async (event, apiKey) => {
    if (!apiKey || apiKey.trim() === '') {
      return { success: false, error: 'API key cannot be empty' };
    }

    try {
      const response = await axios.get('https://dashscope.aliyuncs.com/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 seconds timeout
      });

      // Validate response structure
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        return { success: true, modelCount: response.data.data.length };
      }
      return { success: false, error: 'Invalid API response format' };
    } catch (error) {
      let errorMessage = 'API key verification failed';
      if (error.response) {
        // Handle API error responses
        if (error.response.status === 401) {
          errorMessage = 'Invalid API key: Unauthorized';
        } else if (error.response.data && error.response.data.error) {
          errorMessage = `API error: ${error.response.data.error.message || error.response.data.error}`;
        } else {
          errorMessage = `API returned status ${error.response.status}`;
        }
      } else if (error.request) {
        errorMessage = 'No response from Qwen API server';
      } else {
        errorMessage = `Request setup error: ${error.message}`;
      }
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('set-ai-provider', async (event, provider) => {
    await aiService.setProvider(provider);
    return { success: true, provider };
  });

  ipcMain.handle('set-ai-model', async (event, model) => {
    await db.saveSetting('llm.model', model);
    return { success: true };
  });

  ipcMain.handle('set-system-prompt', async (event, prompt) => {
    await aiService.setSystemPrompt(prompt);
    // Sync to file
    if (promptFileManager) {
      await promptFileManager.saveSystemPrompt(prompt, false); // false = already in DB
    }
    return { success: true };
  });

  ipcMain.handle('get-system-prompt', async () => {
    try {
      const prompt = await db.getSetting('system_prompt');
      return prompt || 'You are a helpful AI assistant.';
    } catch (error) {
      console.error('Error getting system prompt:', error);
      return 'You are a helpful AI assistant.';
    }
  });

  // MCP operations
  ipcMain.handle('get-mcp-tools', async () => {
    return mcpServer.getTools();
  });

  ipcMain.handle('get-mcp-tools-documentation', async () => {
    return mcpServer.getToolsDocumentation();
  });

  // Tool Group management
  ipcMain.handle('get-tool-groups', async () => {
    return mcpServer.getToolGroups();
  });

  ipcMain.handle('activate-tool-group', async (event, groupId) => {
    console.log('[IPC] activate-tool-group called with:', groupId);
    try {
      const result = await mcpServer.activateGroup(groupId);
      console.log('[IPC] Group activated successfully:', result);
      return { success: true, ...result };
    } catch (error) {
      console.log('[IPC] Group activation failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('deactivate-tool-group', async (event, groupId) => {
    try {
      const result = await mcpServer.deactivateGroup(groupId);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-active-tools', async () => {
    return mcpServer.getActiveTools();
  });

  ipcMain.handle('execute-mcp-tool', async (event, toolName, params) => {
    try {
      const result = await mcpServer.executeTool(toolName, params);

      // Check if permission is required (custom return from executeTool)
      if (result.needsPermission) {
        // Send permission request to renderer
        mainWindow.webContents.send('tool-permission-request', result);
        return { needsPermission: true, toolName, params };
      }

      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('execute-mcp-tool-once', async (event, toolName, params) => {
    try {
      // Temporarily enable the tool for this execution
      await mcpServer.setToolActiveState(toolName, true);

      // Execute normally
      const result = await mcpServer.executeTool(toolName, params);

      // Check DB for permanent state — if user permanently enabled it, keep it enabled
      const toolStates = await db.getToolStates();
      const isPermanentlyEnabled = toolStates[toolName]?.active !== false;
      if (!isPermanentlyEnabled) {
        // Only revert if not permanently enabled
        await mcpServer.setToolActiveState(toolName, false);
      }

      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Tool activation operations
  ipcMain.handle('get-tool-states', async () => {
    try {
      return await db.getToolStates();
    } catch (error) {
      console.error('Failed to get tool states:', error);
      return {};
    }
  });

  ipcMain.handle('set-tool-active', async (event, toolName, active) => {
    try {
      // Save to DB (persistent)
      await db.setToolActive(toolName, active);
      // Also update in-memory state so chain controller sees it immediately
      if (mcpServer.setToolActiveState) {
        await mcpServer.setToolActiveState(toolName, active);
      }

      // If enabling a tool whose capability group is disabled, auto-enable the group
      if (active && capabilityManager) {
        const groupId = capabilityManager.getGroupForTool(toolName);
        if (groupId && !capabilityManager.isGroupEnabled(groupId)) {
          capabilityManager.setGroupEnabled(groupId, true);
          console.log(`[IPC] Auto-enabled capability group '${groupId}' because tool '${toolName}' was enabled`);
        }
        // Emit updated state to UI so capability panel stays in sync
        mainWindow.webContents.send('capability-update', capabilityManager.getState());
      } else if (!active && capabilityManager) {
        mainWindow.webContents.send('capability-update', capabilityManager.getState());
      }

      console.log(`[IPC] Tool ${toolName} ${active ? 'enabled' : 'disabled'} (DB + memory)`);
      return { success: true, toolName, active };
    } catch (error) {
      console.error('Failed to set tool active state:', error);
      throw error;
    }
  });

  ipcMain.handle('create-custom-tool', async (event, toolData) => {
    try {
      await mcpServer.executeTool('create_tool', toolData);
      // Emit capability-update so UI refreshes with new tool's unsafe-group membership
      if (capabilityManager) {
        mainWindow.webContents.send('capability-update', capabilityManager.getState());
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-custom-tools', async () => {
    try {
      return await db.getCustomTools();
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('delete-custom-tool', async (event, toolName) => {
    try {
      await db.deleteCustomTool(toolName);
      mcpServer.tools.delete(toolName);
      // Clean up from capability manager's safety map
      if (capabilityManager) {
        capabilityManager.customToolSafety.delete(toolName);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ==================== Workflow Management ====================

  // Get all saved workflows
  ipcMain.handle('get-workflows', async () => {
    try {
      if (workflowManager) {
        return await workflowManager.getWorkflows();
      }
      return await db.getWorkflows();
    } catch (error) {
      console.error('[IPC] get-workflows error:', error);
      return [];
    }
  });

  // Save a new workflow (from visual editor or programmatic creation)
  ipcMain.handle('save-workflow', async (event, workflow) => {
    try {
      const result = await workflowManager.captureWorkflow(
        workflow.name || 'unnamed',
        (workflow.tool_chain || []).map(s => ({ tool: s.tool, params: s.params || {} })),
        workflow.name
      );
      mainWindow.webContents.send('workflow-update');
      return { success: true, workflow: result };
    } catch (error) {
      console.error('[IPC] save-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  // Delete a workflow
  ipcMain.handle('delete-workflow', async (event, workflowId) => {
    try {
      await workflowManager.deleteWorkflow(workflowId);
      mainWindow.webContents.send('workflow-update');
      return { success: true };
    } catch (error) {
      console.error('[IPC] delete-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  // Run a workflow (simple — used by visual editor)
  ipcMain.handle('run-workflow', async (event, workflowId) => {
    try {
      const result = await workflowManager.executeWorkflow(workflowId);
      mainWindow.webContents.send('workflow-update');
      return { success: true, ...result };
    } catch (error) {
      console.error('[IPC] run-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  // Execute a workflow with optional parameter overrides
  ipcMain.handle('execute-workflow', async (event, workflowId, paramOverrides = {}) => {
    try {
      const result = await workflowManager.executeWorkflow(workflowId, paramOverrides);
      mainWindow.webContents.send('workflow-update');
      return { success: true, ...result };
    } catch (error) {
      console.error('[IPC] execute-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  // Capture a successful tool chain as a workflow
  ipcMain.handle('capture-workflow', async (event, trigger, toolChain, name = null) => {
    try {
      const result = await workflowManager.captureWorkflow(trigger, toolChain, name);
      mainWindow.webContents.send('workflow-update');
      return { success: true, workflow: result };
    } catch (error) {
      console.error('[IPC] capture-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  // Search workflows by keyword
  ipcMain.handle('search-workflows', async (event, query) => {
    try {
      return await workflowManager.findMatchingWorkflows(query);
    } catch (error) {
      console.error('[IPC] search-workflows error:', error);
      return [];
    }
  });

  // Copy/clone a workflow
  ipcMain.handle('copy-workflow', async (event, workflowId, newName = null) => {
    try {
      const result = await workflowManager.copyWorkflow(workflowId, newName);
      mainWindow.webContents.send('workflow-update');
      return { success: true, workflow: result };
    } catch (error) {
      console.error('[IPC] copy-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  // Update an existing workflow
  ipcMain.handle('update-workflow', async (event, workflowId, data) => {
    try {
      const result = await workflowManager.updateWorkflow(workflowId, data);
      mainWindow.webContents.send('workflow-update');
      return { success: true, workflow: result };
    } catch (error) {
      console.error('[IPC] update-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  // Settings operations
  ipcMain.handle('get-settings', async () => {
    const settings = await db.getAllSettings();
    const apiKeys = {};
    for (const provider of aiService.getProviders()) {
      apiKeys[provider] = await db.getAPIKey(provider);
    }
    return { ...settings, apiKeys };
  });

  ipcMain.handle('update-settings', async (event, settings) => {
    for (const [key, value] of Object.entries(settings)) {
      await db.setSetting(key, value);
    }
    return { success: true };
  });

  // Open a second independent chat window
  ipcMain.handle('open-new-window', async () => {
    const { BrowserWindow } = require('electron');
    const path = require('path');
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      show: false
    });
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
    win.once('ready-to-show', () => win.show());
    return { success: true };
  });

  ipcMain.handle('set-api-key', async (event, provider, key) => {
    await db.setAPIKey(provider, key);
    return { success: true };
  });

  // ==================== Capability Management ====================

  // Get current capability state
  ipcMain.handle('capability:get-state', async () => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    return capabilityManager.getState();
  });

  // Get all groups configuration
  ipcMain.handle('capability:get-groups', async () => {
    if (!capabilityManager) return [];
    return capabilityManager.getGroupsConfig();
  });

  // Set main switch (master toggle)
  ipcMain.handle('capability:set-main', async (event, enabled) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    const result = capabilityManager.setMainEnabled(enabled);
    mainWindow.webContents.send('capability-update', capabilityManager.getState());
    return { success: true, mainEnabled: result };
  });

  // Set group enabled state
  ipcMain.handle('capability:set-group', async (event, groupId, enabled) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    const result = capabilityManager.setGroupEnabled(groupId, enabled);
    mainWindow.webContents.send('capability-update', capabilityManager.getState());
    return { success: result };
  });

  // Set files mode (off/read/full)
  ipcMain.handle('capability:set-files-mode', async (event, mode) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    try {
      const result = capabilityManager.setFilesMode(mode);
      mainWindow.webContents.send('capability-update', capabilityManager.getState());
      return { success: true, mode: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Get active tools list (respecting capability settings)
  ipcMain.handle('capability:get-active-tools', async () => {
    if (!capabilityManager) return mcpServer.getActiveTools().map(t => t.name);
    return capabilityManager.getActiveTools();
  });

  // Port listener management
  ipcMain.handle('capability:add-port-listener', async (event, listener) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    const result = capabilityManager.addPortListener(listener);
    return { success: true, listener: result };
  });

  ipcMain.handle('capability:remove-port-listener', async (event, port) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    capabilityManager.removePortListener(port);
    return { success: true };
  });

  ipcMain.handle('capability:get-port-listeners', async () => {
    if (!capabilityManager) return [];
    return capabilityManager.getPortListeners();
  });

  // Custom tool safety management
  ipcMain.handle('capability:set-custom-tool-safe', async (event, toolName, isSafe) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    capabilityManager.setCustomToolSafe(toolName, isSafe);
    return { success: true };
  });

  // ==================== Port Listener Management ====================

  ipcMain.handle('port-listener:register', async (event, config) => {
    if (!portListenerManager) return { error: 'PortListenerManager not initialized' };
    try {
      const result = await portListenerManager.register(config);
      mainWindow.webContents.send('port-listener-update', portListenerManager.getListeners());
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('port-listener:unregister', async (event, port) => {
    if (!portListenerManager) return { error: 'PortListenerManager not initialized' };
    try {
      const result = await portListenerManager.unregister(port);
      mainWindow.webContents.send('port-listener-update', portListenerManager.getListeners());
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('port-listener:list', async () => {
    if (!portListenerManager) return [];
    return portListenerManager.getListeners();
  });

  // ==================== Agent Memory Management ====================

  ipcMain.handle('agent-memory:append', async (event, type, content, filename) => {
    if (!agentMemory) return { error: 'AgentMemory not initialized' };
    try {
      return await agentMemory.append(type, content, filename);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('agent-memory:read', async (event, type, filename) => {
    if (!agentMemory) return { error: 'AgentMemory not initialized' };
    try {
      return await agentMemory.read(type, filename);
    } catch (error) {
      return { exists: false, error: error.message };
    }
  });

  ipcMain.handle('agent-memory:list', async (event, type) => {
    if (!agentMemory) return [];
    try {
      return await agentMemory.list(type);
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('agent-memory:stats', async () => {
    if (!agentMemory) return {};
    return agentMemory.getStats();
  });

  ipcMain.handle('agent-memory:save-image', async (event, imageBuffer, name) => {
    if (!agentMemory) return { error: 'AgentMemory not initialized' };
    try {
      return await agentMemory.saveImage(Buffer.from(imageBuffer), name);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Listen for MCP server events and forward to renderer
  mcpServer.on('calendar-update', () => {
    mainWindow.webContents.send('calendar-update');
  });

  mcpServer.on('todo-update', () => {
    mainWindow.webContents.send('todo-update');
  });

  mcpServer.on('tool-executed', (eventData) => {
    mainWindow.webContents.send('tool-update', eventData);
  });

  // File handling
  ipcMain.handle('handle-file-drop', async (event, filePath, sessionId = null) => {
    const fs = require('fs');
    const path = require('path');
    const activitySessionId = sessionId || 'default';
    markUserActive(activitySessionId);

    try {
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();

      let message;

      // Image files - encode as base64
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        message = `User dropped image "${fileName}". [Image data: ${base64.substring(0, 100)}... (base64 encoded)]`;
      } else {
        // Text files
        const content = fs.readFileSync(filePath, 'utf-8');
        message = `User dropped file "${fileName}". Content:\n\n---\n\n${content}`;
      }

      await db.addConversation({ role: 'user', content: message }, sessionId);

      // Route through chain controller (same path as send-message)
      const conversations = await db.getConversations(20, sessionId);
      const conversationHistory = conversations.map(c => ({
        role: c.role,
        content: c.role === 'assistant'
          ? stripReasoningBlocks(stripToolPatterns(c.content))
          : c.content
      })).filter(c => c.content && c.content.trim().length > 0).reverse();

      let response;
      if (chainController) {
        response = await chainController.executeWithChaining(message, conversationHistory, { sessionId });
      } else {
        response = await dispatcher.dispatch(message, conversationHistory, { mode: 'chat', sessionId });
      }

      const activeProvider = await db.getSetting('llm.provider');
      const activeModel = await db.getSetting('llm.model');
      const { runtime: runtimeConfig } = activeProvider && activeModel
        ? await getModelRuntimeConfig(db, activeProvider, activeModel)
        : { runtime: null };
      const cleanContent = stripToolPatterns(buildAssistantContent(response, runtimeConfig));
      await db.addConversation({ role: 'assistant', content: cleanContent }, sessionId);
      mainWindow.webContents.send('conversation-update', { sessionId });

      return { success: true, response: { ...response, content: cleanContent }, sessionId };
    } catch (error) {
      console.error('Error handling file drop:', error);
      await db.addConversation({ role: 'system', content: `Error processing file: ${error.message}` }, sessionId);
      mainWindow.webContents.send('conversation-update', { sessionId });
      throw error;
    } finally {
      markUserIdle(activitySessionId);
    }
  });

  ipcMain.handle('read-file', async (event, filePath) => {
    const fs = require('fs');
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  });

  ipcMain.handle('get-context-setting', async () => {
    try {
      return await db.getSetting('context_window') || '8192';
    } catch (error) {
      console.error('Error getting context setting:', error);
      return '8192';
    }
  });

  ipcMain.handle('set-context-setting', async (_, value) => {
    try {
      const numValue = parseInt(value);
      if (isNaN(numValue)) throw new Error('Invalid number');
      if (numValue < 2048 || numValue > 262144) {
        throw new Error('Value must be between 2048 and 262144');
      }
      await db.setSetting('context_window', numValue.toString());
      console.log('Context saved:', numValue);
      return { success: true };
    } catch (error) {
      console.error('Context save error:', error.message);
      throw error;
    }
  });

  // Generic get-setting-value for UI persistence (thinking visibility, etc.)
  ipcMain.handle('get-setting-value', async (_, key) => {
    try {
      return await db.getSetting(key);
    } catch (error) {
      console.error(`Error getting setting ${key}:`, error);
      return null;
    }
  });

  // Prompt File Manager handlers
  ipcMain.handle('prompt:get-paths', async () => {
    if (!promptFileManager) return { error: 'PromptFileManager not initialized' };
    return promptFileManager.getPaths();
  });

  ipcMain.handle('prompt:sync-from-files', async () => {
    if (!promptFileManager) return { error: 'PromptFileManager not initialized' };
    await promptFileManager.syncFromFiles();
    // Reload into AIService
    const systemPrompt = await promptFileManager.loadSystemPrompt();
    await aiService.setSystemPrompt(systemPrompt);
    return { success: true };
  });

  ipcMain.handle('prompt:sync-to-files', async () => {
    if (!promptFileManager) return { error: 'PromptFileManager not initialized' };
    await promptFileManager.syncToFiles();
    return { success: true };
  });

  ipcMain.handle('prompt:get-system', async () => {
    if (!promptFileManager) return aiService.getSystemPrompt();
    return await promptFileManager.loadSystemPrompt();
  });

  ipcMain.handle('prompt:set-system', async (event, content) => {
    if (promptFileManager) {
      await promptFileManager.saveSystemPrompt(content, true);
    }
    await aiService.setSystemPrompt(content);
    return { success: true };
  });

  ipcMain.handle('prompt:get-rules-from-files', async () => {
    if (!promptFileManager) return [];
    return await promptFileManager.loadRulesFromFiles();
  });

  // ==================== Agent Loop ====================

  // Load memory context for a session (called when session loads in UI)
  ipcMain.handle('agent-loop:memory-start', async (event, sessionId) => {
    if (!agentLoop) return null;
    return await agentLoop.loadMemoryContext(sessionId);
  });

  // Get automemory state for a session
  ipcMain.handle('agent-loop:get-state', async (event, sessionId) => {
    if (!agentLoop) return { autoMemory: false };
    const session = agentLoop.getSession(sessionId);
    return { autoMemory: session.autoMemory, idleSeconds: session.idleSeconds };
  });

  // ==================== Connectors ====================

  ipcMain.handle('connectors:list', async () => {
    if (!connectorRuntime) return [];
    return await connectorRuntime.listConnectors();
  });

  ipcMain.handle('connectors:start', async (event, name) => {
    if (!connectorRuntime) return { error: 'Connector runtime not initialized' };
    return await connectorRuntime.startConnector(name);
  });

  ipcMain.handle('connectors:stop', async (event, name) => {
    if (!connectorRuntime) return { error: 'Connector runtime not initialized' };
    return await connectorRuntime.stopConnector(name);
  });

  ipcMain.handle('connectors:logs', async (event, name, limit) => {
    if (!connectorRuntime) return [];
    return connectorRuntime.getLogs(name, limit);
  });

  ipcMain.handle('connectors:delete', async (event, name) => {
    if (!connectorRuntime) return { error: 'Connector runtime not initialized' };
    // Stop if running
    try { await connectorRuntime.stopConnector(name); } catch (e) { /* may not be running */ }
    // Delete file
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../../agentin/connectors', `${name}.js`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true, name };
  });

  // ==================== Agent Management ====================

  ipcMain.handle('get-agents', async (event, type = null) => {
    if (!agentManager) return [];
    return await agentManager.getAgents(type);
  });

  ipcMain.handle('get-agent', async (event, id) => {
    if (!agentManager) return null;
    return await agentManager.getAgent(id);
  });

  ipcMain.handle('create-agent', async (event, data) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.createAgent(data);
    mainWindow.webContents.send('agent-update');
    return result;
  });

  ipcMain.handle('update-agent', async (event, id, data) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.updateAgent(id, data);
    mainWindow.webContents.send('agent-update');
    return result;
  });

  ipcMain.handle('delete-agent', async (event, id) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.deleteAgent(id);
    mainWindow.webContents.send('agent-update');
    return result;
  });

  ipcMain.handle('activate-agent', async (event, id) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.activateAgent(id);
    mainWindow.webContents.send('agent-update');
    return result;
  });

  ipcMain.handle('deactivate-agent', async (event, id) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    await agentManager.deactivateAgent(id);
    mainWindow.webContents.send('agent-update');
    return { success: true };
  });

  ipcMain.handle('compact-agent', async (event, id) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    await agentManager.compactAgent(id);
    return { success: true };
  });

  // Initialize AI service
  aiService.initialize().catch(console.error);

  // ==================== Background Daemon Controls ====================

  ipcMain.handle('daemon:memory-start', async () => {
    if (!memoryDaemon) return { error: 'Memory daemon not initialized' };
    await memoryDaemon.start();
    await syncDaemonEnabledSetting();
    return { success: true };
  });

  ipcMain.handle('daemon:memory-stop', async () => {
    if (!memoryDaemon) return { error: 'Memory daemon not initialized' };
    memoryDaemon.stop();
    await syncDaemonEnabledSetting();
    return { success: true };
  });

  ipcMain.handle('daemon:memory-status', async () => {
    if (!memoryDaemon) return { running: false };
    return memoryDaemon.getStatus();
  });

  ipcMain.handle('daemon:workflow-start', async () => {
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    await workflowScheduler.start();
    await syncDaemonEnabledSetting();
    return { success: true };
  });

  ipcMain.handle('daemon:workflow-stop', async () => {
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    workflowScheduler.stop();
    await syncDaemonEnabledSetting();
    return { success: true };
  });

  ipcMain.handle('daemon:workflow-status', async () => {
    if (!workflowScheduler) return { running: false };
    return workflowScheduler.getStatus();
  });

  // Workflow schedule management
  ipcMain.handle('daemon:add-schedule', async (event, workflowId, intervalMinutes, name) => {
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    return workflowScheduler.addSchedule(workflowId, intervalMinutes, name);
  });

  ipcMain.handle('daemon:remove-schedule', async (event, scheduleId) => {
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    return workflowScheduler.removeSchedule(scheduleId);
  });

  ipcMain.handle('daemon:toggle-schedule', async (event, scheduleId, enabled) => {
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    return workflowScheduler.toggleSchedule(scheduleId, enabled);
  });

  ipcMain.handle('daemon:get-schedules', async () => {
    if (!workflowScheduler) return [];
    return workflowScheduler._getAllSchedules();
  });

  // ==================== Session Init ====================

  ipcMain.handle('session-init:detect', async () => {
    if (!sessionInitManager) return { isColdStart: false };
    const daemonRunning = memoryDaemon ? memoryDaemon.running : false;
    return await sessionInitManager.detectStartType(daemonRunning);
  });

  ipcMain.handle('session-init:cold-start-prompt', async (event, hoursInactive) => {
    if (!sessionInitManager) return null;
    return await sessionInitManager.buildColdStartPrompt(hoursInactive);
  });

  // ==================== /baseinit ====================

  ipcMain.handle('baseinit:check', async () => {
    const completed = await db.getSetting('baseinit.completed');
    return { completed: completed === 'true' };
  });

  ipcMain.handle('baseinit:run', async () => {
    if (!sessionInitManager) return { error: 'SessionInitManager not initialized' };

    try {
      const report = await sessionInitManager.buildBaseInitReport();

      // Start daemons as part of baseinit
      if (memoryDaemon && !memoryDaemon.running) {
        await memoryDaemon.start();
      }
      if (workflowScheduler && !workflowScheduler.running) {
        await workflowScheduler.start();
      }

      // Mark baseinit as complete
      await db.saveSetting('baseinit.completed', 'true');
      await db.saveSetting('baseinit.timestamp', new Date().toISOString());
      await db.saveSetting('baseinit.daemonEnabled', 'true');

      if (eventBus) {
        eventBus.publish('init:baseinit-complete', { report });
      }

      return { success: true, report };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ==================== EventBus ====================

  ipcMain.handle('eventbus:get-log', async (event, category, limit) => {
    if (!eventBus) return [];
    return eventBus.getLog(category, limit);
  });
};
