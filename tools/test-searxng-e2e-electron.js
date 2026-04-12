const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { bootstrapApplication } = require('../src/main/bootstrap');

class HarnessIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, fn) {
    this.handlers.set(channel, fn);
  }

  async invoke(channel, ...args) {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`Missing IPC handler: ${channel}`);
    }
    return handler({}, ...args);
  }
}

async function run() {
  const ipcMain = new HarnessIpcMain();
  const dbPath = path.join(os.tmpdir(), `localagent-searxng-e2e-${Date.now()}.db`);

  const runtime = await bootstrapApplication({
    app,
    BrowserWindow,
    ipcMain,
    dbPath,
    createInitialWindow: false,
    autoStartDaemons: false
  });

  try {
    const list = await ipcMain.invoke('plugins:list');
    const hasSearxng = Array.isArray(list) && list.some((p) => p.id === 'searxng-search');
    if (!hasSearxng) {
      const setup = await ipcMain.invoke('plugins:quick-setup', 'searxng');
      if (!setup?.success) {
        throw new Error(`quick-setup failed: ${setup?.error || 'unknown error'}`);
      }
    }

    await ipcMain.invoke('plugins:disable', 'searxng-search');
    await ipcMain.invoke('plugins:set-config', 'searxng-search', 'enableLocalServer', true);
    await ipcMain.invoke('plugins:set-config', 'searxng-search', 'localServerPort', 8796);
    await ipcMain.invoke('plugins:set-config', 'searxng-search', 'timeoutMs', 4500);
    await ipcMain.invoke('plugins:set-config', 'searxng-search', 'retryCount', 0);
    await ipcMain.invoke('plugins:set-config', 'searxng-search', 'backendMode', 'remote');
    await ipcMain.invoke('plugins:set-config', 'searxng-search', 'baseUrl', 'https://searx.be');
    await ipcMain.invoke('plugins:set-config', 'searxng-search', 'discoveryUrls', 'https://searx.be');

    const enable = await ipcMain.invoke('plugins:enable', 'searxng-search');
    if (!enable?.success) {
      throw new Error(`enable failed: ${enable?.error || 'unknown error'}`);
    }

    const status = await ipcMain.invoke('plugins:run-action', 'searxng-search', 'server_status', {});
    if (!status?.success) {
      throw new Error(`server_status failed: ${status?.error || 'unknown error'}`);
    }

    const search = await ipcMain.invoke('execute-mcp-tool', 'plugin_searxng_search_search', {
      query: 'OpenAI API docs',
      max_results: 5
    });
    if (!search?.success) {
      throw new Error(`search tool failed: ${search?.error || 'unknown error'}`);
    }

    const payload = search.result?.result || search.result || {};
    const results = Array.isArray(payload.results) ? payload.results : [];
    if (results.length === 0) {
      throw new Error(`search returned no results: ${JSON.stringify(payload)}`);
    }

    console.log('[searxng-e2e] PASS');
    console.log('[searxng-e2e] source=', payload.source);
    console.log('[searxng-e2e] total=', payload.total || results.length);
    results.slice(0, 3).forEach((item, index) => {
      console.log(`#${index + 1}: ${item.title || '(no title)'} -> ${item.url || '(no url)'}`);
    });

    await ipcMain.invoke('plugins:disable', 'searxng-search');
  } finally {
    await runtime.shutdown();
  }
}

app.whenReady().then(async () => {
  try {
    await run();
    app.exit(0);
  } catch (error) {
    console.error('[searxng-e2e] FAIL:', error.message || error);
    try {
      app.exit(1);
    } catch (_) {
      process.exit(1);
    }
  }
});
