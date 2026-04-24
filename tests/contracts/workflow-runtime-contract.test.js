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

function createFakeDispatcher() {
  return {
    calls: [],
    async dispatch(prompt) {
      this.calls.push(arguments[2] || {});
      if (String(prompt).includes('final answer')) {
        return {
          content: JSON.stringify({
            answer: 'Final workflow answer',
            summary: 'Final workflow summary',
            data: { ok: true }
          }),
          model: 'fake-model'
    };
}
      return {
        content: JSON.stringify({ value: 'from-agent' }),
        model: 'fake-model'
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
    const dispatcher = createFakeDispatcher();
    const workflowManager = new WorkflowManager(db, mcp, dispatcher);
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
    const mixed = await db.addWorkflow({
      name: 'Mixed',
      description: 'mixed tool and agent chain',
      trigger_pattern: 'mixed',
      tool_chain: [
        { type: 'tool', id: 'first', tool: 'alpha', params: { seed: true } },
        {
          type: 'agent',
          id: 'prepare',
          goal: 'Prepare beta params',
          input: '{{steps.first.output}}',
          required_output: { value: 'string' },
          llm: { provider: 'ollama', model: 'small-local', on_error: 'error' }
        },
        { type: 'tool', id: 'second', tool: 'beta', params_from: '{{steps.prepare.output.next_params}}' },
        {
          type: 'agent',
          id: 'final',
          goal: 'final answer',
          input: '{{steps.second.output}}',
          final: true
        }
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

    const mixedRun = await workflowManager.runWorkflow(mixed.id, { mode: 'sync' });
    assert.equal(mixedRun.status, 'completed', 'Expected mixed workflow to complete');
    assert.equal(
      mixedRun.result.final_output.answer,
      'Final workflow answer',
      'Expected final agent step to become workflow final output'
    );
    assert.equal(
      mixedRun.result.results[2].params.value,
      'from-agent',
      'Expected agent output to feed next tool params'
    );
    assert.equal(dispatcher.calls[0].provider, 'ollama', 'Expected agent LLM provider override');
    assert.equal(dispatcher.calls[0].model, 'small-local', 'Expected agent LLM model override');

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
