const MCPServer = require('../../src/main/mcp-server');

module.exports = {
  name: 'subagent-tool-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = {
      async getSetting() {
        return null;
      }
    };

    const server = new MCPServer(db, null);
    const calls = {
      create: [],
      invoke: [],
      deactivate: []
    };

    const searchAgent = {
      id: 5,
      name: 'Search Agent',
      type: 'sub',
      status: 'idle',
      icon: '🌐',
      description: 'Search worker'
    };

    server.setCurrentSessionId(42);
    server.setAgentManager({
      async getAgents(type) {
        return type === 'sub' ? [searchAgent] : [];
      },
      async getAgent(id) {
        return Number(id) === 5 ? searchAgent : null;
      },
      async createAgent(data) {
        calls.create.push(data);
        return { id: 8, status: 'idle', ...data };
      },
      async invokeSubAgent(parentSessionId, subAgentId, task, options) {
        calls.invoke.push({ parentSessionId, subAgentId, task, options });
        return {
          success: true,
          accepted: true,
          run_id: 'subtask-test-1',
          status: 'queued',
          child_session_id: 'subtask-test-1'
        };
      },
      async deactivateAgent(id) {
        calls.deactivate.push(id);
        return { success: true };
      },
      async listSubagentRuns() {
        return [{
          run_id: 'subtask-test-1',
          status: 'queued',
          subagent_id: 5,
          agent_name: 'Search Agent'
        }];
      }
    });

    const listResult = await server.executeTool('subagent', {});
    assert.equal(listResult.success, true, 'Expected subagent list tool call to succeed');
    assert.equal(listResult.result.action, 'list', 'Expected default subagent action to be list');
    assert.equal(listResult.result.count, 1, 'Expected one listed sub-agent');
    assert.equal(listResult.result.agents[0].id, 5, 'Expected Search Agent in list output');

    const runResult = await server.executeTool('subagent', {
      action: 'run',
      id: 5,
      task: 'Find sources'
    });
    assert.equal(runResult.success, true, 'Expected subagent run tool call to succeed');
    assert.equal(runResult.result.action, 'run', 'Expected run action result');
    assert.equal(runResult.result.run_id, 'subtask-test-1', 'Expected returned run id');
    assert.equal(calls.invoke.length, 1, 'Expected invokeSubAgent to be called once');
    assert.equal(calls.invoke[0].parentSessionId, 42, 'Expected current session id to be forwarded');
    assert.equal(calls.invoke[0].subAgentId, 5, 'Expected run action to target the selected sub-agent');

    const createResult = await server.executeTool('subagent', {
      action: 'new',
      name: 'Tracer'
    });
    assert.equal(createResult.success, true, 'Expected subagent new action to succeed');
    assert.equal(createResult.result.agent.name, 'Tracer', 'Expected created sub-agent name');
    assert.equal(calls.create[0].type, 'sub', 'Expected action=new to create a sub-agent');

    const stopResult = await server.executeTool('subagent', {
      action: 'stop',
      id: 5
    });
    assert.equal(stopResult.success, true, 'Expected subagent stop action to succeed');
    assert.equal(stopResult.result.action, 'stop', 'Expected stop action result');
    assert.deepEqual(calls.deactivate, [5], 'Expected stop action to deactivate the target sub-agent');

    const legacyResult = await server.executeTool('run_subagent', {
      agent_id: 5,
      task: 'Legacy path'
    });
    assert.equal(legacyResult.success, true, 'Expected legacy run_subagent alias to still work');
    assert.equal(legacyResult.result.run_id, 'subtask-test-1', 'Expected legacy alias to delegate through the unified handler');
  }
};
