const { getModelRuntimeConfig } = require('../llm-config');
const {
  stripToolPatterns,
  stripReasoningBlocks,
  buildAssistantContent
} = require('./shared-utils');

function registerChatDataHandlers(ipcMain, runtime, helpers) {
  const {
    db,
    mcpServer,
    mainWindow,
    chainController,
    agentLoop,
    dispatcher,
    sessionInitManager,
    promptFileManager
  } = runtime;
  const { markUserActive, markUserIdle } = helpers;

  ipcMain.handle('get-calendar-events', async () => db.getCalendarEvents());

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

  ipcMain.handle('get-todos', async () => db.getTodos());

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
    return db.getConversations(limit, sessionId);
  });

  ipcMain.handle('add-conversation', async (event, message) => {
    const result = await db.addConversation(message);
    mainWindow.webContents.send('conversation-update');
    return result;
  });

  ipcMain.handle('clear-conversations', async () => {
    try {
      const newSession = await db.createChatSession();
      await db.setCurrentSession(newSession.id);
      mainWindow.webContents.send('conversation-update');
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
  ipcMain.handle('create-chat-session', async () => db.createChatSession());
  ipcMain.handle('get-chat-sessions', async (event, date = null, limit = 6) => db.getChatSessions(date, limit));
  ipcMain.handle('load-chat-session', async (event, sessionId) => db.loadChatSession(sessionId));

  ipcMain.handle('switch-chat-session', async (event, sessionId) => {
    try {
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

  ipcMain.handle('send-message', async (event, message, useChaining = true, sessionId = null) => {
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

      if (agentLoop) {
        agentLoop.recordActivity(activitySessionId);
      }
      if (mcpServer.setCurrentSessionId) {
        mcpServer.setCurrentSessionId(activitySessionId);
      }
      if (sessionInitManager) {
        sessionInitManager.recordActivity().catch(() => {});
      }

      await db.addConversation({ role: 'user', content: message }, sessionId);

      const sessionRow = sessionId ? db.get('SELECT agent_id FROM chat_sessions WHERE id = ?', [sessionId]) : null;
      const agentId = sessionRow ? sessionRow.agent_id : null;

      let response;
      if (chainController && useChaining) {
        console.log('[IPC] Using tool chain controller');
        response = await chainController.executeWithChaining(message, conversationHistory, { sessionId, agentId });
        if (response && response.needsPermission) {
          mainWindow.webContents.send('tool-permission-request', { ...response.permissionRequest, sessionId });
          return { needsPermission: true, sessionId, ...response.permissionRequest };
        }
      } else {
        response = await dispatcher.dispatch(message, conversationHistory, { mode: 'chat', sessionId, agentId });
      }

      if (!response || !response.content) {
        console.error('[IPC] No response from AI service');
        response = { content: 'Sorry, I was unable to generate a response. Please try again.', model: 'unknown' };
      }

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
      return {
        content: `Tool ${toolName} returned: ${JSON.stringify(toolResult, null, 2)}`,
        model: 'fallback'
      };
    } finally {
      markUserIdle(activitySessionId);
    }
  });

  ipcMain.handle('handle-file-drop', async (event, filePath, sessionId = null) => {
    const fs = require('fs');
    const path = require('path');
    const activitySessionId = sessionId || 'default';
    markUserActive(activitySessionId);

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

      await db.addConversation({ role: 'user', content: message }, sessionId);
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
}

module.exports = { registerChatDataHandlers };
