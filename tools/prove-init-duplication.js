const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...cls) { cls.forEach(c => this.set.add(c)); }
  remove(...cls) { cls.forEach(c => this.set.delete(c)); }
  toggle(cls, force) {
    if (force === true) { this.set.add(cls); return true; }
    if (force === false) { this.set.delete(cls); return false; }
    if (this.set.has(cls)) { this.set.delete(cls); return false; }
    this.set.add(cls); return true;
  }
  contains(cls) { return this.set.has(cls); }
}

class FakeElement {
  constructor(id = null) {
    this.id = id;
    this.listeners = new Map();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
  }

  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  querySelectorAll() { return []; }
  querySelector() { return new FakeElement(); }
  appendChild(child) { this.children.push(child); return child; }
  insertBefore(child) { this.children.push(child); return child; }
  remove() {}
  closest() { return null; }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name]; }
  focus() {}
  click() {}
}

function createEnvironment() {
  const domListeners = { DOMContentLoaded: [] };
  const elementMap = new Map();

  const ensure = (id) => {
    if (!elementMap.has(id)) elementMap.set(id, new FakeElement(id));
    return elementMap.get(id);
  };

  const document = {
    readyState: 'loading',
    body: new FakeElement('body'),
    head: new FakeElement('head'),
    documentElement: new FakeElement('html'),
    addEventListener: (type, cb) => {
      if (!domListeners[type]) domListeners[type] = [];
      domListeners[type].push(cb);
    },
    getElementById: (id) => ensure(id),
    createElement: () => new FakeElement(),
    querySelector: (selector) => {
      if (selector === '.app-container') return ensure('app-container');
      if (selector === '[data-tab="mcp"]') return ensure('tab-mcp');
      return ensure(`qs:${selector}`);
    },
    querySelectorAll: (selector) => {
      if (selector === '.nav-btn') {
        const a = ensure('nav-btn-1'); a.dataset.tab = 'chat';
        const b = ensure('nav-btn-2'); b.dataset.tab = 'api';
        return [a, b];
      }
      if (selector === '.theme-btn') {
        const a = ensure('theme-btn-1'); a.dataset.theme = 'light';
        const b = ensure('theme-btn-2'); b.dataset.theme = 'dark';
        return [a, b];
      }
      return [];
    }
  };

  // Prime known elements used by init paths.
  [
    'send-btn', 'stop-btn', 'message-input', 'new-chat-btn', 'attach-btn', 'voice-btn', 'speak-btn',
    'drop-zone', 'save-prompt-btn', 'add-proxy-btn', 'new-session-btn',
    'left-sidebar', 'right-panel', 'toggle-left-sidebar', 'toggle-right-panel',
    'tool-groups-container', 'theme-picker', 'delete-all-conversations-btn', 'delete-confirm-modal',
    'cancel-delete-btn', 'confirm-delete-btn', 'chat-sessions-list'
  ].forEach(ensure);

  const toolPermissionListeners = [];
  const conversationListeners = [];

  const electronAPI = {
    onToolPermissionRequest: (cb) => toolPermissionListeners.push(cb),
    onConversationUpdate: (cb) => conversationListeners.push(cb),
    listenerCount: (channel) => {
      if (channel === 'tool-permission-request') return toolPermissionListeners.length;
      if (channel === 'conversation-update') return conversationListeners.length;
      return 0;
    },
    sendMessage: async () => ({ content: 'ok' }),
    stopGeneration: async () => ({}),
    invoke: async (name) => {
      if (name === 'create-chat-session') return { id: 1 };
      return {};
    },
    getSettings: async () => ({}),
    getChatSessions: async () => [{ id: 1 }],
    loadChatSession: async () => [],
    switchChatSession: async () => ({}),
    getConversations: async () => [],
    getSystemPrompt: async () => '',
    getToolGroups: async () => [],
    deactivateToolGroup: async () => ({}),
    activateToolGroup: async () => ({}),
    deleteAllConversations: async () => ({}),
    llm: {
      getConfig: async () => ({}),
      getModels: async () => [],
      getProviderProfiles: async () => ({ providers: [] }),
      getModelProfile: async () => null,
      saveConfig: async () => ({}),
      fetchQwenOAuth: async () => ({}),
      testModel: async () => ({ success: true, model: 'x' })
    },
    getProviders: async () => [],
    verifyQwenKey: async () => ({ success: true, modelCount: 0 })
  };

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };

  const context = {
    console,
    document,
    localStorage,
    window: null,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
    speechSynthesis: { cancel() {}, speak() {} },
    alert: () => {},
    confirm: () => true,
    location: { reload() {} },
    navigator: { userAgent: 'node' }
  };

  context.window = context;
  context.window.addEventListener = () => {};
  context.window.removeEventListener = () => {};
  context.window.document = document;
  context.window.localStorage = localStorage;
  context.window.electronAPI = electronAPI;
  context.window.initializeApiProviderSettings = async () => {};
  context.window.CommandHandler = class {
    constructor(mainPanel) { this.mainPanel = mainPanel; }
    getCompletions() { return []; }
    async execute() { return { output: null, passthrough: null }; }
  };

  return { context, domListeners, elementMap };
}

async function runProof() {
  const { context, domListeners, elementMap } = createEnvironment();
  vm.createContext(context);

  const root = process.cwd();
  const mainPanelPath = path.join(root, 'src', 'renderer', 'components', 'main-panel.js');
  const appPath = path.join(root, 'src', 'renderer', 'app.js');

  const mainPanelCode = fs.readFileSync(mainPanelPath, 'utf8');
  const appCode = fs.readFileSync(appPath, 'utf8');

  vm.runInContext(mainPanelCode, context, { filename: 'main-panel.js' });
  vm.runInContext(appCode, context, { filename: 'app.js' });

  const legacyMode = process.argv.includes('--legacy-app-double-init');

  // Count constructor executions by replacing class before DOMContentLoaded fires.
  vm.runInContext(`
    window.__proof = { ctorCount: 0 };
    const __OriginalMainPanel = MainPanel;
    __OriginalMainPanel.prototype.initializeVoice = function() {};
    __OriginalMainPanel.prototype.initContextSettings = function() {};
    __OriginalMainPanel.prototype.restoreOpenTabs = async function() {};
    __OriginalMainPanel.prototype.initializeSession = async function() {};
    MainPanel = class extends __OriginalMainPanel {
      constructor(...args) {
        window.__proof.ctorCount += 1;
        super(...args);
      }
    };
    App.prototype.initializeApp = async function() {};
    App.prototype.initializePanelToggles = function() {};
    App.prototype.initializeToolGroups = async function() {};
    App.prototype.initializeTheme = function() {};
  `, context);

  if (legacyMode) {
    vm.runInContext(`
      const __OriginalApp = App;
      App = class extends __OriginalApp {
        constructor(...args) {
          super(...args);
          this.mainPanel = new MainPanel();
        }
      };
    `, context);
  }

  const callbacks = domListeners.DOMContentLoaded || [];
  for (const cb of callbacks) {
    const ret = cb();
    if (ret && typeof ret.then === 'function') await ret;
  }

  const sendBtn = elementMap.get('send-btn');
  const result = {
    domContentLoadedHandlers: callbacks.length,
    mainPanelCtorCalls: context.window.__proof.ctorCount,
    sendBtnClickListeners: sendBtn ? sendBtn.listenerCount('click') : 0,
    toolPermissionIpcListeners: context.window.electronAPI.listenerCount('tool-permission-request'),
    conversationUpdateIpcListeners: context.window.electronAPI.listenerCount('conversation-update'),
    windowMainPanelExists: Boolean(context.window.mainPanel),
    windowAppMainPanelExists: Boolean(context.window.app && context.window.app.mainPanel),
    sameReference: Boolean(context.window.app && context.window.mainPanel === context.window.app.mainPanel)
  };

  console.log(JSON.stringify(result, null, 2));
  const modeArg = process.argv.find(arg => arg.startsWith('--expect=')) || '';
  const expected = modeArg.split('=')[1] || '';
  const doubled = result.mainPanelCtorCalls > 1
    && result.sendBtnClickListeners > 1
    && result.toolPermissionIpcListeners > 1;

  if (expected === 'double' && !doubled) {
    process.exitCode = 1;
  } else if (expected === 'single' && doubled) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

runProof().catch((err) => {
  console.error(err);
  process.exit(2);
});
