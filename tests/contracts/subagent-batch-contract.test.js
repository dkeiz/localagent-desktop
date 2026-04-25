const { invokeMultipleSubAgents } = require('../../src/main/agent-batch-invoker');

module.exports = {
  name: 'subagent-batch-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const agents = new Map([
      [1, { id: 1, type: 'sub', name: 'A', config: JSON.stringify({ provider: 'openai' }) }],
      [2, { id: 2, type: 'sub', name: 'B', config: JSON.stringify({ provider: 'ollama' }) }],
      [3, { id: 3, type: 'sub', name: 'C', config: JSON.stringify({ provider: 'openai' }) }]
    ]);
    const calls = [];
    const manager = {
      db: { getSetting: async () => 'default-provider' },
      getAgent: async (id) => agents.get(Number(id)),
      getAgents: async () => Array.from(agents.values()),
      invokeSubAgent: async (parentSessionId, subAgentId, task, options) => {
        calls.push({ parentSessionId, subAgentId, task, options });
        return { accepted: true, run_id: `run-${subAgentId}` };
      }
    };

    const result = await invokeMultipleSubAgents(manager, 'parent-1', [
      { id: 1, task: 'first', concurrency_mode: 'parallel' },
      { id: 2, task: 'second' },
      { id: 3, task: 'third', options: { concurrencyMode: 'parallel' } }
    ]);

    assert.equal(result.success, true, 'Batch should be accepted');
    assert.deepEqual(result.providers.sort(), ['ollama', 'openai'], 'Expected provider summary');
    assert.equal(calls[0].options.queueProvider, 'provider:openai');
    assert.equal(calls[1].options.queueProvider, 'provider:ollama');
    assert.equal(calls[2].options.queueProvider, 'provider:openai');
    assert.equal(calls[0].options.provider, 'openai');
    assert.equal(calls[1].options.provider, 'ollama');
    assert.equal(calls[0].options.concurrencyMode, 'parallel');
    assert.equal(calls[1].options.concurrencyMode, 'queued');
    assert.equal(calls[2].options.concurrencyMode, 'parallel');
  }
};
