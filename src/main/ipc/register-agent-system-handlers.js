function registerAgentSystemHandlers(ipcMain, runtime, helpers) {
  const {
    mcpServer,
    windowManager,
    aiService,
    portListenerManager,
    agentMemory,
    agentLoop,
    connectorRuntime,
    agentManager,
    eventBus,
    memoryDaemon,
    workflowScheduler,
    sessionInitManager,
    db,
    testClientMode
  } = runtime;
  const { syncDaemonEnabledSetting } = helpers;

  ipcMain.handle('port-listener:register', async (event, config) => {
    if (!portListenerManager) return { error: 'PortListenerManager not initialized' };
    try {
      const result = await portListenerManager.register(config);
      windowManager.send('port-listener-update', portListenerManager.getListeners());
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('port-listener:unregister', async (event, port) => {
    if (!portListenerManager) return { error: 'PortListenerManager not initialized' };
    try {
      const result = await portListenerManager.unregister(port);
      windowManager.send('port-listener-update', portListenerManager.getListeners());
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('port-listener:list', async () => {
    if (!portListenerManager) return [];
    return portListenerManager.getListeners();
  });

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

  mcpServer.on('calendar-update', () => {
    windowManager.send('calendar-update');
  });

  mcpServer.on('todo-update', () => {
    windowManager.send('todo-update');
  });

  mcpServer.on('tool-executed', (eventData) => {
    windowManager.send('tool-update', eventData);
  });

  ipcMain.handle('agent-loop:memory-start', async (event, sessionId) => {
    if (!agentLoop) return null;
    return agentLoop.loadMemoryContext(sessionId);
  });

  ipcMain.handle('agent-loop:get-state', async (event, sessionId) => {
    if (!agentLoop) return { autoMemory: false };
    const session = agentLoop.getSession(sessionId);
    return { autoMemory: session.autoMemory, idleSeconds: session.idleSeconds };
  });

  ipcMain.handle('connectors:list', async () => {
    if (!connectorRuntime) return [];
    return connectorRuntime.listConnectors();
  });

  ipcMain.handle('connectors:start', async (event, name) => {
    if (!connectorRuntime) return { error: 'Connector runtime not initialized' };
    return connectorRuntime.startConnector(name);
  });

  ipcMain.handle('connectors:stop', async (event, name) => {
    if (!connectorRuntime) return { error: 'Connector runtime not initialized' };
    return connectorRuntime.stopConnector(name);
  });

  ipcMain.handle('connectors:logs', async (event, name, limit) => {
    if (!connectorRuntime) return [];
    return connectorRuntime.getLogs(name, limit);
  });

  ipcMain.handle('connectors:delete', async (event, name) => {
    if (!connectorRuntime) return { error: 'Connector runtime not initialized' };
    try { await connectorRuntime.stopConnector(name); } catch (e) {}
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(connectorRuntime.connectorsDir, `${name}.js`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true, name };
  });

  ipcMain.handle('get-agents', async (event, type = null) => {
    if (!agentManager) return [];
    return agentManager.getAgents(type);
  });

  ipcMain.handle('get-agent', async (event, id) => {
    if (!agentManager) return null;
    return agentManager.getAgent(id);
  });

  ipcMain.handle('create-agent', async (event, data) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.createAgent(data);
    windowManager.send('agent-update');
    return result;
  });

  ipcMain.handle('update-agent', async (event, id, data) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.updateAgent(id, data);
    windowManager.send('agent-update');
    return result;
  });

  ipcMain.handle('delete-agent', async (event, id) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.deleteAgent(id);
    windowManager.send('agent-update');
    return result;
  });

  ipcMain.handle('activate-agent', async (event, id) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.activateAgent(id);
    windowManager.send('agent-update');
    return result;
  });

  ipcMain.handle('deactivate-agent', async (event, id) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    await agentManager.deactivateAgent(id);
    windowManager.send('agent-update');
    return { success: true };
  });

  ipcMain.handle('compact-agent', async (event, id) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    await agentManager.compactAgent(id);
    return { success: true };
  });
  ipcMain.handle('daemon:memory-start', async () => {
    if (testClientMode) return { error: 'Disabled in --testclient mode' };
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
    if (testClientMode) return { error: 'Disabled in --testclient mode' };
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

  ipcMain.handle('daemon:add-schedule', async (event, workflowId, intervalMinutes, name) => {
    if (testClientMode) return { error: 'Disabled in --testclient mode' };
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

  ipcMain.handle('session-init:detect', async () => {
    if (!sessionInitManager) return { isColdStart: false };
    const daemonRunning = memoryDaemon ? memoryDaemon.running : false;
    return sessionInitManager.detectStartType(daemonRunning);
  });

  ipcMain.handle('session-init:cold-start-prompt', async (event, hoursInactive) => {
    if (!sessionInitManager) return null;
    return sessionInitManager.buildColdStartPrompt(hoursInactive);
  });

  ipcMain.handle('baseinit:check', async () => {
    const completed = await db.getSetting('baseinit.completed');
    return { completed: completed === 'true' };
  });

  ipcMain.handle('baseinit:run', async () => {
    if (!sessionInitManager) return { error: 'SessionInitManager not initialized' };

    try {
      const report = await sessionInitManager.buildBaseInitReport();
      if (memoryDaemon && !memoryDaemon.running) {
        await memoryDaemon.start();
      }
      if (workflowScheduler && !workflowScheduler.running) {
        await workflowScheduler.start();
      }
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

  ipcMain.handle('eventbus:get-log', async (event, category, limit) => {
    if (!eventBus) return [];
    return eventBus.getLog(category, limit);
  });
}

module.exports = { registerAgentSystemHandlers };
