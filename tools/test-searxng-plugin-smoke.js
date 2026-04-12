const fs = require('fs');
const path = require('path');
const http = require('http');

const MCPServer = require('../src/main/mcp-server');
const PluginManager = require('../src/main/plugin-manager');
const { ensureSearxngPlugin } = require('../src/main/plugin-setup-service');
const { MemoryDB, TestContainer, PluginCapabilityStub } = require('../tests/helpers/fakes');

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), 'agentin', 'plugins-smoke-'));
  const pluginsDir = path.join(tempRoot, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });

  const db = new MemoryDB();
  const capabilityManager = new PluginCapabilityStub();
  const mcpServer = new MCPServer(db, capabilityManager);
  const container = new TestContainer({ db, mcpServer, capabilityManager });
  const pluginManager = new PluginManager(container, { pluginsDir });

  const report = {
    tempRoot,
    pluginsDir,
    setup: null,
    mockServer: null,
    discover: null,
    search: null
  };

  const mockServer = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/search') {
      const query = requestUrl.searchParams.get('q') || '';
      const payload = {
        query,
        results: [
          {
            title: `Mock result for ${query}`,
            url: `https://example.com/search?q=${encodeURIComponent(query)}`,
            content: `Synthetic snippet for ${query}`,
            engines: ['mock-engine']
          },
          {
            title: `Second result for ${query}`,
            url: `https://docs.example.com/${encodeURIComponent(query)}`,
            content: `Another snippet for ${query}`,
            engines: ['mock-engine']
          }
        ],
        suggestions: [`${query} tutorial`, `${query} examples`]
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  try {
    await new Promise((resolve, reject) => {
      mockServer.listen(0, '127.0.0.1', (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    const mockAddress = mockServer.address();
    const mockBaseUrl = `http://127.0.0.1:${mockAddress.port}`;
    report.mockServer = { baseUrl: mockBaseUrl };

    ensureSearxngPlugin(pluginsDir);
    await pluginManager.initialize();
    await pluginManager.setPluginConfig('searxng-search', 'enableLocalServer', true);
    await pluginManager.setPluginConfig('searxng-search', 'baseUrl', mockBaseUrl);
    await pluginManager.setPluginConfig('searxng-search', 'discoveryUrls', mockBaseUrl);
    await pluginManager.setPluginConfig('searxng-search', 'timeoutMs', 2500);
    await pluginManager.setPluginConfig('searxng-search', 'retryCount', 0);
    await pluginManager.enablePlugin('searxng-search');
    report.setup = { pluginId: 'searxng-search', enabled: true };

    const discoverResult = await mcpServer.executeTool('plugin_searxng_search_discover', {});
    report.discover = discoverResult;

    const searchResult = await mcpServer.executeTool('plugin_searxng_search_search', {
      query: 'OpenAI API docs',
      max_results: 3
    });
    report.search = searchResult;

    const payload = searchResult?.result || {};
    const top = Array.isArray(payload.results) ? payload.results.slice(0, 3) : [];
    console.log('[SearXNG Smoke] Setup:', report.setup);
    console.log('[SearXNG Smoke] Discover ok:', discoverResult?.result?.ok === true);
    console.log('[SearXNG Smoke] Search total:', payload.total || 0);
    top.forEach((item, index) => {
      console.log(`#${index + 1}: ${item.title || '(no title)'} -> ${item.url || '(no url)'}`);
    });
    console.log('[SearXNG Smoke] Full report JSON follows');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try {
      mockServer.close();
    } catch (error) {
      console.error('[SearXNG Smoke] Mock server close failed:', error.message);
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      console.error('[SearXNG Smoke] Cleanup failed:', error.message);
    }
  }
}

run().catch((error) => {
  console.error('[SearXNG Smoke] FAILED:', error.message);
  process.exitCode = 1;
});
