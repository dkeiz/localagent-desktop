function registerPluginKnowledgeHandlers(ipcMain, runtime) {
  const { container } = runtime;

  ipcMain.handle('plugins:list', async () => {
    const pm = container.optional('pluginManager');
    if (!pm) return [];
    return pm.listPlugins();
  });

  ipcMain.handle('plugins:enable', async (event, pluginId) => {
    const pm = container.optional('pluginManager');
    if (!pm) return { success: false, error: 'Plugin system not ready' };
    try {
      await pm.enablePlugin(pluginId);
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
