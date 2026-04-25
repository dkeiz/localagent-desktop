const path = require('path');
const AgentManager = require('../../src/main/agent-manager');
const InferenceDispatcher = require('../../src/main/inference-dispatcher');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createDb(overridesJson) {
  const agents = new Map([
    [1, { id: 1, type: 'sub', name: 'Mock Sub A', status: 'idle', config: '{}' }],
    [2, { id: 2, type: 'sub', name: 'Mock Sub B', status: 'idle', config: '{}' }]
  ]);

  return {
    async getAgent(id) {
      return agents.get(Number(id)) || null;
    },
    async getAgents(type = null) {
      const list = Array.from(agents.values());
      if (!type) return list;
      return list.filter(agent => agent.type === type);
    },
    async updateAgent(id, patch) {
      const current = agents.get(Number(id));
      if (!current) return null;
      agents.set(Number(id), { ...current, ...patch });
      return agents.get(Number(id));
    },
    async addConversation() {
      return true;
    },
    async getConversations() {
      return [];
    },
    async getActivePromptRules() {
      return [];
    },
    async getSetting(key) {
      if (key === 'llm.concurrency.enabled') return 'true';
      if (key === 'llm.provider') return 'openai';
      if (key === 'llm.model') return 'mock-model';
      if (key === 'llm.lastWorkingProvider') return 'openai';
      if (key === 'llm.lastWorkingModel') return 'mock-model';
      if (key === 'llm.modelOverrides') return overridesJson;
      if (key === 'llm.thinkingMode') return 'off';
      return null;
    },
    async saveSetting() {
      return true;
    }
  };
}

module.exports = {
  name: 'subagent-mock-provider-parallel-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const callState = {
      active: 0,
      maxActive: 0
    };

    const aiService = {
      systemPrompt: 'test prompt',
      getCurrentProvider() {
        return 'openai';
      },
      async sendMessage(messages, options = {}) {
        callState.active += 1;
        callState.maxActive = Math.max(callState.maxActive, callState.active);
        await sleep(25);
        callState.active -= 1;
        return {
          content: JSON.stringify({
            status: 'task_complete',
            summary: `done:${options.provider || 'unknown'}`,
            data: { provider: options.provider || 'unknown' }
          }),
          model: options.model || 'mock-model',
          usage: {}
        };
      }
    };

    const modelOverrides = JSON.stringify({
      'ollama::mock-model': {
        concurrency: {
          allowParallel: true
        }
      }
    });

    const db = createDb(modelOverrides);
    const dispatcher = new InferenceDispatcher(aiService, db, null);
    const manager = new AgentManager(
      db,
      dispatcher,
      null,
      null,
      null,
      null,
      null,
      null,
      { basePath: path.join(process.cwd(), 'agentin', 'agents') }
    );
    dispatcher.setAgentManager(manager);

    callState.active = 0;
    callState.maxActive = 0;
    const mixedProviders = await manager.invokeMultipleSubAgents('parent-mock', [
      { id: 1, task: 'task-a', provider: 'openai', concurrency_mode: 'parallel' },
      { id: 2, task: 'task-b', provider: 'groq', concurrency_mode: 'parallel' }
    ], { wait: true, timeout_ms: 5000 });

    assert.equal(mixedProviders.success, true, 'Mixed-provider batch should succeed');
    assert.equal(callState.maxActive, 2, 'Different provider subagents should overlap when parallel mode is requested');
    assert.equal(mixedProviders.results.length, 2, 'Expected 2 mixed-provider results');
    assert.ok(mixedProviders.results.every(r => r.run && r.run.status === 'task_complete'), 'Expected completed runs for mixed providers');

    callState.active = 0;
    callState.maxActive = 0;
    const sameProvider = await manager.invokeMultipleSubAgents('parent-mock', [
      { id: 1, task: 'task-c', provider: 'openai', concurrency_mode: 'parallel' },
      { id: 2, task: 'task-d', provider: 'openai', concurrency_mode: 'parallel' }
    ], { wait: true, timeout_ms: 5000 });

    assert.equal(sameProvider.success, true, 'Same-provider batch should succeed');
    assert.equal(callState.maxActive, 1, 'Same provider should queue when provider-level parallel is not enabled');
    assert.equal(sameProvider.results.length, 2, 'Expected 2 same-provider results');

    callState.active = 0;
    callState.maxActive = 0;
    const localParallel = await manager.invokeMultipleSubAgents('parent-mock', [
      { id: 1, task: 'task-e', provider: 'ollama', concurrency_mode: 'parallel' },
      { id: 2, task: 'task-f', provider: 'ollama', concurrency_mode: 'parallel' }
    ], { wait: true, timeout_ms: 5000 });

    assert.equal(localParallel.success, true, 'Local-provider batch should succeed');
    assert.equal(callState.maxActive, 2, 'Same local provider should overlap when provider-level parallel is enabled');
    assert.equal(localParallel.results.length, 2, 'Expected 2 local-provider results');
  }
};
