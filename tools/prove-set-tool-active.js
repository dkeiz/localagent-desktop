const setupIpcHandlers = require('../src/main/ipc-handlers');
const CapabilityManager = require('../src/main/capability-manager');
const MCPServer = require('../src/main/mcp-server');

class FakeDB {
  constructor() { this.map = new Map(); }
  getSetting = async (k) => this.map.has(k) ? this.map.get(k) : null;
  setSetting = async (k,v) => { this.map.set(k,String(v)); };
  setToolActive = async (tool, active) => { this.map.set(`tool.${tool}.active`, active ? 'true' : 'false'); return {tool,active}; };
  getToolStates = async () => {
    const out = {};
    for (const [k,v] of this.map.entries()) {
      if (k.startsWith('tool.') && k.endsWith('.active')) out[k.slice(5,-7)] = { active: v === 'true' };
    }
    return out;
  };
  // required by setup but unused in this test
  getConversations = async () => [];
  addConversation = async () => {};
  getCurrentSession = async () => null;
  setCurrentSession = async () => {};
  createChatSession = async () => ({id:1});
  getChatSessions = async () => [];
  loadChatSession = async () => [];
  deleteChatSession = async () => {};
  deleteAllConversations = async () => {};
  getContextSetting = async () => null;
  saveSetting = async (k,v)=>{this.map.set(k,String(v));};
  getSettings = async () => ({});
  getProviders = async () => [];
  getPromptRules = async () => [];
}

class FakeIpcMain {
  constructor(){ this.handlers=new Map(); }
  handle(name, fn){ this.handlers.set(name, fn); }
}

(async () => {
  const db = new FakeDB();
  const capability = new CapabilityManager(db);
  capability.setMainEnabled(true);
  capability.setGroupEnabled('ports', false);

  const mcp = new MCPServer(db, capability);

  const ipcMain = new FakeIpcMain();
  const mainWindow = { webContents: { send: () => {} } };
  const aiService = { initialize: async () => {} };

  setupIpcHandlers(
    ipcMain, db, aiService, mcp, mainWindow, null, null, null, null,
    capability, null, null, null, null, null, null, null, null,
    null, null, null
  );

  const setToolActive = ipcMain.handlers.get('set-tool-active');
  if (!setToolActive) throw new Error('handler missing');

  const before = {
    portsEnabled: capability.isGroupEnabled('ports'),
    toolActiveByCap: capability.isToolActive('list_connectors'),
    toolStates: await db.getToolStates()
  };

  const res = await setToolActive({}, 'list_connectors', true);

  const after = {
    portsEnabled: capability.isGroupEnabled('ports'),
    toolActiveByCap: capability.isToolActive('list_connectors'),
    toolStates: await db.getToolStates(),
    result: res
  };

  console.log(JSON.stringify({ before, after }, null, 2));
})();
