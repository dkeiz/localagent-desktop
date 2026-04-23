const fs = require('fs');
const path = require('path');
const { getModelRuntimeConfig } = require('../llm-config');
const { getEffectiveLlmSelection, rememberLastWorkingModel } = require('../llm-state');
const {
  stripToolPatterns,
  stripReasoningBlocks,
  buildAssistantContent
} = require('./shared-utils');

function registerChatDataHandlers(ipcMain, runtime, helpers) {
  const {
    db,
    mcpServer,
    windowManager,
    chainController,
    agentLoop,
    dispatcher,
    sessionWorkspace,
    sessionInitManager,
    promptFileManager,
    testClientMode,
    testClientStore
  } = runtime;
  const { markUserActive, markUserIdle } = helpers;

  function isTestSessionId(sessionId) {
    return typeof sessionId === 'string' && sessionId.startsWith('testclient-');
  }

  function ensureTestSession(sessionId = null) {
    if (!testClientMode) return sessionId;
    if (sessionId && isTestSessionId(sessionId)) {
      if (!testClientStore.sessions.has(sessionId)) {
        testClientStore.sessions.set(sessionId, { id: sessionId, title: 'Test Client', created_at: new Date().toISOString(), messages: [] });
      }
      testClientStore.currentSessionId = sessionId;
      return sessionId;
    }

    if (testClientStore.currentSessionId && testClientStore.sessions.has(testClientStore.currentSessionId)) {
      return testClientStore.currentSessionId;
    }

    const id = `testclient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    testClientStore.sessions.set(id, {
      id,
      title: `Test Chat ${new Date().toLocaleTimeString()}`,
      created_at: new Date().toISOString(),
      messages: []
    });
    testClientStore.currentSessionId = id;
    return id;
  }

  function getTestMessages(sessionId, limit = 100) {
    const sid = ensureTestSession(sessionId);
    const session = testClientStore.sessions.get(sid);
    if (!session) return [];
    return session.messages.slice(-limit).map(m => ({
      ...m,
      timestamp: m.timestamp || new Date().toISOString()
    }));
  }

  async function getHistory(limit = 100, sessionId = null) {
    if (testClientMode && (isTestSessionId(sessionId) || !sessionId)) {
      return getTestMessages(sessionId, limit);
    }
    return db.getConversations(limit, sessionId);
  }

  async function persistMessage(message, sessionId = null) {
    if (testClientMode && (isTestSessionId(sessionId) || !sessionId)) {
      const sid = ensureTestSession(sessionId);
      const session = testClientStore.sessions.get(sid);
      session.messages.push({
        role: message.role,
        content: message.content,
        metadata: message.metadata || null,
        timestamp: new Date().toISOString()
      });
      return message;
    }
    return db.addConversation(message, sessionId);
  }

  async function resolveRuntimeForResponse(response) {
    const responseRuntime = response?.renderContext?.runtimeConfig;
    if (responseRuntime && typeof responseRuntime === 'object') {
      return responseRuntime;
    }

    const provider = response?.renderContext?.provider;
    const model = response?.renderContext?.model;
    if (provider && model) {
      const { runtime } = await getModelRuntimeConfig(db, provider, model);
      return runtime;
    }

    const { provider: activeProvider, model: activeModel } = await getEffectiveLlmSelection(db);
    if (activeProvider && activeModel) {
      const { runtime } = await getModelRuntimeConfig(db, activeProvider, activeModel);
      return runtime;
    }

    return null;
  }

  const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.cs', '.go', '.rs', '.cpp', '.c',
    '.h', '.hpp', '.rb', '.php', '.sh', '.ps1', '.bat', '.sql', '.xml', '.html', '.css', '.scss',
    '.less', '.csv', '.log'
  ]);
  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
  const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);
  const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v']);

  function artifactKindFromExt(fileName) {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    return 'binary';
  }

  ipcMain.handle('get-calendar-events', async () => db.getCalendarEvents());

  ipcMain.handle('add-calendar-event', async (event, calendarEvent) => {
    const result = await db.addCalendarEvent(calendarEvent);
    windowManager.send('calendar-update');
    return result;
  });

  ipcMain.handle('update-calendar-event', async (event, id, calendarEvent) => {
    const result = await db.updateCalendarEvent(id, calendarEvent);
    windowManager.send('calendar-update');
    return result;
  });

  ipcMain.handle('delete-calendar-event', async (event, id) => {
    const result = await db.deleteCalendarEvent(id);
    windowManager.send('calendar-update');
    return result;
  });

  ipcMain.handle('get-todos', async () => db.getTodos());

  ipcMain.handle('add-todo', async (event, todo) => {
    const result = await db.addTodo(todo);
    windowManager.send('todo-update');
    return result;
  });

  ipcMain.handle('update-todo', async (event, id, todo) => {
    const result = await db.updateTodo(id, todo);
    windowManager.send('todo-update');
    return result;
  });

  ipcMain.handle('delete-todo', async (event, id) => {
    const result = await db.deleteTodo(id);
    windowManager.send('todo-update');
    return result;
  });

  ipcMain.handle('get-conversations', async (event, limit = 100, sessionId = null) => {
    return getHistory(limit, sessionId);
  });

  ipcMain.handle('add-conversation', async (event, message) => {
    const result = await persistMessage(message, null);
    windowManager.send('conversation-update');
    return result;
  });

  ipcMain.handle('clear-conversations', async () => {
    try {
      if (testClientMode) {
        const sid = ensureTestSession();
        const session = testClientStore.sessions.get(sid);
        session.messages = [];
        windowManager.send('conversation-update', { sessionId: sid });
        return { cleared: true, sessionId: sid };
      }
      const newSession = await db.createChatSession();
      await db.setCurrentSession(newSession.id);
      windowManager.send('conversation-update');
      return { cleared: true, sessionId: newSession.id };
    } catch (error) {
      console.error('Error clearing conversations:', error);
      throw error;
    }
  });

  ipcMain.handle('get-prompt-rules', async () => db.getPromptRules());
  ipcMain.handle('get-active-prompt-rules', async () => db.getActivePromptRules());

  ipcMain.handle('add-prompt-rule', async (event, rule) => {
    const result = await db.addPromptRule(rule);
    if (promptFileManager) await promptFileManager.syncToFiles();
    return result;
  });

  ipcMain.handle('update-prompt-rule', async (event, id, rule) => {
    const result = await db.updatePromptRule(id, rule);
    if (promptFileManager) await promptFileManager.syncToFiles();
    return result;
  });

  ipcMain.handle('toggle-prompt-rule', async (event, id, active) => {
    const result = await db.togglePromptRule(id, active);
    if (promptFileManager) await promptFileManager.syncToFiles();
    return result;
  });

  ipcMain.handle('delete-prompt-rule', async (event, id) => {
    const result = await db.deletePromptRule(id);
    if (promptFileManager) await promptFileManager.syncToFiles();
    return result;
  });

  ipcMain.handle('save-setting', async (event, key, value) => db.saveSetting(key, value));
  ipcMain.handle('create-chat-session', async () => {
    if (testClientMode) {
      const sid = ensureTestSession();
      return { id: sid, title: testClientStore.sessions.get(sid)?.title || 'Test Client' };
    }
    return db.createChatSession();
  });
  ipcMain.handle('get-chat-sessions', async (event, date = null, limit = 6) => {
    if (testClientMode) {
      return Array.from(testClientStore.sessions.values())
        .map(s => ({
          id: s.id,
          title: s.title,
          created_at: s.created_at,
          last_message_at: s.messages.length ? s.messages[s.messages.length - 1].timestamp : s.created_at,
          message_count: s.messages.length,
          first_message: (s.messages.find(m => m.role === 'user') || {}).content || null
        }))
        .sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)))
        .slice(0, limit);
    }
    return db.getChatSessions(date, limit);
  });
  ipcMain.handle('load-chat-session', async (event, sessionId) => {
    if (testClientMode && isTestSessionId(sessionId)) {
      return getTestMessages(sessionId, 1000);
    }
    return db.loadChatSession(sessionId);
  });

  ipcMain.handle('clear-chat-session', async (event, sessionId) => {
    try {
      if (testClientMode && isTestSessionId(sessionId)) {
        const sid = ensureTestSession(sessionId);
        const session = testClientStore.sessions.get(sid);
        if (session) {
          session.messages = [];
        }
        windowManager.send('conversation-update', { sessionId: sid });
        return { cleared: true, sessionId: sid };
      }

      await db.clearChatSession(sessionId);
      windowManager.send('conversation-update', { sessionId });
      return { cleared: true, sessionId };
    } catch (error) {
      console.error('Error clearing chat session:', error);
      throw error;
    }
  });

  ipcMain.handle('switch-chat-session', async (event, sessionId) => {
    try {
      if (testClientMode && isTestSessionId(sessionId)) {
        ensureTestSession(sessionId);
        if (mcpServer.setCurrentSessionId) {
          mcpServer.setCurrentSessionId(sessionId);
        }
        return { success: true, sessionId };
      }
      if (agentLoop) {
        const prevSession = await db.getCurrentSession();
        if (prevSession && prevSession.id !== sessionId) {
          agentLoop.onSessionClose(prevSession.id).catch(e => console.error('[IPC] Session close error:', e));
        }
      }
      await db.setCurrentSession(sessionId);
      if (mcpServer.setCurrentSessionId) {
        mcpServer.setCurrentSessionId(sessionId);
      }
      if (mcpServer.setCurrentAgentContext) {
        const sessionRow = db.get('SELECT agent_id FROM chat_sessions WHERE id = ?', [sessionId]);
        mcpServer.setCurrentAgentContext(sessionRow?.agent_id ? { sessionId, agentId: sessionRow.agent_id } : null);
      }
      return { success: true, sessionId };
    } catch (error) {
      console.error('Error switching session:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-chat-session', async (event, sessionId) => {
    try {
      if (testClientMode && isTestSessionId(sessionId)) {
        testClientStore.sessions.delete(sessionId);
        if (testClientStore.currentSessionId === sessionId) {
          testClientStore.currentSessionId = null;
        }
        windowManager.send('conversation-update');
        return { success: true };
      }
      await db.deleteChatSession(sessionId);
      windowManager.send('conversation-update');
      return { success: true };
    } catch (error) {
      console.error('Error deleting chat session:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-all-conversations', async () => {
    try {
      if (testClientMode) {
        testClientStore.sessions.clear();
        testClientStore.currentSessionId = null;
        windowManager.send('conversation-update');
        return { success: true, message: 'All test conversations deleted' };
      }
      await db.deleteAllConversations();
      windowManager.send('conversation-update');
      return { success: true, message: 'All conversations deleted' };
    } catch (error) {
      console.error('Error deleting all conversations:', error);
      throw error;
    }
  });

  ipcMain.handle('get-session-artifacts', async (event, sessionId = null) => {
    try {
      const effectiveSessionId = testClientMode ? ensureTestSession(sessionId) : sessionId;
      if (isTestSessionId(effectiveSessionId)) {
        return { success: true, sessionId: effectiveSessionId, files: [], fileCount: 0 };
      }

      const resolvedSessionId = effectiveSessionId || (await db.getCurrentSession())?.id || null;
      if (!resolvedSessionId || !sessionWorkspace?.listFiles) {
        return { success: true, sessionId: resolvedSessionId, files: [], fileCount: 0 };
      }

      const files = sessionWorkspace.listFiles(resolvedSessionId)
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
        .map(file => ({
          name: file.name,
          size: file.size,
          created: file.created,
          kind: artifactKindFromExt(file.name)
        }));

      return {
        success: true,
        sessionId: resolvedSessionId,
        files,
        fileCount: files.length
      };
    } catch (error) {
      console.error('Error getting session artifacts:', error);
      return { success: false, error: error.message, files: [], fileCount: 0 };
    }
  });

  ipcMain.handle('read-session-artifact', async (event, sessionId, fileName) => {
    try {
      const effectiveSessionId = testClientMode ? ensureTestSession(sessionId) : sessionId;
      if (isTestSessionId(effectiveSessionId)) {
        return { success: false, error: 'Test sessions do not expose workspace artifacts' };
      }
      if (!effectiveSessionId) {
        return { success: false, error: 'Missing sessionId' };
      }
      if (!sessionWorkspace?.getWorkspacePath) {
        return { success: false, error: 'Session workspace unavailable' };
      }

      const safeName = path.basename(String(fileName || ''));
      if (!safeName || safeName !== String(fileName || '')) {
        return { success: false, error: 'Invalid artifact name' };
      }

      const workspaceDir = sessionWorkspace.getWorkspacePath(effectiveSessionId);
      const artifactPath = path.resolve(workspaceDir, safeName);
      if (!artifactPath.startsWith(path.resolve(workspaceDir) + path.sep)) {
        return { success: false, error: 'Requested artifact is outside workspace' };
      }
      if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
        return { success: false, error: 'Artifact file not found' };
      }

      const stat = fs.statSync(artifactPath);
      const kind = artifactKindFromExt(safeName);
      const maxTextBytes = 1024 * 1024;
      let content = null;
      if (kind === 'text') {
        if (stat.size > maxTextBytes) {
          return {
            success: false,
            error: `Text artifact is too large to open (${Math.round(stat.size / 1024)} KB, max 1024 KB)`
          };
        }
        content = fs.readFileSync(artifactPath, 'utf-8');
      }

      return {
        success: true,
        name: safeName,
        size: stat.size,
        kind,
        path: artifactPath,
        content
      };
    } catch (error) {
      console.error('Error reading session artifact:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-session-artifact', async (event, sessionId, fileName, content) => {
    try {
      const effectiveSessionId = testClientMode ? ensureTestSession(sessionId) : sessionId;
      if (isTestSessionId(effectiveSessionId)) {
        return { success: false, error: 'Test sessions do not support artifact writes' };
      }
      if (!effectiveSessionId) {
        return { success: false, error: 'Missing sessionId' };
      }
      if (!sessionWorkspace?.getWorkspacePath) {
        return { success: false, error: 'Session workspace unavailable' };
      }

      const safeName = path.basename(String(fileName || ''));
      if (!safeName || safeName !== String(fileName || '')) {
        return { success: false, error: 'Invalid artifact name' };
      }
      if (artifactKindFromExt(safeName) !== 'text') {
        return { success: false, error: 'Only text artifacts are editable' };
      }

      const workspaceDir = sessionWorkspace.getWorkspacePath(effectiveSessionId);
      const artifactPath = path.resolve(workspaceDir, safeName);
      if (!artifactPath.startsWith(path.resolve(workspaceDir) + path.sep)) {
        return { success: false, error: 'Requested artifact is outside workspace' };
      }
      if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
        return { success: false, error: 'Artifact file not found' };
      }

      const normalizedContent = String(content ?? '');
      const maxBytes = 2 * 1024 * 1024;
      if (Buffer.byteLength(normalizedContent, 'utf-8') > maxBytes) {
        return { success: false, error: 'Edited content exceeds 2 MB limit' };
      }

      fs.writeFileSync(artifactPath, normalizedContent, 'utf-8');
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });
      return { success: true, name: safeName, size: Buffer.byteLength(normalizedContent, 'utf-8') };
    } catch (error) {
      console.error('Error writing session artifact:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('send-message', async (event, message, useChaining = true, sessionId = null) => {
    const effectiveSessionId = testClientMode ? ensureTestSession(sessionId) : sessionId;
    const isTestSession = isTestSessionId(effectiveSessionId);
    const activitySessionId = effectiveSessionId || 'default';
    if (!isTestSession) {
      markUserActive(activitySessionId);
    }

    try {
      const conversations = await getHistory(20, effectiveSessionId);
      const conversationHistory = conversations.map(c => ({
        role: c.role,
        content: c.role === 'assistant'
          ? stripReasoningBlocks(stripToolPatterns(c.content))
          : c.content
      })).filter(c => c.content && c.content.trim().length > 0);

      if (!isTestSession && agentLoop) {
        agentLoop.recordActivity(activitySessionId);
      }
      if (!isTestSession && mcpServer.setCurrentSessionId) {
        mcpServer.setCurrentSessionId(activitySessionId);
      }
      if (!isTestSession && effectiveSessionId) {
        await db.setCurrentSession(effectiveSessionId);
      }
      if (!isTestSession && sessionInitManager) {
        sessionInitManager.recordActivity().catch(() => {});
      }

      await persistMessage({ role: 'user', content: message }, effectiveSessionId);

      const sessionRow = !isTestSession && effectiveSessionId
        ? db.get('SELECT agent_id FROM chat_sessions WHERE id = ?', [effectiveSessionId])
        : null;
      const agentId = sessionRow ? sessionRow.agent_id : null;
      if (!isTestSession && mcpServer.setCurrentAgentContext) {
        mcpServer.setCurrentAgentContext(agentId ? { sessionId: effectiveSessionId, agentId } : null);
      }

      let response;
      if (chainController && useChaining) {
        console.log('[IPC] Using tool chain controller');
        response = await chainController.executeWithChaining(message, conversationHistory, { sessionId: effectiveSessionId, agentId });
        if (response && response.needsPermission) {
          windowManager.send('tool-permission-request', { ...response.permissionRequest, sessionId: effectiveSessionId });
          return { needsPermission: true, sessionId: effectiveSessionId, ...response.permissionRequest };
        }
      } else {
        response = await dispatcher.dispatch(message, conversationHistory, { mode: 'chat', sessionId: effectiveSessionId, agentId });
      }

      if (!response || !response.content) {
        console.error('[IPC] No response from AI service');
        response = { content: 'Sorry, I was unable to generate a response. Please try again.', model: 'unknown' };
      }

      const runtimeConfig = await resolveRuntimeForResponse(response);
      const cleanContent = stripToolPatterns(buildAssistantContent(response, runtimeConfig));
      await persistMessage({ role: 'assistant', content: cleanContent }, effectiveSessionId);
      const { provider: activeProvider, model: activeModel } = await getEffectiveLlmSelection(db);
      if (activeProvider && activeModel) {
        await rememberLastWorkingModel(db, activeProvider, activeModel);
      }
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });

      return { ...response, content: cleanContent, sessionId: effectiveSessionId };
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    } finally {
      if (!isTestSession) {
        markUserIdle(activitySessionId);
      }
    }
  });

  ipcMain.handle('interpret-tool-result', async (event, toolName, params, toolResult, sessionId = null) => {
    const effectiveSessionId = testClientMode ? ensureTestSession(sessionId) : sessionId;
    const isTestSession = isTestSessionId(effectiveSessionId);
    const activitySessionId = effectiveSessionId || 'default';
    if (!isTestSession) {
      markUserActive(activitySessionId);
    }

    try {
      const conversations = await getHistory(20, effectiveSessionId);
      const conversationHistory = conversations.map(c => ({
        role: c.role,
        content: c.role === 'assistant'
          ? stripReasoningBlocks(stripToolPatterns(c.content))
          : c.content
      })).filter(c => c.content && c.content.trim().length > 0);

      const toolContext = `Tool "${toolName}" was executed with parameters: ${JSON.stringify(params)}\n\nResult: ${JSON.stringify(toolResult, null, 2)}\n\nBased on this tool result, provide a natural, helpful response to the user. Do NOT call any tools.`;
      const response = await dispatcher.dispatch(toolContext, conversationHistory, { mode: 'chat', sessionId: effectiveSessionId });
      const runtimeConfig = await resolveRuntimeForResponse(response);
      const cleanContent = stripToolPatterns(buildAssistantContent(response, runtimeConfig));

      await persistMessage({ role: 'assistant', content: cleanContent }, effectiveSessionId);
      const { provider: activeProvider, model: activeModel } = await getEffectiveLlmSelection(db);
      if (activeProvider && activeModel) {
        await rememberLastWorkingModel(db, activeProvider, activeModel);
      }
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });
      return { ...response, content: cleanContent, sessionId: effectiveSessionId };
    } catch (error) {
      console.error('Error interpreting tool result:', error);
      return {
        content: `Tool ${toolName} returned: ${JSON.stringify(toolResult, null, 2)}`,
        model: 'fallback'
      };
    } finally {
      if (!isTestSession) {
        markUserIdle(activitySessionId);
      }
    }
  });

  ipcMain.handle('handle-file-drop', async (event, filePath, sessionId = null) => {
    const fs = require('fs');
    const path = require('path');
    const effectiveSessionId = testClientMode ? ensureTestSession(sessionId) : sessionId;
    const isTestSession = isTestSessionId(effectiveSessionId);
    const activitySessionId = effectiveSessionId || 'default';
    if (!isTestSession) {
      markUserActive(activitySessionId);
    }

    try {
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let message;

      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        message = `User dropped image "${fileName}". [Image data: ${base64.substring(0, 100)}... (base64 encoded)]`;
      } else {
        const content = fs.readFileSync(filePath, 'utf-8');
        message = `User dropped file "${fileName}". Content:\n\n---\n\n${content}`;
      }

      await persistMessage({ role: 'user', content: message }, effectiveSessionId);
      const conversations = await getHistory(20, effectiveSessionId);
      const conversationHistory = conversations.map(c => ({
        role: c.role,
        content: c.role === 'assistant'
          ? stripReasoningBlocks(stripToolPatterns(c.content))
          : c.content
      })).filter(c => c.content && c.content.trim().length > 0);

      let response;
      if (chainController) {
        response = await chainController.executeWithChaining(message, conversationHistory, { sessionId: effectiveSessionId });
      } else {
        response = await dispatcher.dispatch(message, conversationHistory, { mode: 'chat', sessionId: effectiveSessionId });
      }

      const runtimeConfig = await resolveRuntimeForResponse(response);
      const cleanContent = stripToolPatterns(buildAssistantContent(response, runtimeConfig));
      await persistMessage({ role: 'assistant', content: cleanContent }, effectiveSessionId);
      const { provider: activeProvider, model: activeModel } = await getEffectiveLlmSelection(db);
      if (activeProvider && activeModel) {
        await rememberLastWorkingModel(db, activeProvider, activeModel);
      }
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });

      return { success: true, response: { ...response, content: cleanContent }, sessionId: effectiveSessionId };
    } catch (error) {
      console.error('Error handling file drop:', error);
      await persistMessage({ role: 'system', content: `Error processing file: ${error.message}` }, effectiveSessionId);
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });
      throw error;
    } finally {
      if (!isTestSession) {
        markUserIdle(activitySessionId);
      }
    }
  });

  ipcMain.handle('testclient:status', async () => {
    return {
      enabled: testClientMode,
      currentSessionId: testClientStore.currentSessionId,
      sessionCount: testClientStore.sessions.size
    };
  });

  ipcMain.handle('testclient:reset', async () => {
    if (!testClientMode) return { success: false, error: 'Not in --testclient mode' };
    testClientStore.sessions.clear();
    testClientStore.currentSessionId = null;
    return { success: true };
  });

  ipcMain.handle('read-file', async (event, filePath) => {
    const fs = require('fs');
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  });
}

module.exports = { registerChatDataHandlers };
