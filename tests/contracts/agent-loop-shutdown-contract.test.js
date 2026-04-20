const AgentLoop = require('../../src/main/agent-loop');

module.exports = {
  name: 'agent-loop-shutdown-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const dispatcher = {
      async dispatch() {
        return { content: 'summary' };
      }
    };

    const agentMemory = {
      async read() { return { content: '' }; },
      async append() { return { ok: true }; }
    };

    const enqueued = [];
    const db = {
      async getConversations() {
        return [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
          { role: 'user', content: 'c' },
          { role: 'assistant', content: 'd' }
        ];
      },
      async enqueueMemoryJob(job) {
        enqueued.push(job);
        return { id: enqueued.length, ...job };
      }
    };

    let cleanupCalls = 0;
    const sessionWorkspace = {
      cleanup() {
        cleanupCalls++;
      }
    };

    const loop = new AgentLoop(dispatcher, agentMemory, db, sessionWorkspace);

    loop.sessions.set('s1', {
      autoMemory: false,
      idleSeconds: 60,
      idleTimer: null,
      memorySaved: false,
      memoryLoaded: false,
      lastActivity: Date.now(),
      messageCount: 10
    });

    let dispatchCalls = 0;
    loop.dispatcher.dispatch = async () => {
      dispatchCalls++;
      return { content: 'summary' };
    };

    await loop.onAppQuit();
    assert.equal(dispatchCalls, 0, 'Expected onAppQuit to skip LLM summarization');
    assert.equal(loop.sessions.size, 0, 'Expected sessions to be cleared on app quit');
    assert.equal(enqueued.length, 1, 'Expected onAppQuit to enqueue summary job');
    assert.equal(enqueued[0].jobType, 'summarize_session', 'Expected summary job type');
    assert.equal(enqueued[0].sessionId, 's1', 'Expected summary job to target active session');

    loop.sessions.set('s2', {
      autoMemory: false,
      idleSeconds: 60,
      idleTimer: null,
      memorySaved: false,
      memoryLoaded: false,
      lastActivity: Date.now(),
      messageCount: 10
    });
    await loop.onSessionClose('s2');
    assert.equal(cleanupCalls, 0, 'Expected onSessionClose to preserve workspace files');
    assert.equal(enqueued.length, 2, 'Expected onSessionClose to enqueue summary job');
    assert.equal(enqueued[1].sessionId, 's2', 'Expected queued session id for close trigger');
  }
};
