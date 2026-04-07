const fs = require('fs');
const path = require('path');
const contracts = require('../fixtures/widget-dom-contracts.json');
const { collectHtmlIds } = require('../helpers/renderer-utils');

module.exports = {
  name: 'widget-dom-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const indexHtmlPath = path.join(rootDir, 'src', 'renderer', 'index.html');
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const htmlIds = collectHtmlIds(html);

    const missing = [];

    for (const widget of contracts.widgets) {
      const componentPath = path.join(rootDir, widget.component);
      assert.ok(fs.existsSync(componentPath), `Missing widget component: ${widget.component}`);

      for (const id of widget.requiredIds) {
        if (!htmlIds.has(id)) {
          missing.push(`${widget.name}: #${id}`);
        }
      }
    }

    assert.equal(
      missing.length,
      0,
      `index.html is missing widget contract IDs:\n${missing.join('\n')}`
    );
  }
};
