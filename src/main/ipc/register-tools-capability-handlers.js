function registerToolsCapabilityHandlers(ipcMain, runtime) {
  const {
    db,
    mcpServer,
    mainWindow,
    capabilityManager
  } = runtime;

  ipcMain.handle('execute-tool', async (event, toolName, params) => {
    try {
      const result = await mcpServer.executeTool(toolName, params);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-mcp-tools', async () => mcpServer.getTools());
  ipcMain.handle('get-mcp-tools-documentation', async () => mcpServer.getToolsDocumentation());
  ipcMain.handle('get-tool-groups', async () => mcpServer.getToolGroups());

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

  ipcMain.handle('get-active-tools', async () => mcpServer.getActiveTools());

  ipcMain.handle('execute-mcp-tool', async (event, toolName, params) => {
    try {
      const result = await mcpServer.executeTool(toolName, params);
      if (result.needsPermission) {
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
      const result = await mcpServer.executeTool(toolName, params, null, { bypassPermissions: true });
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

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
      if (mcpServer.setToolActiveState) {
        await mcpServer.setToolActiveState(toolName, active);
      }

      if (active && capabilityManager) {
        const groupId = capabilityManager.getGroupForTool(toolName);
        if (groupId && !capabilityManager.isGroupEnabled(groupId)) {
          capabilityManager.setGroupEnabled(groupId, true);
          console.log(`[IPC] Auto-enabled capability group '${groupId}' because tool '${toolName}' was enabled`);
        }
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
      if (capabilityManager) {
        capabilityManager.customToolSafety.delete(toolName);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('capability:get-state', async () => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    return capabilityManager.getState();
  });

  ipcMain.handle('capability:get-groups', async () => {
    if (!capabilityManager) return [];
    return capabilityManager.getGroupsConfig();
  });

  ipcMain.handle('capability:set-main', async (event, enabled) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    const result = capabilityManager.setMainEnabled(enabled);
    mainWindow.webContents.send('capability-update', capabilityManager.getState());
    return { success: true, mainEnabled: result };
  });

  ipcMain.handle('capability:set-group', async (event, groupId, enabled) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    const result = capabilityManager.setGroupEnabled(groupId, enabled);
    mainWindow.webContents.send('capability-update', capabilityManager.getState());
    return { success: result };
  });

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

  ipcMain.handle('capability:get-active-tools', async () => {
    if (!capabilityManager) return mcpServer.getActiveTools().map(t => t.name);
    return capabilityManager.getActiveTools();
  });

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

  ipcMain.handle('capability:set-custom-tool-safe', async (event, toolName, isSafe) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    capabilityManager.setCustomToolSafe(toolName, isSafe);
    return { success: true };
  });
}

module.exports = { registerToolsCapabilityHandlers };
