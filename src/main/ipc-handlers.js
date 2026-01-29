// Remove this line - we'll get ollamaService from main.js

module.exports = function setupIpcHandlers(ipcMain, db, aiService, mcpServer, mainWindow, ollamaService) {
    // Ollama model selection handlers
    ipcMain.handle('getProviderModels', async (event, provider) => {
        if (provider === 'ollama') {
            try {
                const models = await ollamaService.getModels();
                return { status: 'success', models };
            } catch (error) {
                return { status: 'error', message: error.message };
            }
        }
        return { status: 'error', message: 'Provider not implemented' };
    });
    
    ipcMain.handle('checkProviderStatus', async (event, provider) => {
        if (provider === 'ollama') {
            const status = await ollamaService.checkConnection();
            return { connected: status };
        }
        return { connected: false };
    });
    
    ipcMain.handle('setActiveModel', async (event, provider, model) => {
        await db.setActiveModel(provider, model);
        return { success: true };
    });

    ipcMain.handle('llm:get-models', async (event, provider) => {
      console.log('llm:get-models called with provider:', provider);
      if (provider === 'ollama' || provider === 'Ollama') {
        try {
          const models = await ollamaService.listModels();
          console.log('Models from ollama:', models);
          return models;
        } catch (error) {
          console.error('Failed to fetch models from service:', error);
          return [];
        }
      } else if (provider === 'qwen') {
        try {
          const models = await aiService.getModels('qwen');
          console.log('Models from qwen:', models);
          return models;
        } catch (error) {
          console.error('Failed to fetch qwen models:', error);
          // Return detailed error information to UI
          return { 
            status: 'error', 
            message: error.message,
            details: error.response?.data || null
          };
        }
      } else if (provider === 'openrouter') {
        return [];
      } else if (provider === 'lmstudio') {
        return [];
      }
      return [];
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
            if (config.useOAuth) {
                await db.saveSetting(`llm.${config.provider}.useOAuth`, 'true');
            }
            
            // Update AI service provider
            await aiService.setProvider(config.provider);
            
            // Refresh Qwen models when saving Qwen configuration
            if (config.provider === 'qwen') {
                aiService.getQwenModels(true)
                    .then(models => {
                        console.log(`Refreshed ${models.length} Qwen models`);
                    })
                    .catch(err => {
                        console.error('Background Qwen model refresh failed:', err);
                    });
            }
            
            console.log('Config saved successfully');
            return { success: true };
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
                if (apiKey) config.apiKey = apiKey;
                if (url) config.url = url;
            }
            
            return config;
        } catch (error) {
            console.error('Failed to get LLM config:', error);
            return {};
        }
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

  // Prompt Rules operations
  ipcMain.handle('get-prompt-rules', async () => {
    return await db.getPromptRules();
  });

  ipcMain.handle('get-active-prompt-rules', async () => {
    return await db.getActivePromptRules();
  });

  ipcMain.handle('add-prompt-rule', async (event, rule) => {
    return await db.addPromptRule(rule);
  });

  ipcMain.handle('update-prompt-rule', async (event, id, rule) => {
    return await db.updatePromptRule(id, rule);
  });

  ipcMain.handle('toggle-prompt-rule', async (event, id, active) => {
    return await db.togglePromptRule(id, active);
  });

  ipcMain.handle('delete-prompt-rule', async (event, id) => {
    return await db.deletePromptRule(id);
  });

  // Chat Sessions operations
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
      await db.setCurrentSession(sessionId);
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

  // AI operations
  ipcMain.handle('send-message', async (event, message) => {
    try {
      // Get only recent conversations (not all history)
      const conversations = await db.getConversations(20);
      const conversationHistory = conversations.map(c => ({
        role: c.role,
        content: c.content
      })).reverse();

      await db.addConversation({ role: 'user', content: message });

      const response = await aiService.sendMessage(message, conversationHistory);
      
      // Check for tool calls in response
      const toolCalls = mcpServer.parseToolCall(response.content);
      
      if (toolCalls.length > 0) {
        // Execute tools
        const toolResults = await mcpServer.executeToolCalls(response.content);
        
        // Build tool results context
        const toolContext = toolResults.map(r => 
          `Tool ${r.tool} result: ${r.success ? JSON.stringify(r.result) : 'Error: ' + r.error}`
        ).join('\n');
        
        // Ask AI to interpret results
        const interpretPrompt = `Based on the tool results below, provide a natural response to the user:\n\n${toolContext}`;
        const interpretedResponse = await aiService.sendMessage(interpretPrompt, conversationHistory);
        
        await db.addConversation({ role: 'assistant', content: interpretedResponse.content });
        mainWindow.webContents.send('conversation-update');
        
        return interpretedResponse;
      }
      
      await db.addConversation({ role: 'assistant', content: response.content });
      mainWindow.webContents.send('conversation-update');
      
      return response;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
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

  ipcMain.handle('get-ai-providers', async () => {
    return aiService.getProviders();
  });
  
    ipcMain.handle('get-providers', async () => {
        return aiService.getProviders();
    });

    ipcMain.handle('get-models', async (event, provider) => {
        return await aiService.getModels(provider);
    });
    
    // Add Qwen model refresh handler
    ipcMain.handle('qwen:refresh-models', async () => {
        try {
            const models = await aiService.getQwenModels(true); // Force refresh
            return { success: true, models };
        } catch (error) {
            return { success: false, error: error.message };
        }
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
    await aiService.setSetting('ai_model', model);
    return { success: true };
  });

  ipcMain.handle('set-system-prompt', async (event, prompt) => {
    await aiService.setSystemPrompt(prompt);
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
      // Create a temporary enabled state for this execution
      const originalState = await mcpServer.getToolActiveState(toolName);

      // Temporarily enable the tool
      await mcpServer.setToolActiveState(toolName, true);

      // Execute normally
      const result = await mcpServer.executeTool(toolName, params);

      // Restore original state
      await mcpServer.setToolActiveState(toolName, originalState);

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
      await db.setToolActive(toolName, active);
      return { success: true, toolName, active };
    } catch (error) {
      console.error('Failed to set tool active state:', error);
      throw error;
    }
  });

  ipcMain.handle('create-custom-tool', async (event, toolData) => {
    try {
      await mcpServer.executeTool('create_tool', toolData);
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
      return { success: true };
    } catch (error) {
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

  ipcMain.handle('set-api-key', async (event, provider, key) => {
    await db.setAPIKey(provider, key);
    return { success: true };
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
  ipcMain.handle('handle-file-drop', async (event, filePath) => {
    const fs = require('fs');
    const path = require('path');
    
    try {
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      
      // Image files - encode as base64
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        const message = `User dropped image "${fileName}". [Image data: ${base64.substring(0, 100)}... (base64 encoded)]`;
        
        await db.addConversation({ role: 'user', content: message });
        const conversations = await db.getConversations(20);
        const conversationHistory = conversations.map(c => ({ role: c.role, content: c.content })).reverse();
        const response = await aiService.sendMessage(message, conversationHistory);
        await db.addConversation({ role: 'assistant', content: response.content });
        mainWindow.webContents.send('conversation-update');
        
        return { success: true, response };
      }
      
      // Text files
      const content = fs.readFileSync(filePath, 'utf-8');
      const message = `User dropped file "${fileName}". Content:\n\n---\n\n${content}`;
      
      await db.addConversation({ role: 'user', content: message });
      const conversations = await db.getConversations(20);
      const conversationHistory = conversations.map(c => ({ role: c.role, content: c.content })).reverse();
      const response = await aiService.sendMessage(message, conversationHistory);
      await db.addConversation({ role: 'assistant', content: response.content });
      mainWindow.webContents.send('conversation-update');
      
      return { success: true, response };
    } catch (error) {
      console.error('Error handling file drop:', error);
      await db.addConversation({ role: 'system', content: `Error processing file: ${error.message}` });
      mainWindow.webContents.send('conversation-update');
      throw error;
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
      if (numValue < 2048 || numValue > 100000) {
        throw new Error('Value must be between 2048 and 100000');
      }
      await db.setSetting('context_window', numValue.toString());
      console.log('Context saved:', numValue);
      return { success: true };
    } catch (error) {
      console.error('Context save error:', error.message);
      throw error;
    }
  });

  // Initialize AI service
  aiService.initialize().catch(console.error);
};
