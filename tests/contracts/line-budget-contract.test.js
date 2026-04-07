const fs = require('fs');
const path = require('path');
const budgets = require('../fixtures/line-budgets.json');

function collectFiles(rootDir) {
  const pending = [
    path.join(rootDir, 'src'),
    path.join(rootDir, 'tools'),
    path.join(rootDir, 'tests')
  ];
  const files = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!fs.existsSync(current)) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        pending.push(path.join(current, entry));
      }
      continue;
    }

    if (!/\.(js|css|html|md|json)$/.test(current)) continue;
    files.push(current);
  }

  return files;
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content === '' ? 0 : content.split(/\r?\n/).length;
}

module.exports = {
  name: 'line-budget-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const violations = [];
    const files = collectFiles(rootDir);

    for (const filePath of files) {
      const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      const lineCount = countLines(filePath);
      const fileBudget = budgets.allowlist[relativePath];

      if (fileBudget !== undefined) {
        if (lineCount > fileBudget) {
          violations.push(`${relativePath}: ${lineCount} lines exceeds allowlisted budget ${fileBudget}`);
        }
        continue;
      }

      if (lineCount > budgets.defaultMaxLines) {
        violations.push(`${relativePath}: ${lineCount} lines exceeds default max ${budgets.defaultMaxLines}`);
      }
    }

    assert.equal(
      violations.length,
      0,
      `Line budget violations detected:\n${violations.join('\n')}`
    );
  }
};
