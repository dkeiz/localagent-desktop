const path = require('path');
const { runElectronScript } = require('../helpers/electron-contract');

module.exports = {
  name: 'bootstrap-runtime-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    await runElectronScript(rootDir, path.join('tools', 'test-bootstrap-runtime.js'));
    assert.ok(true, 'Expected Electron-backed bootstrap runtime contract to pass');
  }
};
