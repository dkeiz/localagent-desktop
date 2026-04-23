const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const PluginManager = require('../../src/main/plugin-manager');
const { MemoryDB, TestContainer, PluginCapabilityStub, makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'agent-chat-ui-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-agent-ui-');
    const agentHome = path.join(tempDir, 'research-orchestrator');
    fs.mkdirSync(path.join(agentHome, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(agentHome, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(agentHome, 'tasks', 'plan.md'), '# Plan\nStatus: draft\n', 'utf-8');
    fs.writeFileSync(
      path.join(agentHome, 'outputs', 'summary.chart.json'),
      JSON.stringify({ type: 'bar', title: 'Findings', labels: ['A', 'B'], values: [2, 5] }),
      'utf-8'
    );

    try {
      const db = new MemoryDB();
      const capabilityManager = new PluginCapabilityStub();
      const mcpServer = new MCPServer(db, capabilityManager);
      const container = new TestContainer({ db, mcpServer, capabilityManager });
      const pluginManager = new PluginManager(container);
      await pluginManager.initialize();

      await pluginManager.enablePlugin('agent-file-browser');
      await pluginManager.enablePlugin('agent-research-orchestrator-ui');

      const agentInfo = {
        id: 17,
        slug: 'research-orchestrator',
        name: 'Research Orchestrator',
        folderPath: agentHome
      };

      const chatUI = await pluginManager.getAgentChatUI(agentInfo, {
        sessionId: 'session-17',
        uiMode: 'plugin'
      });
      assert.ok(chatUI, 'Expected chat UI to resolve for plugin mode');
      assert.equal(chatUI.uiPluginId, 'agent-research-orchestrator-ui', 'Expected primary contract plugin to own chat UI');
      assert.includes(chatUI.html, 'data-agent-ui-plugin-id="agent-research-orchestrator-ui"', 'Expected research owner plugin wrapper');
      assert.equal(
        chatUI.html.includes('data-agent-ui-plugin-id="agent-file-browser"'),
        false,
        'Expected non-owner chat UI plugin to be excluded from rendering'
      );

      const refresh = await pluginManager.runAgentChatUIAction(agentInfo, 'refresh', {
        pluginId: 'agent-research-orchestrator-ui'
      }, {
        sessionId: 'session-17',
        uiMode: 'plugin'
      });
      assert.includes(refresh.html, 'Research Orchestrator', 'Expected owner action to execute');

      let rejected = false;
      try {
        await pluginManager.runAgentChatUIAction(agentInfo, 'open-file', {
          pluginId: 'agent-file-browser',
          relativePath: 'tasks/plan.md'
        }, {
          sessionId: 'session-17',
          uiMode: 'plugin'
        });
      } catch (error) {
        rejected = /not found/i.test(String(error?.message || ''));
      }
      assert.equal(rejected, true, 'Expected non-owner plugin action to be rejected');

      const classicUi = await pluginManager.getAgentChatUI(agentInfo, {
        sessionId: 'session-17',
        uiMode: 'no_ui'
      });
      assert.equal(classicUi, null, 'Expected no_ui mode to bypass plugin chat UI');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
