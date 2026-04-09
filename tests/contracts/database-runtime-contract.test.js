const path = require('path');
const { runElectronScript } = require('../helpers/electron-contract');

module.exports = {
  name: 'database-runtime-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    await runElectronScript(rootDir, path.join('tools', 'test-database-runtime.js'));

    assert.ok(true, 'Expected Electron-backed database runtime contract to pass');
  }
};
