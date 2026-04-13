const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const assert = require('../helpers/assert');

const ROOT = path.resolve(__dirname, '..', '..');
const HOST = '127.0.0.1';
const PORT = 8788;
const BASE_URL = `http://${HOST}:${PORT}`;
const TEST_TIMEOUT_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(method, route, payload = null, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request(
      `${BASE_URL}${route}`,
      {
        method,
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body)
            }
          : undefined,
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode || 0, data: parsed });
          } catch (error) {
            reject(new Error(`Invalid JSON response from ${route}: ${error.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Request timeout: ${method} ${route}`)));
    if (body) req.write(body);
    req.end();
  });
}

async function invokeIpc(channel, args = []) {
  const response = await requestJson('POST', '/invoke', { channel, args });
  assert.equal(response.status, 200, `IPC ${channel} failed with HTTP ${response.status}`);
  assert.ok(response.data && response.data.success === true, `IPC ${channel} returned error`);
  return response.data.result;
}

async function waitForHealth(deadlineMs) {
  while (Date.now() < deadlineMs) {
    try {
      const response = await requestJson('GET', '/health', null, 2_000);
      if (response.status === 200 && response.data && response.data.ok) {
        return response.data;
      }
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('External test server did not become healthy in time');
}

async function waitForSubagentTerminal(runId, deadlineMs) {
  while (Date.now() < deadlineMs) {
    const events = await invokeIpc('eventbus:get-log', ['agent', 200]);
    const forRun = (Array.isArray(events) ? events : []).filter((event) => {
      const payload = event && event.payload ? event.payload : {};
      return payload.runId === runId || payload.run_id === runId;
    });
    const terminal = forRun.find((event) => event.type === 'subagent:completed' || event.type === 'subagent:failed');
    if (terminal) {
      return { terminal, events: forRun };
    }
    await sleep(700);
  }
  throw new Error(`Timed out waiting terminal subagent event for ${runId}`);
}

async function shutdownExternalServer() {
  try {
    await requestJson('POST', '/shutdown', {});
  } catch (_) {}
}

async function run() {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  let proc;
  if (process.platform === 'win32') {
    proc = spawn('cmd.exe', ['/d', '/s', '/c', 'set ELECTRON_RUN_AS_NODE=&& npm run start:test:external'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } else {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    proc = spawn('npm', ['run', 'start:test:external'], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
  let spawnError = null;
  proc.on('error', (error) => {
    spawnError = error;
  });

  let capturedOut = '';
  let capturedErr = '';
  proc.stdout.on('data', (chunk) => {
    capturedOut += chunk.toString('utf-8');
  });
  proc.stderr.on('data', (chunk) => {
    capturedErr += chunk.toString('utf-8');
  });

  try {
    if (spawnError) {
      throw new Error(`Failed to spawn external app: ${spawnError.message}`);
    }
    const health = await waitForHealth(deadline);
    assert.equal(health.windowCount, 0, 'Expected windowless external mode (windowCount=0)');

    const subagents = await invokeIpc('get-agents', ['sub']);
    const list = Array.isArray(subagents) ? subagents : [];
    assert.ok(list.length > 0, 'No sub-agents available');
    const agent = list[0];

    for (const mode of ['no_ui', 'ui']) {
      const invokeResult = await invokeIpc('execute-mcp-tool', [
        'run_subagent',
        {
          agent_id: agent.id,
          task: 'Return task complete with summary ping ok and include mode echo in output.',
          contract_type: 'task_complete',
          subagent_mode: mode
        }
      ]);

      assert.ok(invokeResult && invokeResult.success === true, `execute-mcp-tool failed for mode=${mode}`);
      const toolPayload = invokeResult.result || {};
      assert.ok(toolPayload && toolPayload.success === true, `run_subagent tool returned failure for mode=${mode}`);
      const runMeta = toolPayload.result || {};
      const runId = String(runMeta.run_id || runMeta.runId || '');
      assert.ok(runId, `run_subagent returned empty run id for mode=${mode}: ${JSON.stringify(runMeta)}`);

      const { terminal, events } = await waitForSubagentTerminal(runId, deadline);
      const types = events.map((event) => event.type);
      assert.includes(types, 'subagent:queued', `Missing queued event for ${runId}`);
      assert.includes(types, 'subagent:started', `Missing started event for ${runId}`);
      assert.equal(terminal.type, 'subagent:completed', `Subagent did not complete for mode=${mode}`);
      assert.equal(String(terminal.payload?.subagentMode || ''), mode, `Mode mismatch for ${runId}`);
    }

    console.log('[external-test:subagent] PASS dual-mode run_subagent flow');
  } catch (error) {
    console.error('[external-test:subagent] FAIL:', error.message);
    if (capturedOut.trim()) {
      console.error('[external-test:subagent] app-stdout-tail:');
      console.error(capturedOut.slice(-3000));
    }
    if (capturedErr.trim()) {
      console.error('[external-test:subagent] app-stderr-tail:');
      console.error(capturedErr.slice(-3000));
    }
    throw error;
  } finally {
    await shutdownExternalServer();
    await sleep(800);
    if (!proc.killed) {
      try {
        proc.kill('SIGTERM');
      } catch (_) {}
    }
  }
}

run().catch((error) => {
  if (error) {
    console.error('[external-test:subagent] FATAL:', error.message || String(error));
  }
  process.exit(1);
});
