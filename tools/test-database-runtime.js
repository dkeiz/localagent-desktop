const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { app } = require('electron');
const DatabaseWrapper = require('../src/main/database');
const { makeTempDir } = require('../tests/helpers/fakes');

function safeClose(db) {
  if (!db) return;
  try {
    db.close();
  } catch (error) {
    // Ignore close errors during cleanup.
  }
}

async function runContract() {
  const tempBase = makeTempDir('localagent-db-');
  const dbPath = path.join(tempBase, 'localagent.db');
  let db = null;
  let reopened = null;

  try {
    db = new DatabaseWrapper({ dbPath });
    await db.init();

    const seededRules = db.all(
      'SELECT * FROM prompt_rules WHERE name = ?',
      ['Enforce Tool Usage']
    );
    assert.strictEqual(seededRules.length, 1, 'Expected the default tool-usage rule to be seeded exactly once');

    const workflow = await db.addWorkflow({
      name: 'Visual Workflow',
      description: 'Fresh database contract',
      trigger_pattern: 'contract',
      tool_chain: [{ tool: 'alpha', params: { ok: true } }],
      visual_data: { layout: 'graph', nodes: [{ id: 'alpha' }] }
    });
    const storedWorkflow = await db.getWorkflowById(workflow.id);
    assert.ok(storedWorkflow, 'Expected workflow row to be stored');
    assert.ok(storedWorkflow.tool_chain.includes('"alpha"'), 'Expected serialized workflow tool chain');
    assert.ok(storedWorkflow.visual_data.includes('"layout":"graph"'), 'Expected visual workflow data to persist');
    assert.strictEqual(storedWorkflow.execution_count, 0, 'Expected workflow execution_count default on fresh DB');

    const session = await db.createChatSession('Contract Session');
    await db.addConversation({
      role: 'user',
      content: 'hello database contract',
      metadata: { source: 'contract' }
    }, session.id);
    const loadedConversation = await db.loadChatSession(session.id);
    assert.strictEqual(loadedConversation.length, 1, 'Expected persisted conversation to be readable');
    assert.ok(loadedConversation[0].metadata.includes('"source":"contract"'), 'Expected conversation metadata to persist');

    const currentSession = await db.getCurrentSession();
    assert.strictEqual(currentSession.id, session.id, 'Expected created session to become current');

    safeClose(db);
    db = null;

    reopened = new DatabaseWrapper({ dbPath });
    await reopened.init();
    const reseededRules = reopened.all(
      'SELECT * FROM prompt_rules WHERE name = ?',
      ['Enforce Tool Usage']
    );
    assert.strictEqual(reseededRules.length, 1, 'Expected default tool-usage rule seeding to remain idempotent');

    const reloadedWorkflow = await reopened.getWorkflowById(workflow.id);
    assert.ok(reloadedWorkflow, 'Expected workflow to remain after reopening the database');
    assert.ok(reloadedWorkflow.visual_data.includes('"nodes"'), 'Expected reopened workflow to retain visual data');
  } finally {
    safeClose(reopened);
    safeClose(db);
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
}

runContract()
  .then(() => {
    console.log('[test-database-runtime] PASS');
    if (app) {
      app.exit(0);
      return;
    }
    process.exit(0);
  })
  .catch(error => {
    console.error('[test-database-runtime] FAIL:', error);
    if (app) {
      app.exit(1);
      return;
    }
    process.exit(1);
  });
