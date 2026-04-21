const BackgroundMemoryDaemon = require('../../src/main/background-memory-daemon');

module.exports = {
  name: 'background-memory-daemon-run-now-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const daemon = new BackgroundMemoryDaemon(
      { async dispatch() { return { content: '[no work needed]' }; } },
      {
        async append() {},
        getStats() { return { daily: 0, global: 0, tasks: 0 }; },
        async read() { return { content: '' }; }
      },
      {
        async claimNextMemoryJob() { return null; },
        async completeMemoryJob() {},
        async failMemoryJob() {}
      },
      null,
      {
        resourceMonitor: {
          async check() {
            return { available: true, cpu: 0, gpu: 0 };
          }
        }
      }
    );

    let executeCalls = 0;
    daemon._executeTick = async () => {
      executeCalls++;
    };

    const notRunning = await daemon.runNow();
    assert.equal(notRunning.success, false, 'Expected runNow to fail when daemon is not running');

    daemon.running = true;
    daemon._tickIndex = 3;
    const success = await daemon.runNow();
    assert.equal(success.success, true, 'Expected runNow to succeed while running');
    assert.equal(executeCalls, 1, 'Expected one tick execution');
    assert.equal(daemon._tickIndex, 3, 'Expected manual run to avoid advancing scheduled tick index');

    daemon._tickInProgress = true;
    const busy = await daemon.runNow();
    assert.equal(busy.success, false, 'Expected runNow to reject overlapping execution');
    assert.includes(String(busy.error || ''), 'already in progress', 'Expected busy error message');
  }
};
