const path = require('path');

const assert = require('../tests/helpers/assert');
const {
  invokeIpc,
  shutdownExternalApp,
  startExternalApp,
  waitForHealth
} = require('../tests/helpers/external-app-control');

const ROOT = path.resolve(__dirname, '..');
const EXTERNAL_PORT = Number(process.env.TTS_EXTERNAL_PORT || 8792);
const PIPER_SOURCE_DIR = process.env.TTS_PIPER_SOURCE_DIR || '';
const PYTHON_COMMAND = process.env.TTS_PYTHON_COMMAND || 'python';

if (!PIPER_SOURCE_DIR) {
  throw new Error('Set TTS_PIPER_SOURCE_DIR to run the Piper TTS smoke test.');
}

async function pluginAction(baseUrl, action, params = {}, timeoutMs = 30000) {
  const envelope = await invokeIpc(baseUrl, 'plugins:run-action', ['http-tts-bridge', action, params], timeoutMs);
  assert.equal(envelope.success, true, `Expected plugin action ${action} to succeed: ${JSON.stringify(envelope)}`);
  return envelope.result;
}

async function waitForPluginBackendReady(baseUrl, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    lastStatus = await pluginAction(baseUrl, 'getBackendStatus');
    if (lastStatus?.ready && lastStatus?.healthy) {
      return lastStatus;
    }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new Error(`Plugin backend did not become ready in time: ${JSON.stringify(lastStatus)}`);
}

async function consumeStreamPlan(plan) {
  const response = await fetch(plan.url, {
    method: plan.method || 'POST',
    headers: plan.headers || {},
    body: JSON.stringify(plan.body || {})
  });
  assert.equal(response.ok, true, `Expected stream request to succeed: HTTP ${response.status}`);
  assert.ok(response.body, 'Expected stream response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let sawChunk = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    while (raw.includes('\n\n')) {
      const boundary = raw.indexOf('\n\n');
      const block = raw.slice(0, boundary);
      raw = raw.slice(boundary + 2);
      if (block.includes('event: chunk')) {
        sawChunk = true;
      }
      if (block.includes('event: done')) {
        return sawChunk;
      }
    }
  }
  return sawChunk;
}

async function run() {
  const external = startExternalApp({ rootDir: ROOT, port: EXTERNAL_PORT });
  try {
    const health = await waitForHealth(external.baseUrl, 60000);
    assert.equal(health.windowCount, 0, 'Expected windowless external smoke mode');

    await invokeIpc(external.baseUrl, 'plugins:set-config', ['http-tts-bridge', 'pythonCommand', PYTHON_COMMAND]);
    await invokeIpc(external.baseUrl, 'plugins:set-config', ['http-tts-bridge', 'piperSourceDir', PIPER_SOURCE_DIR]);
    await invokeIpc(external.baseUrl, 'plugins:set-config', ['http-tts-bridge', 'backendAutoStart', 'false']);
    await invokeIpc(external.baseUrl, 'plugins:enable', ['http-tts-bridge']);

    await pluginAction(external.baseUrl, 'importPiperAssets', {}, 60000);
    await pluginAction(external.baseUrl, 'restartBackend', {}, 60000);
    await waitForPluginBackendReady(external.baseUrl, 60000);

    const models = await pluginAction(external.baseUrl, 'getModels', {}, 60000);
    const piper = (models.items || []).find(item => item.id === 'piper:en_US-lessac-medium');
    assert.ok(piper?.local_available, `Expected Piper voice to be available locally: ${JSON.stringify(piper)}`);

    const savedSettings = await invokeIpc(external.baseUrl, 'tts:save-settings', [{
      defaultPluginId: 'http-tts-bridge',
      provider: 'piper',
      voice: 'piper:en_US-lessac-medium',
      autoSpeak: true,
      autoSpeakMode: 'answer'
    }]);
    assert.equal(savedSettings.success, true, 'Expected TTS settings save to succeed');

    const preview = await pluginAction(external.baseUrl, 'previewVoice', {
      text: 'Piper smoke test on this machine.',
      provider: 'piper',
      voice: 'piper:en_US-lessac-medium'
    }, 120000);
    assert.ok(preview.audioBase64 && preview.audioBase64.length > 1000, 'Expected preview audio payload from Piper');

    const streamPlan = await pluginAction(external.baseUrl, 'getStreamPlan', {
      text: 'Streaming piper smoke test.',
      provider: 'piper',
      voice: 'piper:en_US-lessac-medium'
    }, 120000);
    const streamed = await consumeStreamPlan(streamPlan);
    assert.equal(streamed, true, 'Expected Piper stream plan to emit at least one chunk');

    const speak = await invokeIpc(external.baseUrl, 'tts:speak', [{
      text: 'Piper service path smoke test.',
      provider: 'piper',
      voice: 'piper:en_US-lessac-medium'
    }], 120000);
    assert.equal(speak.success, true, `Expected tts:speak to succeed: ${JSON.stringify(speak)}`);

    const afterModels = await pluginAction(external.baseUrl, 'getModels', {}, 30000);
    assert.equal(afterModels.loaded_tts_engine, 'piper', `Expected Piper runtime engine: ${JSON.stringify(afterModels)}`);

    console.log(`[piper-smoke] status=${piper?.status} loaded_engine=${afterModels.loaded_tts_engine}`);
  } finally {
    await shutdownExternalApp(external.baseUrl);
  }
}

run().catch(error => {
  console.error('[piper-smoke] FAILED', error);
  process.exit(1);
});
