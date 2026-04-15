const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const PluginManager = require('../../src/main/plugin-manager');
const { MemoryDB, TestContainer, PluginCapabilityStub } = require('../helpers/fakes');

module.exports = {
  name: 'plugin-lifecycle-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const db = new MemoryDB();
    const capabilityManager = new PluginCapabilityStub();
    const mcpServer = new MCPServer(db, capabilityManager);
    const container = new TestContainer({ db, mcpServer, capabilityManager });
    const pluginManager = new PluginManager(container);

    await pluginManager.initialize();
    await pluginManager.enablePlugin('test-plugin');

    const executeResult = await mcpServer.executeTool('plugin_test_plugin_hello', { name: 'Tester' });
    assert.equal(executeResult.success, true, 'Enabled plugin tool should execute');
    assert.equal(capabilityManager.isToolActive('plugin_test_plugin_hello'), true, 'Plugin tool should be active in capability manager');

    await pluginManager.disablePlugin('test-plugin');
    assert.equal(mcpServer.tools.has('plugin_test_plugin_hello'), false, 'Disabled plugin tool should be removed');

    db.run('UPDATE plugins SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['enabled', null, 'test-plugin']);
    const restartManager = new PluginManager(container);
    await restartManager.initialize();
    assert.equal(
      mcpServer.tools.has('plugin_test_plugin_hello'),
      true,
      'Plugin marked enabled in DB should auto-enable and wire handlers on startup'
    );
    await restartManager.disablePlugin('test-plugin');

    const tempPluginId = `tmp-rollback-plugin-${Date.now()}`;
    const tempPluginDir = path.join(rootDir, 'agentin', 'plugins', tempPluginId);
    fs.mkdirSync(tempPluginDir, { recursive: true });
    fs.writeFileSync(path.join(tempPluginDir, 'plugin.json'), JSON.stringify({
      id: tempPluginId,
      name: 'Tmp Rollback Plugin',
      version: '1.0.0',
      main: 'main.js'
    }, null, 2));
    fs.writeFileSync(
      path.join(tempPluginDir, 'main.js'),
      "module.exports = { async onEnable(ctx) { ctx.registerHandler('partial', { description: 'partial', inputSchema: { type: 'object' } }, async () => 'ok'); throw new Error('boom'); } };"
    );

    try {
      const rollbackManager = new PluginManager(container);
      await rollbackManager.initialize();

      let rollbackError = null;
      try {
        await rollbackManager.enablePlugin(tempPluginId);
      } catch (error) {
        rollbackError = error;
      }

      const pluginState = rollbackManager.plugins.get(tempPluginId);
      assert.ok(rollbackError, 'Expected rollback plugin enable to fail');
      assert.equal(pluginState.status, 'error', 'Failed plugin should move to error state');
      assert.equal(pluginState.handlers.length, 0, 'Failed plugin should not retain handlers');
      assert.equal(
        mcpServer.tools.has(`plugin_${tempPluginId.replace(/-/g, '_')}_partial`),
        false,
        'Failed plugin should not leave registered tools behind'
      );
    } finally {
      fs.rmSync(tempPluginDir, { recursive: true, force: true });
    }
  }
};
