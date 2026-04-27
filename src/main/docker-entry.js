/**
 * Docker / headless entry point for LocalAgent.
 *
 * Runs the full application stack WITHOUT Electron — intended for
 * Docker containers, CI, and any environment where a GUI is not needed.
 *
 * Usage:  node src/main/docker-entry.js [--external-port 8788]
 */

const path = require('path');
const { bootstrapApplication } = require('./bootstrap');
const { createExternalTestControl } = require('./external-test-control');
const { createStaticWindowManager } = require('./window-manager');

// --------------- Parse CLI args ---------------
const args = process.argv.slice(2);
const portArgIdx = args.indexOf('--external-port');
const port = portArgIdx !== -1 && args[portArgIdx + 1]
  ? Number(args[portArgIdx + 1])
  : 8788;

// --------------- Minimal IPC bridge (no Electron) ---------------
class HeadlessIpcBridge {
  constructor() {
    this.handlers = new Map();
  }
  handle(channel, fn) {
    this.handlers.set(channel, fn);
  }
  async invoke(channel, ...invokeArgs) {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`Unknown IPC channel: ${channel}`);
    }
    return handler({}, ...invokeArgs);
  }
}

// --------------- Main ---------------
(async () => {
  console.log('[Docker] Starting LocalAgent in headless mode …');

  const ipcBridge = new HeadlessIpcBridge();
  const windowManager = createStaticWindowManager(null);

  const dbPath = path.join(__dirname, '../../data/localagent.db');

  let runtime;
  try {
    runtime = await bootstrapApplication({
      app: null,                       // no Electron app object
      BrowserWindow: null,             // no GUI windows
      ipcMain: ipcBridge,
      windowManager,
      dbPath,                          // explicit path — avoids require('electron').app
      args: ['--external-test', '--windowless'],
      isTestClientMode: false,
      createInitialWindow: false,
      autoStartDaemons: true
    });
  } catch (err) {
    console.error('[Docker] Bootstrap failed:', err);
    process.exit(1);
  }

  // Start the HTTP control API
  const control = createExternalTestControl({
    invokeIpc: (channel, ...a) => ipcBridge.invoke(channel, ...a),
    shutdownRuntime: async () => {
      if (runtime) {
        await runtime.shutdown();
      }
      process.exit(0);
    },
    getWindowCount: () => 0,
    port,
    host: '0.0.0.0'     // listen on all interfaces so Docker can map the port
  });

  try {
    await control.start();
    console.log(`[Docker] LocalAgent is ready — API at http://0.0.0.0:${port}`);
    console.log('[Docker] Health check: GET /health');
    console.log('[Docker] Send message: POST /invoke  { "channel": "...", "args": [...] }');
  } catch (err) {
    console.error('[Docker] Failed to start HTTP control API:', err);
    process.exit(1);
  }

  // Graceful shutdown on SIGTERM / SIGINT
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      console.log(`[Docker] Received ${signal}, shutting down …`);
      try {
        await control.stop();
        if (runtime) await runtime.shutdown();
      } catch (e) {
        console.error('[Docker] Error during shutdown:', e);
      }
      process.exit(0);
    });
  }
})();
