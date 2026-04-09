const { EventEmitter } = require('events');
const { WindowManager } = require('../../src/main/window-manager');

class FakeWindow extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.sent = [];
    this.destroyed = false;
    this.webContents = {
      send: (channel, payload) => {
        this.sent.push({ channel, payload });
      }
    };
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroyWindow() {
    this.destroyed = true;
    this.emit('closed');
  }
}

module.exports = {
  name: 'window-manager-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const windows = [];
    const manager = new WindowManager({
      createWindow: ({ kind }) => {
        const win = new FakeWindow(`${kind}-${windows.length + 1}`);
        windows.push(win);
        return win;
      }
    });

    const first = manager.createMainWindow();
    assert.equal(manager.getMainWindow(), first, 'Expected createMainWindow() to track the current main window');
    assert.equal(manager.send('conversation-update', { sessionId: 1 }), true, 'Expected send() to forward to the current window');
    assert.equal(first.sent.length, 1, 'Expected the first window to receive the renderer event');

    first.destroyWindow();
    assert.equal(manager.getMainWindow(), null, 'Expected destroyed main windows to be cleared');

    const second = manager.createMainWindow();
    assert.notEqual(second, first, 'Expected a recreated main window instance');
    manager.send('tool-update', { ok: true });
    assert.equal(second.sent.length, 1, 'Expected the recreated window to receive new renderer events');
    assert.equal(first.sent.length, 1, 'Expected the old window not to receive new events');
  }
};
