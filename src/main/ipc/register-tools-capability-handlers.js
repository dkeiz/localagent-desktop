function registerToolsCapabilityHandlers(ipcMain, runtime) {
  const {
    db,
    mcpServer,
    windowManager,
    capabilityManager,
    toolPermissionService
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
        windowManager.send('tool-permission-request', result);
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

  ipcMain.handle('set-tool-active', async (event, toolName, active, context = {}) => {
    try {
      const agentId = context?.agentId ? Number(context.agentId) : null;
      if (agentId && toolPermissionService) {
        await toolPermissionService.setAgentTool(agentId, toolName, active);
      } else {
        await db.setToolActive(toolName, active);
        if (mcpServer.setToolActiveState) {
          await mcpServer.setToolActiveState(toolName, active);
        }
        if (toolPermissionService) {
          await toolPermissionService.syncUnsafeFromGlobal();
        }

        if (active && capabilityManager) {
          const groupId = capabilityManager.getGroupForTool(toolName);
          if (groupId && !capabilityManager.isGroupEnabled(groupId)) {
            capabilityManager.setGroupEnabled(groupId, true);
            console.log(`[IPC] Auto-enabled capability group '${groupId}' because tool '${toolName}' was enabled`);
          }
          windowManager.send('capability-update', capabilityManager.getState());
        } else if (!active && capabilityManager) {
          windowManager.send('capability-update', capabilityManager.getState());
        }
      }

      console.log(`[IPC] Tool ${toolName} ${active ? 'enabled' : 'disabled'} (DB + memory)`);
      return { success: true, toolName, active, scope: agentId ? 'agent' : 'global' };
    } catch (error) {
      console.error('Failed to set tool active state:', error);
      throw error;
    }
  });

  ipcMain.handle('create-custom-tool', async (event, toolData) => {
    try {
      await mcpServer.executeTool('create_tool', toolData);
      if (capabilityManager) {
        windowManager.send('capability-update', capabilityManager.getState());
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
    windowManager.send('capability-update', capabilityManager.getState());
    return { success: true, mainEnabled: result };
  });

  ipcMain.handle('capability:set-group', async (event, groupId, enabled) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    const result = capabilityManager.setGroupEnabled(groupId, enabled);
    if (groupId === 'unsafe' && toolPermissionService) {
      await toolPermissionService.syncUnsafeFromGlobal();
    }
    windowManager.send('capability-update', capabilityManager.getState());
    return { success: result };
  });

  ipcMain.handle('capability:set-files-mode', async (event, mode) => {
    if (!capabilityManager) return { error: 'CapabilityManager not initialized' };
    try {
      const result = capabilityManager.setFilesMode(mode);
      windowManager.send('capability-update', capabilityManager.getState());
      return { success: true, mode: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('capability:get-active-tools', async (event, context = {}) => {
    if (!toolPermissionService) {
      if (!capabilityManager) return mcpServer.getActiveTools().map(t => t.name);
      return capabilityManager.getActiveTools().filter((toolName) => {
        const def = mcpServer.tools.get(toolName)?.definition;
        return def && def.internal !== true;
      });
    }
    const names = await toolPermissionService.getContextActiveToolNames(context || {});
    return names.filter((toolName) => {
      const def = mcpServer.tools.get(toolName)?.definition;
      return def && def.internal !== true;
    });
  });

  ipcMain.handle('permissions:get-context', async (event, context = {}) => {
    if (!toolPermissionService) return { error: 'ToolPermissionService not initialized' };
    return toolPermissionService.resolveContext(context);
  });

  ipcMain.handle('permissions:get-agent-profile', async (event, agentId) => {
    if (!toolPermissionService) return { error: 'ToolPermissionService not initialized' };
    return toolPermissionService.getAgentProfile(agentId);
  });

  ipcMain.handle('permissions:set-agent-group', async (event, agentId, groupId, value) => {
    if (!toolPermissionService) return { error: 'ToolPermissionService not initialized' };
    return toolPermissionService.setAgentGroup(agentId, groupId, value);
  });

  ipcMain.handle('permissions:set-agent-tool', async (event, agentId, toolName, active) => {
    if (!toolPermissionService) return { error: 'ToolPermissionService not initialized' };
    return toolPermissionService.setAgentTool(agentId, toolName, active);
  });

  ipcMain.handle('permissions:reset-agent-profile', async (event, agentId) => {
    if (!toolPermissionService) return { error: 'ToolPermissionService not initialized' };
    return toolPermissionService.resetAgentProfile(agentId);
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
