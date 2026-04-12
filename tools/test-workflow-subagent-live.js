const os = require('os');
const path = require('path');
const axios = require('axios');
const { app, BrowserWindow } = require('electron');
const { bootstrapApplication } = require('../src/main/bootstrap');

const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const REQUESTED_MODEL = process.env.OLLAMA_TEST_MODEL || 'qwen2.5:0.5b';

async function resolveLiveModel() {
  const tags = await axios.get(`${BASE_URL}/api/tags`, { timeout: 8000 });
  const names = (tags.data.models || []).map(model => String(model.name || '').trim()).filter(Boolean);
  if (names.length === 0) {
    throw new Error('No Ollama models installed');
  }

  if (names.includes(REQUESTED_MODEL)) {
    return REQUESTED_MODEL;
  }

  const nonCloud = names.find(name => !name.includes(':cloud') && !name.includes('-cloud'));
  return nonCloud || names[0];
}

async function run() {
  const model = await resolveLiveModel();
  console.log(`[workflow-subagent-live] INFO: model=${model}`);

  const dbPath = path.join(os.tmpdir(), `localagent-live-${Date.now()}.db`);
  const runtime = await bootstrapApplication({
    app,
    dbPath,
    BrowserWindow,
    createInitialWindow: false,
    autoStartDaemons: false
  });

  const container = runtime.container;
  const db = container.get('db');
  const workflowManager = container.get('workflowManager');
  const agentManager = container.get('agentManager');

  await db.saveSetting('llm.provider', 'ollama');
  await db.saveSetting('llm.model', model);
  await db.saveSetting('llm.lastWorkingProvider', 'ollama');
  await db.saveSetting('llm.lastWorkingModel', model);

  const workflow = await workflowManager.captureWorkflow(
    'live workflow ping',
    [{ tool: 'current_time', params: {} }],
    'Live Workflow Test'
  );
  const workflowRun = await workflowManager.runWorkflow(workflow.id, { mode: 'sync' });
  if (!workflowRun || workflowRun.status !== 'completed') {
    throw new Error(`Workflow run failed: ${JSON.stringify(workflowRun || {})}`);
  }
  console.log(`[workflow-subagent-live] PASS workflow run_id=${workflowRun.run_id} status=${workflowRun.status}`);

  const session = await db.getCurrentSession();
  if (!session || !session.id) {
    throw new Error('No current session available');
  }

  const sub = await agentManager.createAgent({
    name: 'Live Subagent',
    type: 'sub',
    icon: '🧪',
    system_prompt: 'Return strict JSON only when requested by the task contract.',
    description: 'Temporary live test subagent'
  });

  const ack = await agentManager.invokeSubAgent(
    session.id,
    sub.id,
    'Return a valid completion JSON with status task_complete and data.answer set to ok.',
    { contractType: 'task_complete', expectedOutput: 'Include data.answer as ok' }
  );

  const completed = await agentManager.waitForSubagentRun(ack.runId, 120000);
  if (!completed || completed.status !== 'task_complete') {
    throw new Error(`Subagent run failed: ${JSON.stringify(completed || {})}`);
  }
  if (!completed.result || !completed.result.contract) {
    throw new Error('Subagent run did not produce contract result');
  }
  console.log(`[workflow-subagent-live] PASS subagent run_id=${ack.runId} status=${completed.status}`);
  console.log(`[workflow-subagent-live] PASS subagent data=${JSON.stringify(completed.result.contract.data)}`);

  await runtime.shutdown();
}

app.whenReady().then(async () => {
  try {
    await run();
    app.quit();
  } catch (error) {
    console.error(`[workflow-subagent-live] FAIL: ${error.message || error}`);
    try {
      app.quit();
    } catch (_) {}
    process.exit(1);
  }
});
