const path = require('path');
const WorkflowManager = require('../../src/main/workflow-manager');
const WorkflowRuntime = require('../../src/main/workflow-runtime');
const { makeTempDir } = require('../helpers/fakes');

function createFakeDb() {
  const workflows = new Map();
  let idCounter = 1;
  return {
    workflows,
    async getWorkflows() {
      return Array.from(workflows.values());
    },
    async addWorkflow(workflow) {
      const id = idCounter++;
      const stored = {
        ...workflow,
        id,
        tool_chain: JSON.stringify(workflow.tool_chain),
        success_count: 0,
        failure_count: 0
      };
      workflows.set(id, stored);
      return { ...workflow, id };
    },
    async getWorkflowById(id) {
      return workflows.get(Number(id)) || null;
    },
    async updateWorkflowStats(id, success) {
      const row = workflows.get(Number(id));
      if (!row) return;
      if (success) row.success_count += 1;
      else row.failure_count += 1;
    },
    run(sql, params) {
      if (!sql.includes('UPDATE workflows SET')) return;
      const id = Number(params[params.length - 1]);
      const row = workflows.get(id);
      if (!row) return;
      if (sql.includes('tool_chain = ?')) {
        row.tool_chain = params[0];
      }
      if (sql.includes('name = ?')) {
        row.name = params[0];
      }
      if (sql.includes('description = ?') && sql.includes('trigger_pattern = ?') && sql.includes('tool_chain = ?')) {
        row.description = params[0];
        row.trigger_pattern = params[1];
        row.tool_chain = params[2];
      }
    },
    async deleteWorkflow(id) {
      workflows.delete(Number(id));
    }
  };
}

function createFakeMcp() {
  const tools = ['alpha', 'beta', 'gamma'];
  return {
    getTools() {
      return tools.map(name => ({ name }));
    },
    async executeTool(toolName, params) {
      if (toolName === 'beta' && params && params.fail === true) {
        throw new Error('forced failure');
      }
      return {
        tool: toolName,
        params
      };
    }
  };
}

module.exports = {
  name: 'workflow-runtime-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = createFakeDb();
    const mcp = createFakeMcp();
    const workflowManager = new WorkflowManager(db, mcp);
    const tempBase = makeTempDir('localagent-workflow-runs-');
    const workflowRuntime = new WorkflowRuntime(
      workflowManager,
      null,
      path.join(tempBase, 'workflow-runs')
    );
    workflowRuntime.initialize();
    workflowManager.setWorkflowRuntime(workflowRuntime);

    const quick = await db.addWorkflow({
      name: 'Quick',
      description: 'quick chain',
      trigger_pattern: 'quick',
      tool_chain: [{ tool: 'alpha', params: {} }]
    });
    const long = await db.addWorkflow({
      name: 'Long',
      description: 'long chain',
      trigger_pattern: 'long',
      tool_chain: [
        { tool: 'alpha', params: {} },
        { tool: 'beta', params: {} },
        { tool: 'gamma', params: {} }
      ]
    });

    const syncRun = await workflowManager.runWorkflow(quick.id, { mode: 'sync' });
    assert.equal(syncRun.immediate, true, 'Expected sync run to complete immediately');
    assert.equal(syncRun.status, 'completed', 'Expected sync run completed status');
    assert.equal(syncRun.result.success, true, 'Expected sync run success');

    const asyncRun = await workflowManager.runWorkflow(quick.id, { mode: 'async' });
    assert.equal(asyncRun.immediate, false, 'Expected async run to return acknowledgment');
    const asyncDone = await workflowManager.waitForWorkflowRun(asyncRun.run_id, 2000);
    assert.equal(asyncDone.status, 'completed', 'Expected async run completion');

    const autoRun = await workflowManager.runWorkflow(long.id, { mode: 'auto' });
    assert.equal(autoRun.mode, 'async', 'Expected auto mode to choose async for long chains');
    const autoDone = await workflowManager.waitForWorkflowRun(autoRun.run_id, 2000);
    assert.equal(autoDone.status, 'completed', 'Expected auto-selected async run completion');

    let invalidError = null;
    try {
      await workflowManager.captureWorkflow('invalid', [{ tool: 'unknown_tool', params: {} }], 'Invalid');
    } catch (error) {
      invalidError = error;
    }
    assert.ok(invalidError, 'Expected unknown tool validation to reject capture');
    assert.includes(invalidError.message, 'unknown tools', 'Expected validation message for unknown tools');
  }
};
