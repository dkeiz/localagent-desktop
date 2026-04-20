const BackgroundMemoryDaemon = require('../../src/main/background-memory-daemon');

module.exports = {
  name: 'background-memory-daemon-context-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const daemon = new BackgroundMemoryDaemon(
      { async dispatch() { return { content: '[no work needed]' }; } },
      {
        getStats() { return { daily: 1, global: 1, tasks: 0 }; },
        async read() { return { content: 'Daily memory preview' }; }
      },
      {
        all() {
          return [
            { id: 's1', title: 'Build failure', message_count: 6 }
          ];
        },
        async getConversations(limit, sessionId) {
          return [
            { role: 'user', content: `session ${sessionId} message one` },
            { role: 'assistant', content: 'message two' }
          ];
        }
      },
      null
    );

    const context = await daemon._gatherStateContext();
    assert.includes(context, 'Session Transcript Excerpts', 'Expected transcript section to be present');
    assert.includes(context, 'session s1 message one', 'Expected transcript content to be included');
  }
};
