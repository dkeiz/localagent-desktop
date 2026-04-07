const fs = require('fs');
const path = require('path');

function collectScriptSources(html) {
  const sources = [];
  const pattern = /<script\s+src="([^"]+)"/g;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    sources.push(match[1]);
  }

  return sources;
}

module.exports = {
  name: 'renderer-script-wiring-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const indexPath = path.join(rootDir, 'src', 'renderer', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    const scripts = collectScriptSources(html);
    const required = [
      'components/main-panel-tabs.js',
      'components/main-panel-permissions.js',
      'components/api-provider-settings.js',
      'components/main-panel.js'
    ];

    const positions = required.map(scriptPrefix => {
      const index = scripts.findIndex(src => src.startsWith(scriptPrefix));
      return { scriptPrefix, index };
    });

    const missing = positions
      .filter(entry => entry.index === -1)
      .map(entry => entry.scriptPrefix);

    assert.equal(
      missing.length,
      0,
      `Missing renderer helper scripts in index.html:\n${missing.join('\n')}`
    );

    for (let i = 1; i < positions.length; i++) {
      const previous = positions[i - 1];
      const current = positions[i];
      assert.ok(
        previous.index < current.index,
        `Expected ${previous.scriptPrefix} to load before ${current.scriptPrefix}`
      );
    }
  }
};
