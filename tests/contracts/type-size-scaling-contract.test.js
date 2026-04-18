const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createDocumentStub() {
  const styleValues = new Map();
  const display = { textContent: '' };

  return {
    documentElement: {
      style: {
        setProperty(name, value) {
          styleValues.set(name, String(value));
        },
        getPropertyValue(name) {
          return styleValues.get(name) || '';
        }
      }
    },
    getElementById(id) {
      if (id === 'type-size-display') return display;
      return null;
    },
    addEventListener() {}
  };
}

module.exports = {
  name: 'type-size-scaling-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const themePath = path.join(rootDir, 'src', 'renderer', 'styles', 'theme.css');
    const themeCss = fs.readFileSync(themePath, 'utf8');

    const scalableTokens = ['--text-xs', '--text-sm', '--text-md', '--text-lg'];
    scalableTokens.forEach((tokenName) => {
      const tokenPattern = new RegExp(`${tokenName}:\\s*calc\\([^;]*var\\(--type-scale\\)[^;]*\\);`);
      assert.ok(tokenPattern.test(themeCss), `Expected ${tokenName} to scale from --type-scale`);
    });
    assert.includes(
      themeCss,
      'font-size: calc(16px * var(--type-scale));',
      'Expected html root font size to scale from --type-scale'
    );

    const appPath = path.join(rootDir, 'src', 'renderer', 'app.js');
    const appSource = fs.readFileSync(appPath, 'utf8');
    const documentStub = createDocumentStub();
    const context = {
      console,
      MainPanel: function MainPanel() {},
      window: {},
      document: documentStub,
      localStorage: {
        getItem() { return null; },
        setItem() {}
      }
    };
    context.window = context;
    vm.runInNewContext(`${appSource}\nthis.__CapturedApp = App;`, context, { filename: 'app.js' });
    const AppClass = context.__CapturedApp;

    const app = Object.create(AppClass.prototype);
    app.parseTypeSize = AppClass.prototype.parseTypeSize.bind(app);
    app.applyTypeSize = AppClass.prototype.applyTypeSize.bind(app);

    const scaledTo16 = app.applyTypeSize('16');
    assert.equal(scaledTo16, 16, 'Expected type size to parse and apply 16px');
    assert.equal(
      documentStub.documentElement.style.getPropertyValue('--type-base'),
      '16px',
      'Expected --type-base to be updated'
    );
    assert.equal(
      documentStub.documentElement.style.getPropertyValue('--type-scale'),
      String(16 / 13),
      'Expected --type-scale to use 13px baseline'
    );
    assert.equal(
      documentStub.getElementById('type-size-display').textContent,
      '16px',
      'Expected type size label to reflect current value'
    );

    const scaledLow = app.applyTypeSize('2');
    const scaledHigh = app.applyTypeSize('99');
    assert.equal(scaledLow, AppClass.TYPE_SIZE_MIN, 'Expected lower bound clamp');
    assert.equal(scaledHigh, AppClass.TYPE_SIZE_MAX, 'Expected upper bound clamp');
  }
};
