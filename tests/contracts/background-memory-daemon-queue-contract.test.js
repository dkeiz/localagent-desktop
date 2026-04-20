const BackgroundMemoryDaemon = require('../../src/main/background-memory-daemon');

module.exports = {
  name: 'background-memory-daemon-queue-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const jobs = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      session_id: `s${index + 1}`,
      status: 'pending'
    }));
    const completed = [];
    const failed = [];
    const appended = [];
    let dispatchCalls = 0;

    const db = {
      async claimNextMemoryJob(jobType) {
        const next = jobs.find(job => job.status === 'pending');
        if (!next) return null;
        next.status = 'running';
        next.job_type = jobType;
        return next;
      },
      async completeMemoryJob(jobId) {
        completed.push(jobId);
        const row = jobs.find(job => job.id === jobId);
        if (row) row.status = 'done';
      },
      async failMemoryJob(jobId, error) {
        failed.push({ jobId, error });
        const row = jobs.find(job => job.id === jobId);
        if (row) row.status = 'failed';
      },
      async getConversations(limit, sessionId) {
        return [
          { role: 'user', content: `hello from ${sessionId}` },
          { role: 'assistant', content: 'ack' },
          { role: 'user', content: 'step two' },
          { role: 'assistant', content: 'step three' }
        ];
      }
    };

    const daemon = new BackgroundMemoryDaemon(
      {
        async dispatch() {
          dispatchCalls++;
          return { content: '- summary point' };
        }
      },
      {
        async append(type, content) {
          appended.push({ type, content });
        },
        getStats() {
          return { daily: 0, global: 0, tasks: 0 };
        },
        async read() {
          return { content: '' };
        }
      },
      db,
      null,
      {
        resourceMonitor: {
          async check() {
            return { available: true, cpu: 0, gpu: 0 };
          }
        }
      }
    );

    daemon.running = true;
    await daemon._executeTick();

    assert.equal(dispatchCalls, 5, 'Expected queued processing to stop after 5 jobs');
    assert.equal(completed.length, 5, 'Expected 5 jobs completed in one tick');
    assert.equal(failed.length, 0, 'Expected no failed jobs in happy path');
    assert.equal(appended.length, 5, 'Expected one memory append per processed job');
    assert.equal(jobs.filter(job => job.status === 'pending').length, 2, 'Expected remaining jobs for next tick');
  }
};
