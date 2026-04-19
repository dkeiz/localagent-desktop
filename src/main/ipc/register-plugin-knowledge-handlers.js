const { quickSetupPlugin } = require('../plugin-setup-service');

function registerPluginKnowledgeHandlers(ipcMain, runtime) {
  const { container, windowManager } = runtime;
  const notifyPluginStateChanged = (pluginId, source) => {
    if (!windowManager) return;
    windowManager.send('plugins:state-changed', {
      pluginId,
      source: source || 'unknown',
      at: new Date().toISOString()
    });
  };

  ipcMain.handle('plugins:list', async () => {
    const pm = container.optional('pluginManager');
    if (!pm) return [];
    return pm.listPlugins();
  });

  ipcMain.handle('plugins:scan', async () => {
    const pm = container.optional('pluginManager');
    if (!pm) return { success: false, error: 'Plugin system not ready' };
    try {
      const result = pm.rescanPlugins
        ? await pm.rescanPlugins()
        : { total: pm.listPlugins().length, added: [] };
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins:enable', async (event, pluginId) => {
    const pm = container.optional('pluginManager');
    if (!pm) return { success: false, error: 'Plugin system not ready' };
    try {
      await pm.enablePlugin(pluginId);
      notifyPluginStateChanged(pluginId, 'enable');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins:disable', async (event, pluginId) => {
    const pm = container.optional('pluginManager');
    if (!pm) return { success: false, error: 'Plugin system not ready' };
    try {
      await pm.disablePlugin(pluginId);
      notifyPluginStateChanged(pluginId, 'disable');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins:get-config', async (event, pluginId) => {
    const pm = container.optional('pluginManager');
    if (!pm) return {};
    return pm.getPluginConfig(pluginId);
  });

  ipcMain.handle('plugins:set-config', async (event, pluginId, key, value) => {
    const pm = container.optional('pluginManager');
    if (!pm) return { success: false, error: 'Plugin system not ready' };
    try {
      await pm.setPluginConfig(pluginId, key, value);
      notifyPluginStateChanged(pluginId, 'config');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins:inspect', async (event, pluginId) => {
    const pm = container.optional('pluginManager');
    if (!pm) return null;
    return pm.getPluginDetail(pluginId);
  });

  ipcMain.handle('plugins:run-action', async (event, pluginId, action, params) => {
    const pm = container.optional('pluginManager');
    if (!pm) return { success: false, error: 'Plugin system not ready' };
    try {
      const result = await pm.runPluginAction(pluginId, action, params || {});
      notifyPluginStateChanged(pluginId, `action:${action}`);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins:open-studio', async (event, options) => {
    if (!windowManager) return { success: false, error: 'Window manager not available' };
    try {
      windowManager.send('plugins:open-studio', options || {});
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins:quick-setup', async (event, pluginName) => {
    const pm = container.optional('pluginManager');
    const paths = container.optional('runtimePaths');
    if (!pm || !paths?.pluginsDir) {
      return { success: false, error: 'Plugin system not ready' };
    }
    try {
      const setup = await quickSetupPlugin({
        pluginName,
        pluginManager: pm,
        pluginsDir: paths.pluginsDir
      });

      if (windowManager) windowManager.send('plugins:open-studio', { focusPluginId: setup.pluginId });
      notifyPluginStateChanged(setup.pluginId, 'quick-setup');

      return { success: true, pluginId: setup.pluginId, enabled: setup.enabled === true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge:list', async (event, options) => {
    const km = container.optional('knowledgeManager');
    if (!km) return [];
    return km.listItems(options || {});
  });

  ipcMain.handle('knowledge:stats', async () => {
    const km = container.optional('knowledgeManager');
    if (!km) return { total: 0, active: 0, staged: 0 };
    return km.getStats();
  });

  ipcMain.handle('knowledge:confirm', async (event, slug) => {
    const km = container.optional('knowledgeManager');
    if (!km) return { success: false, error: 'Knowledge system not ready' };
    try {
      await km.promoteStaged(slug);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge:reject', async (event, slug) => {
    const km = container.optional('knowledgeManager');
    if (!km) return { success: false, error: 'Knowledge system not ready' };
    try {
      await km.rejectStaged(slug);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge:tree', async () => {
    const km = container.optional('knowledgeManager');
    if (!km) return { library: [], staging: [], stats: {} };
    return km.getKnowledgeTree();
  });
}

module.exports = { registerPluginKnowledgeHandlers };
