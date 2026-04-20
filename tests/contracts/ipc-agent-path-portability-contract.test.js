const fs = require('fs');
const path = require('path');
const { registerAgentSystemHandlers } = require('../../src/main/ipc/register-agent-system-handlers');
const { makeTempDir } = require('../helpers/fakes');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, fn) {
    if (this.handlers.has(channel)) {
      throw new Error(`duplicate handler: ${channel}`);
    }
    this.handlers.set(channel, fn);
  }

  async invoke(channel, ...args) {
    const fn = this.handlers.get(channel);
    if (!fn) throw new Error(`missing handler: ${channel}`);
    return fn({}, ...args);
  }
}

module.exports = {
  name: 'ipc-agent-path-portability-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-ipc-agent-path-');
    const agentBase = path.join(tempDir, 'agentin', 'agents');
    const agentHome = path.join(agentBase, 'pro', 'portable-agent');
    const taskFile = path.join(agentHome, 'tasks', 'plan.md');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, 'ship-ready\n', 'utf-8');

    const ipcMain = new FakeIpcMain();
    const runtime = {
      mcpServer: { on() {} },
      windowManager: { send() {} },
      aiService: {},
      portListenerManager: { register: async () => ({}), unregister: async () => ({}), getListeners: () => [] },
      agentMemory: {
        append: async () => ({}),
        read: async () => ({}),
        list: async () => [],
        getStats: () => ({}),
        saveImage: async () => ({})
      },
      agentLoop: { loadMemoryContext: async () => null, getSession: () => ({ autoMemory: false, idleSeconds: 0 }) },
      connectorRuntime: { listConnectors: async () => [], startConnector: async () => ({}), stopConnector: async () => ({}), getLogs: async () => [] },
      agentManager: {
        basePath: agentBase,
        resolveAgentFolder: async () => agentHome,
        getAgents: async () => [],
        getAgent: async () => ({ id: 1, name: 'Portable Agent' }),
        createAgent: async () => ({}),
        updateAgent: async () => ({}),
        deleteAgent: async () => ({}),
        activateAgent: async () => ({}),
        deactivateAgent: async () => ({}),
        compactAgent: async () => ({}),
        _getSafeFolderName: () => 'portable-agent'
      },
      pluginManager: null,
      eventBus: { publish() {}, getLog: () => [] },
      memoryDaemon: { running: false, start: async () => {}, stop() {}, getStatus: () => ({ running: false }) },
      workflowScheduler: {
        running: false,
        start: async () => {},
        stop() {},
        getStatus: () => ({ running: false }),
        addSchedule: async () => ({}),
        removeSchedule: async () => ({}),
        toggleSchedule: async () => ({}),
        _getAllSchedules: () => []
      },
      sessionInitManager: { detectStartType: async () => ({ isColdStart: false }), buildColdStartPrompt: async () => null, buildBaseInitReport: async () => ({}) },
      db: { getSetting: async () => null, saveSetting: async () => ({}) },
      testClientMode: false
    };

    try {
      registerAgentSystemHandlers(ipcMain, runtime, { syncDaemonEnabledSetting: async () => ({}) });

      const listed = await ipcMain.invoke('list-agent-files', 1);
      assert.equal(listed.success, true, 'list-agent-files should succeed');
      assert.includes(listed.root, '{agent_home}', 'list-agent-files root should be tokenized');
      assert.ok(!listed.root.includes('\\'), 'list-agent-files root should use forward slashes');

      const read = await ipcMain.invoke('read-agent-file', 1, 'tasks/plan.md');
      assert.equal(read.success, true, 'read-agent-file should succeed');
      assert.ok(read.path.startsWith('{agent_'), 'read-agent-file path should use agent token');
      assert.includes(read.path, '/plan.md', 'read-agent-file path should preserve filename');
      assert.ok(!read.path.includes('\\'), 'read-agent-file path should use forward slashes');
      assert.includes(read.content, 'ship-ready', 'read-agent-file should return content');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
