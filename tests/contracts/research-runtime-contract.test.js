const path = require('path');
const WorkflowManager = require('../../src/main/workflow-manager');
const WorkflowRuntime = require('../../src/main/workflow-runtime');
const ResearchRuntime = require('../../src/main/research-runtime');
const { makeTempDir } = require('../helpers/fakes');

function createFakeDb() {
  const workflows = new Map();
  let idCounter = 1;
  return {
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
    async getWorkflows() {
      return Array.from(workflows.values());
    },
    async updateWorkflowStats(id, success) {
      const row = workflows.get(Number(id));
      if (!row) return;
      if (success) row.success_count += 1;
      else row.failure_count += 1;
    },
    run() {}
  };
}

module.exports = {
  name: 'research-runtime-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = createFakeDb();
    const mcp = {
      getTools() {
        return [{ name: 'alpha' }, { name: 'beta' }];
      },
      async executeTool(toolName, params) {
        if (toolName === 'beta' && params?.fail) {
          throw new Error('variant failed');
        }
        return { ok: true, toolName, params };
      }
    };

    const workflowManager = new WorkflowManager(db, mcp);
    const tempBase = makeTempDir('localagent-research-runs-');
    const workflowRuntime = new WorkflowRuntime(workflowManager, null, path.join(tempBase, 'workflow-runs'));
    workflowRuntime.initialize();
    workflowManager.setWorkflowRuntime(workflowRuntime);

    const baseline = await db.addWorkflow({
      name: 'Baseline',
      description: 'baseline workflow',
      trigger_pattern: 'baseline',
      tool_chain: [{ tool: 'alpha', params: {} }]
    });
    const v1 = await db.addWorkflow({
      name: 'Variant 1',
      description: 'first variant',
      trigger_pattern: 'variant',
      tool_chain: [{ tool: 'alpha', params: {} }]
    });
    const v2 = await db.addWorkflow({
      name: 'Variant 2',
      description: 'second variant',
      trigger_pattern: 'variant',
      tool_chain: [{ tool: 'beta', params: { fail: true } }]
    });

    const capturedKnowledge = [];
    const knowledgeManager = {
      async createItem(item) {
        capturedKnowledge.push(item);
        return { slug: 'test-knowledge' };
      }
    };

    const researchRuntime = new ResearchRuntime(
      workflowManager,
      knowledgeManager,
      null,
      path.join(tempBase, 'research-runs')
    );
    researchRuntime.initialize();

    const originalRunWorkflow = workflowManager.runWorkflow.bind(workflowManager);
    let workflowApiCalls = 0;
    workflowManager.runWorkflow = async (...args) => {
      workflowApiCalls++;
      return originalRunWorkflow(...args);
    };

    const ack = await researchRuntime.startResearch({
      goal: 'Find best workflow',
      baseline_workflow_id: baseline.id,
      variants: [
        { id: 'V1', workflow_id: v1.id },
        { id: 'V2', workflow_id: v2.id, param_overrides: { beta: { fail: true } } }
      ],
      workflow_mode: 'auto'
    });
    assert.equal(ack.accepted, true, 'Expected research run acknowledgment');

    const completed = await researchRuntime.waitForRun(ack.run_id, 5000);
    assert.equal(completed.status, 'completed', 'Expected research run completion');
    assert.ok(completed.result, 'Expected final research result payload');
    assert.ok(Array.isArray(completed.result.ranking), 'Expected ranking output');
    assert.ok(completed.result.ranking.length >= 3, 'Expected baseline and variants in ranking');
    assert.ok(completed.result.winner, 'Expected winner in result');
    assert.ok(workflowApiCalls >= 3, 'Expected research runtime to execute via workflow API');
    assert.equal(capturedKnowledge.length, 1, 'Expected knowledge persistence on completion');
  }
};
