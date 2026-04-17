const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const assert = require('../helpers/assert');

const ROOT = path.resolve(__dirname, '..', '..');
const HOST = '127.0.0.1';
const PORT = 8788;
const BASE_URL = `http://${HOST}:${PORT}`;
const REQUESTED_MODEL = process.env.OLLAMA_TEST_MODEL || 'openai/gpt-oss-120b:cloud';
const SEARCH_QUERY = process.env.SUBAGENT_LIVE_SEARCH_QUERY || 'site:openai.com OpenAI API docs';
const TEST_TIMEOUT_MS = Number.parseInt(process.env.SUBAGENT_LIVE_TIMEOUT_MS || '90000', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(method, route, payload = null, timeoutMs = 8000) {
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
            resolve({
              status: res.statusCode || 0,
              data: raw ? JSON.parse(raw) : {}
            });
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

async function invokeIpc(channel, args = [], timeoutMs = 8000) {
  const response = await requestJson('POST', '/invoke', { channel, args }, timeoutMs);
  assert.equal(response.status, 200, `IPC ${channel} failed with HTTP ${response.status}`);
  assert.ok(response.data && response.data.success === true, `IPC ${channel} returned error`);
  return response.data.result;
}

async function waitForHealth(deadlineMs) {
  while (Date.now() < deadlineMs) {
    try {
      const response = await requestJson('GET', '/health', null, 2000);
      if (response.status === 200 && response.data && response.data.ok) {
        return response.data;
      }
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('External test server did not become healthy in time');
}

async function shutdownExternalServer() {
  try {
    await requestJson('POST', '/shutdown', {});
  } catch (_) {}
}

function chooseModel(models) {
  const list = Array.isArray(models)
    ? models.map((model) => String(model || '').trim()).filter(Boolean)
    : [];

  if (list.length === 0) {
    throw new Error('No Ollama models discovered for live subagent search test');
  }

  if (list.includes(REQUESTED_MODEL)) {
    return REQUESTED_MODEL;
  }

  const cloudMatch = list.find((model) => model.includes(':cloud') || model.includes('-cloud'));
  return cloudMatch || list[0];
}

async function waitForParentDelivery(sessionId, needle, deadlineMs) {
  while (Date.now() < deadlineMs) {
    const conversations = await invokeIpc('load-chat-session', [sessionId]);
    const messages = Array.isArray(conversations) ? conversations : [];
    const match = messages.find((message) => {
      const content = String(message?.content || '');
      return message?.role === 'system' && content.includes(needle);
    });
    if (match) {
      return { message: match, messages };
    }
    await sleep(700);
  }

  throw new Error(`Timed out waiting parent delivery message containing "${needle}"`);
}

async function waitForSubagentEvent(runId, deadlineMs) {
  while (Date.now() < deadlineMs) {
    const events = await invokeIpc('eventbus:get-log', ['agent', 200]);
    const list = Array.isArray(events) ? events : [];
    const relevant = list.filter((event) => {
      const payload = event?.payload || {};
      return payload.runId === runId || payload.run_id === runId;
    });
    const terminal = relevant.find((event) => event.type === 'subagent:completed' || event.type === 'subagent:failed');
    if (terminal) {
      return { terminal, events: relevant };
    }
    await sleep(700);
  }

  throw new Error(`Timed out waiting subagent event for ${runId}`);
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
  let createdAgentId = null;
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
    assert.equal(health.windowCount, 0, 'Expected windowless no-UI external mode');

    await invokeIpc('capability:set-main', [true]);
    await invokeIpc('capability:set-group', ['web', true]);
    await invokeIpc('capability:set-group', ['agent', true]);

    const models = await invokeIpc('llm:get-models', ['ollama', true], 15000);
    const model = chooseModel(models);
    console.log(`[external-test:subagent-live-search] INFO model=${model}`);

    const saveConfig = await invokeIpc('llm:save-config', [{
      provider: 'ollama',
      model
    }], 15000);
    assert.equal(saveConfig.success, true, 'Expected llm:save-config to succeed');

    const session = await invokeIpc('create-chat-session', []);
    assert.ok(session && session.id, 'Expected parent chat session');
    await invokeIpc('switch-chat-session', [session.id]);

    const agentName = `Live Search Verifier ${Date.now()}`;
    const createdAgent = await invokeIpc('create-agent', [{
      name: agentName,
      type: 'sub',
      icon: '🧪',
      description: 'Live no-ui search verifier',
      system_prompt: [
        'You are a delegated live-search verification sub-agent.',
        'You must use the search_web_bing tool for the assigned search query before finishing.',
        'Do not answer from memory.',
        'When complete_subtask is available, finish with it exactly once.',
        'Your completion data object must include: query, results_count, titles, urls, evidence_tool.',
        'Copy titles and urls directly from real tool results without inventing or normalizing them.'
      ].join(' ')
    }]);
    assert.ok(createdAgent && createdAgent.id, 'Expected temporary live subagent to be created');
    createdAgentId = createdAgent.id;

    const subagentResult = await invokeIpc('execute-mcp-tool', [
      'subagent',
      {
        action: 'run',
        id: createdAgent.id,
        task: [
          `Search the live web for the exact query: "${SEARCH_QUERY}".`,
          'Use search_web_bing.',
          'Return up to 3 titles and matching urls from the real search results.',
          'If no results are returned, fail the task.'
        ].join(' '),
        contract_type: 'task_complete',
        subagent_mode: 'no_ui',
        wait: true,
        timeout_ms: Math.max(15000, TEST_TIMEOUT_MS - 15000)
      }
    ], Math.max(15000, TEST_TIMEOUT_MS - 5000));

    assert.ok(subagentResult && subagentResult.success === true, 'Expected execute-mcp-tool(subagent) to succeed');
    const toolEnvelope = subagentResult.result || {};
    assert.ok(toolEnvelope && toolEnvelope.success === true, 'Expected subagent MCP tool to report success');

    const runMeta = toolEnvelope.result || {};
    const runId = String(runMeta.run_id || runMeta.runId || '');
    const childSessionId = String(runMeta.child_session_id || runMeta.childSessionId || runMeta.run?.child_session_id || '');
    const contract = runMeta.contract || runMeta.result?.contract || null;

    assert.ok(runId, `Expected run id in subagent tool result: ${JSON.stringify(runMeta)}`);
    assert.ok(childSessionId, 'Expected child session id from waited subagent run');
    assert.ok(contract, 'Expected waited subagent run to return final contract');
    assert.equal(contract.status, 'task_complete', 'Expected successful subagent completion contract');
    assert.ok(
      String(contract.data.evidence_tool || '').toLowerCase().includes('bing'),
      `Expected evidence of real web-search tool usage: ${JSON.stringify(contract.data)}`
    );
    assert.ok(
      String(contract.data.query || '').toLowerCase().includes('openai api docs'),
      `Expected returned query echo: ${JSON.stringify(contract.data)}`
    );
    assert.ok(Number(contract.data.results_count) > 0, `Expected at least one live search result: ${JSON.stringify(contract.data)}`);
    assert.ok(Array.isArray(contract.data.urls) && contract.data.urls.length > 0, 'Expected returned result URLs');
    assert.ok(Array.isArray(contract.data.titles) && contract.data.titles.length > 0, 'Expected returned result titles');
    assert.ok(/^https?:\/\//i.test(String(contract.data.urls[0] || '')), 'Expected first returned URL to look real');
    assert.ok(
      contract.data.urls.some((url) => String(url || '').toLowerCase().includes('openai.com')),
      `Expected at least one returned URL to be relevant to query: ${JSON.stringify(contract.data.urls)}`
    );

    const childMessages = await invokeIpc('load-chat-session', [childSessionId]);
    const childList = Array.isArray(childMessages) ? childMessages : [];
    assert.ok(
      childList.some((message) => String(message?.content || '').includes('Tool search_web_bing succeeded')),
      'Expected child session to persist real search tool execution'
    );
    assert.ok(
      !childList.some((message) => String(message?.content || '').includes('TOOL:complete_subtask')),
      'Expected child session history to hide raw completion tool lines'
    );

    const { terminal, events } = await waitForSubagentEvent(runId, deadline);
    assert.equal(terminal.type, 'subagent:completed', `Expected completed lifecycle event: ${JSON.stringify(terminal)}`);
    assert.ok(events.some((event) => event.type === 'subagent:queued'), 'Expected queued event');
    assert.ok(events.some((event) => event.type === 'subagent:started'), 'Expected started event');
    assert.equal(String(terminal.payload?.subagentMode || ''), 'no_ui', 'Expected no_ui mode in terminal event');

    const parentDelivery = await waitForParentDelivery(session.id, 'Structured Result:', deadline);
    const parentContent = String(parentDelivery.message?.content || '');
    assert.includes(parentContent, agentName, 'Expected parent delivery to name the subagent');
    assert.includes(parentContent, String(contract.data.urls[0]), 'Expected parent delivery to include returned URL');

    console.log('[external-test:subagent-live-search] PASS');
    console.log(`[external-test:subagent-live-search] run_id=${runId}`);
    console.log(`[external-test:subagent-live-search] query=${SEARCH_QUERY}`);
    console.log(`[external-test:subagent-live-search] top_url=${contract.data.urls[0]}`);
  } catch (error) {
    console.error('[external-test:subagent-live-search] FAIL:', error.message);
    if (capturedOut.trim()) {
      console.error('[external-test:subagent-live-search] app-stdout-tail:');
      console.error(capturedOut.slice(-4000));
    }
    if (capturedErr.trim()) {
      console.error('[external-test:subagent-live-search] app-stderr-tail:');
      console.error(capturedErr.slice(-4000));
    }
    throw error;
  } finally {
    if (createdAgentId) {
      try {
        await invokeIpc('delete-agent', [createdAgentId], 15000);
      } catch (cleanupError) {
        console.error('[external-test:subagent-live-search] cleanup delete-agent failed:', cleanupError.message || String(cleanupError));
      }
    }
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
    console.error('[external-test:subagent-live-search] FATAL:', error.message || String(error));
  }
  process.exit(1);
});
