const fs = require('fs');
const path = require('path');
const SubtaskRuntime = require('../../src/main/subtask-runtime');
const { makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'subagent-parent-delivery-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-subtask-parent-');
    const delivered = [];
    const updates = [];

    const runtime = new SubtaskRuntime(
      {},
      null,
      null,
      path.join(tempBase, 'subtasks'),
      {
        persistConversationMessage: async (message, sessionId) => {
          delivered.push({ message, sessionId });
          return { sessionId, ...message };
        },
        notifyConversationUpdate(sessionId) {
          updates.push(sessionId);
        }
      }
    );
    runtime.initialize();

    const run = runtime.createRun({
      parentSessionId: 'testclient-parent',
      subagentId: 7,
      agentName: 'Search Agent',
      task: 'Ping',
      contractType: 'task_complete'
    });

    runtime.completeRun(run.run_id, {
      contract: {
        status: 'task_complete',
        summary: 'Done',
        data: { ok: true },
        artifacts: [],
        notes: ''
      },
      artifacts: []
    });

    const delivery = await runtime.deliverToParent(run.run_id, {
      status: 'task_complete',
      summary: 'Done',
      contract: {
        status: 'task_complete',
        summary: 'Done',
        data: { ok: true },
        artifacts: [],
        notes: ''
      }
    });

    assert.equal(delivered.length, 1, 'Expected parent mirror write for string-backed parent session');
    assert.equal(delivered[0].sessionId, 'testclient-parent', 'Expected delivery to target string parent session');
    assert.includes(delivered[0].message.content, run.run_id, 'Expected parent delivery to include run id');
    assert.includes(delivered[0].message.content, run.child_session_id, 'Expected parent delivery to include child session id');
    assert.includes(delivered[0].message.content, 'Structured Result:', 'Expected parent delivery to inline structured contract data');
    assert.includes(delivered[0].message.content, '"ok": true', 'Expected parent delivery to include contract payload fields');
    assert.equal(updates.length, 1, 'Expected conversation update notification');
    assert.equal(updates[0], 'testclient-parent', 'Expected update for string parent session');
    assert.equal(delivery.delivered_to_parent, true, 'Expected delivery status to reflect mirrored parent write');
    assert.ok(fs.existsSync(delivery.delivery_path), 'Expected durable inbox delivery artifact');
  }
};
