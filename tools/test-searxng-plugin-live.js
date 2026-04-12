const fs = require('fs');
const path = require('path');

const MCPServer = require('../src/main/mcp-server');
const PluginManager = require('../src/main/plugin-manager');
const { ensureSearxngPlugin } = require('../src/main/plugin-setup-service');
const { MemoryDB, TestContainer, PluginCapabilityStub } = require('../tests/helpers/fakes');

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), 'agentin', 'plugins-live-'));
  const pluginsDir = path.join(tempRoot, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });

  const db = new MemoryDB();
  const capabilityManager = new PluginCapabilityStub();
  const mcpServer = new MCPServer(db, capabilityManager);
  const container = new TestContainer({ db, mcpServer, capabilityManager });
  const pluginManager = new PluginManager(container, { pluginsDir });

  try {
    ensureSearxngPlugin(pluginsDir);
    await pluginManager.initialize();
    await pluginManager.setPluginConfig('searxng-search', 'enableLocalServer', true);
    await pluginManager.setPluginConfig('searxng-search', 'baseUrl', 'https://searx.be');
    await pluginManager.setPluginConfig('searxng-search', 'discoveryUrls', 'https://searx.be');
    await pluginManager.setPluginConfig('searxng-search', 'timeoutMs', 4500);
    await pluginManager.setPluginConfig('searxng-search', 'retryCount', 0);
    await pluginManager.setPluginConfig('searxng-search', 'defaultMaxResults', 5);
    await pluginManager.enablePlugin('searxng-search');

    const discover = await mcpServer.executeTool('plugin_searxng_search_discover', {});
    const status = await mcpServer.executeTool('plugin_searxng_search_server_status', {});
    const search = await mcpServer.executeTool('plugin_searxng_search_search', {
      query: 'OpenAI API',
      max_results: 5
    });

    const discoverPayload = discover?.result || {};
    const statusPayload = status?.result || {};
    const searchPayload = search?.result || {};
    const results = Array.isArray(searchPayload.results) ? searchPayload.results : [];

    if (!discoverPayload.ok) {
      throw new Error(`Discovery failed: ${JSON.stringify(discoverPayload)}`);
    }
    if (!statusPayload.running) {
      throw new Error(`Local server not running: ${JSON.stringify(statusPayload)}`);
    }
    if (!results.length) {
      throw new Error(`Search returned no results: ${JSON.stringify(searchPayload)}`);
    }

    console.log('[SearXNG Live] PASS discovery selected:', discoverPayload.selected);
    console.log('[SearXNG Live] PASS local server:', statusPayload.local_server_url);
    console.log('[SearXNG Live] PASS search total:', searchPayload.total || results.length);
    results.slice(0, 3).forEach((item, index) => {
      console.log(`#${index + 1}: ${item.title || '(no title)'} -> ${item.url || '(no url)'}`);
    });
  } finally {
    try {
      await pluginManager.disableAll();
    } catch (_) {}
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((error) => {
  console.error('[SearXNG Live] FAIL:', error.message || error);
  process.exit(1);
});
