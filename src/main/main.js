const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { bootstrapApplication } = require('./bootstrap');
const { runCheckSkins } = require('../../tools/check-skins');
const { runApplySimulation } = require('../../tools/test-skin-apply');

let runtime = null;

const args = process.argv.slice(1);
const isTestMode = args.includes('--test');
const isNoWindowMode = args.includes('--nowindow');
const isTestClientMode = args.includes('--testclient');

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
    if (isTestMode && isNoWindowMode) {
      await runHeadlessSkinChecks();
      return;
    }

    runtime = await bootstrapApplication({
      app,
      BrowserWindow,
      ipcMain,
      args,
      isTestClientMode
    });

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

app.on('before-quit', async () => {
  if (runtime) {
    await runtime.shutdown();
  }
});
