const path = require('path');
const { loadElectronApi, flattenElectronApi, collectRendererApiReferences } = require('../helpers/renderer-utils');

module.exports = {
  name: 'renderer-electron-api-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const electronApi = loadElectronApi(rootDir);
    const availableKeys = flattenElectronApi(electronApi);
    const references = collectRendererApiReferences(rootDir);

    const missing = references
      .filter(ref => !availableKeys.has(ref.key))
      .map(ref => `${path.relative(rootDir, ref.filePath)} -> ${ref.key}`);

    assert.equal(
      missing.length,
      0,
      `Renderer files reference missing electron API methods:\n${missing.join('\n')}`
    );
  }
};
