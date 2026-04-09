const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
}

function createThemeButton(theme) {
  return {
    dataset: { theme },
    listeners: new Map(),
    classList: {
      active: false,
      toggle(className, enabled) {
        if (className === 'active') {
          this.active = Boolean(enabled);
        }
      }
    },
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
}

module.exports = {
  name: 'theme-manager-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const indexPath = path.join(rootDir, 'src', 'renderer', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    ['light', 'solar', 'dark'].forEach(theme => {
      assert.includes(html, `data-theme="${theme}"`, `Expected theme picker to expose ${theme}`);
    });
    assert.includes(html, "localStorage.getItem('theme')", 'Expected startup HTML bootstrap to restore the saved theme before app scripts run');

    const appPath = path.join(rootDir, 'src', 'renderer', 'app.js');
    const source = fs.readFileSync(appPath, 'utf8');
    const themeButtons = [
      createThemeButton('light'),
      createThemeButton('solar'),
      createThemeButton('dark')
    ];
    const documentElement = {
      attributes: new Map(),
      setAttribute(name, value) {
        this.attributes.set(name, value);
      },
      getAttribute(name) {
        return this.attributes.get(name) || null;
      }
    };
    const themePicker = {
      querySelectorAll(selector) {
        return selector === '.theme-btn' ? themeButtons : [];
      }
    };
    const localStorage = createLocalStorage({ theme: 'solar' });
    const context = {
      console,
      localStorage,
      document: {
        documentElement,
        addEventListener() {},
        querySelector() {
          return null;
        },
        querySelectorAll(selector) {
          return selector === '.theme-btn' ? themeButtons : [];
        },
        getElementById(id) {
          if (id === 'theme-picker') return themePicker;
          return null;
        }
      }
    };

    context.mainPanel = {};
    context.window = context;
    vm.runInNewContext(`${source}\nthis.__CapturedApp = App;`, context, { filename: 'app.js' });
    const AppClass = context.__CapturedApp;
    const app = Object.create(AppClass.prototype);
    app.setTheme = AppClass.prototype.setTheme.bind(app);
    app.initializeTheme = AppClass.prototype.initializeTheme.bind(app);

    app.initializeTheme();

    assert.equal(documentElement.getAttribute('data-theme'), 'solar', 'Expected initializeTheme() to apply the saved theme to the document');
    const activeThemes = themeButtons.filter(btn => btn.classList.active).map(btn => btn.dataset.theme);
    assert.deepEqual(activeThemes, ['solar'], 'Expected exactly the saved theme button to be marked active');
  }
};
