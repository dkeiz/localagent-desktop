const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { bootstrapApplication } = require('./bootstrap');
// Lazy-loaded: tools/ may not exist in Docker images (excluded by .dockerignore)
function runCheckSkins() { return require('../../tools/check-skins').runCheckSkins(); }
function runApplySimulation() { return require('../../tools/test-skin-apply').runApplySimulation(); }
const { createExternalTestControl } = require('./external-test-control');

let runtime = null;
let externalTestControl = null;
let shutdownPromise = null;
let allowImmediateQuit = false;

const args = process.argv.slice(1);
const isTestMode = args.includes('--test');
const isDevMode = args.includes('--dev');
const isNoWindowMode = args.includes('--nowindow');
const isTestClientMode = args.includes('--testclient');
const isExternalTestMode = args.includes('--external-test');
const isWindowlessMode = args.includes('--windowless') || args.includes('-windowless') || isNoWindowMode;
const externalPortArgIdx = args.indexOf('--external-port');
const externalPort = externalPortArgIdx !== -1 && args[externalPortArgIdx + 1]
  ? Number(args[externalPortArgIdx + 1])
  : 8788;

class IpcBridge {
  constructor(realIpcMain) {
    this.realIpcMain = realIpcMain;
    this.handlers = new Map();
  }

  handle(channel, fn) {
    this.handlers.set(channel, fn);
    this.realIpcMain.handle(channel, fn);
  }

  async invoke(channel, ...args) {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`Unknown IPC channel: ${channel}`);
    }
    return handler({}, ...args);
  }
}

const ipcBridge = new IpcBridge(ipcMain);

if (!app || typeof app.whenReady !== 'function') {
  if (isTestMode && isNoWindowMode) {
    console.log('[HeadlessTest] Running in Node fallback mode...');
    const started = Date.now();
    const skinCheck = runCheckSkins();
    const skinApplySimulation = runApplySimulation();
    const durationMs = Date.now() - started;
    const report = {
      mode: 'test-nowindow-node-fallback',
      durationMs,
      checks: {
        skins: skinCheck,
        skinApplySimulation
      }
    };
    console.log('[HeadlessTest] Report:');
    console.log(JSON.stringify(report, null, 2));
    process.exit(skinCheck.ok && skinApplySimulation.ok ? 0 : 1);
  } else {
    throw new Error('Electron app context is unavailable. Run this entrypoint with Electron for normal app mode.');
  }
}

async function runHeadlessSkinChecks() {
  console.log('[HeadlessTest] Starting --test --nowindow checks...');
  const started = Date.now();
  const skinCheck = runCheckSkins();
  const skinApplySimulation = runApplySimulation();
  const durationMs = Date.now() - started;
  const report = {
    mode: 'test-nowindow',
    durationMs,
    checks: {
      skins: skinCheck,
      skinApplySimulation
    }
  };
  console.log('[HeadlessTest] Report:');
  console.log(JSON.stringify(report, null, 2));
  app.exit(skinCheck.ok && skinApplySimulation.ok ? 0 : 1);
}

async function runSeedScript(container) {
  const seedIdx = process.argv.indexOf('--seed');
  if (seedIdx === -1 || !process.argv[seedIdx + 1]) {
    return;
  }

  const seedPath = path.resolve(process.argv[seedIdx + 1]);
  const db = container.get('db');
  const workflowManager = container.get('workflowManager');
  const mcpServer = container.get('mcpServer');

  console.log(`[Seed] Running seed script: ${seedPath}`);
  try {
    const seedFn = require(seedPath);
    if (typeof seedFn === 'function') {
      await seedFn({ db, workflowManager, mcpServer });
      console.log('[Seed] Seed script completed successfully');
    } else {
      console.error('[Seed] Seed script must export a function: module.exports = async ({ db, workflowManager }) => { ... }');
    }
  } catch (error) {
    console.error('[Seed] Seed script failed:', error);
  }
}

app.whenReady().then(async () => {
  try {
    // Hide native app menu in normal mode; keep it visible when explicitly running with --dev.
    if (!isDevMode && Menu && typeof Menu.setApplicationMenu === 'function') {
      Menu.setApplicationMenu(null);
    }

    if (isTestMode && isNoWindowMode) {
      await runHeadlessSkinChecks();
      return;
    }

    runtime = await bootstrapApplication({
      app,
      BrowserWindow,
      ipcMain: ipcBridge,
      args,
      isTestClientMode,
      createInitialWindow: isExternalTestMode ? !isWindowlessMode : true,
      autoStartDaemons: !isExternalTestMode
    });

    if (isExternalTestMode) {
      externalTestControl = createExternalTestControl({
        invokeIpc: (channel, ...invokeArgs) => ipcBridge.invoke(channel, ...invokeArgs),
        shutdownRuntime: async () => {
          if (runtime) {
            await runtime.shutdown();
          }
          app.exit(0);
        },
        getWindowCount: () => {
          try {
            return BrowserWindow.getAllWindows().length;
          } catch (_) {
            return -1;
          }
        },
        port: Number.isFinite(externalPort) ? externalPort : 8788,
        host: '127.0.0.1'
      });
      await externalTestControl.start();
    }

    if (isTestClientMode) {
      console.log('[TestClient] Enabled transient chat mode (--testclient)');
    }

    await runSeedScript(runtime.container);

    app.on('activate', () => {
      runtime?.handleActivate();
    });
  } catch (error) {
    console.error('Error during app initialization:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function runShutdownSequence() {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    if (externalTestControl) {
      try {
        await externalTestControl.stop();
      } finally {
        externalTestControl = null;
      }
    }

    if (runtime) {
      await runtime.shutdown();
      runtime = null;
    }
  })();

  return shutdownPromise;
}

app.on('before-quit', (event) => {
  if (allowImmediateQuit) {
    return;
  }

  event.preventDefault();
  runShutdownSequence()
    .catch(error => {
      console.error('[Main] Shutdown sequence failed:', error);
    })
    .finally(() => {
      allowImmediateQuit = true;
      app.quit();
    });
});
