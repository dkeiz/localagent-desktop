const fs = require('fs');
const path = require('path');

function collectImports(css) {
  const imports = [];
  const pattern = /@import\s+url\('([^']+)'\);/g;
  let match;

  while ((match = pattern.exec(css)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

module.exports = {
  name: 'styles-layout-import-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const layoutPath = path.join(rootDir, 'src', 'renderer', 'styles', 'layout.css');
    const css = fs.readFileSync(layoutPath, 'utf8');
    const imports = collectImports(css);
    const expected = [
      './layout/layout-core.css',
      './layout/layout-widgets.css',
      './layout/layout-chat.css',
      './layout/layout-tools.css',
      './layout/layout-workflows.css',
      './layout/layout-sidebar.css'
    ];

    assert.deepEqual(imports, expected, 'layout.css imports changed unexpectedly');

    for (const relativeImport of imports) {
      const importPath = path.resolve(path.dirname(layoutPath), relativeImport);
      assert.ok(fs.existsSync(importPath), `Missing imported stylesheet: ${relativeImport}`);
    }
  }
};
