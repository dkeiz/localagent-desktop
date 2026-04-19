const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const PluginManager = require('../../src/main/plugin-manager');
const { MemoryDB, TestContainer, PluginCapabilityStub, makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'agent-chat-ui-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
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

      const plugins = pluginManager.getAgentPlugins(agentInfo.slug);
      const chatUI = await pluginManager.getAgentChatUI(agentInfo);
      const preview = await pluginManager.runAgentChatUIAction(agentInfo, 'preview-file', {
        pluginId: 'agent-file-browser',
        relativePath: 'tasks/plan.md'
      });
      const refresh = await pluginManager.runAgentChatUIAction(agentInfo, 'refresh', {
        pluginId: 'agent-research-orchestrator-ui'
      });
      const chartPreview = await pluginManager.runAgentChatUIAction(agentInfo, 'preview-chart', {
        pluginId: 'agent-research-orchestrator-ui',
        relativePath: 'outputs/summary.chart.json'
      });
      const lifecycle = await pluginManager.handleAgentChatUIEvent(agentInfo, 'activated', {
        sessionId: 'session-17'
      });

      assert.ok(plugins.includes('agent-file-browser'), 'Expected shared artifact plugin for research agent');
      assert.ok(plugins.includes('agent-research-orchestrator-ui'), 'Expected individual research UI plugin');
      assert.includes(chatUI.html, 'data-agent-ui-plugin-id="agent-file-browser"', 'Expected file browser wrapper');
      assert.includes(chatUI.html, 'data-agent-ui-plugin-id="agent-research-orchestrator-ui"', 'Expected research UI wrapper');
      assert.includes(chatUI.css, '.research-orchestrator-panel', 'Expected plugin CSS to be returned');
      assert.includes(chatUI.html, 'data-agent-chart=', 'Expected research UI to expose chart specs to the chat renderer');
      assert.includes(preview.text.text, 'Status: draft', 'Expected plugin action to read agent file');
      assert.includes(refresh.html, 'Research Orchestrator', 'Expected refresh action to return updated panel HTML');
      assert.includes(chartPreview.replaceHtml.html, 'data-agent-chart=', 'Expected chart action to return declarative chart markup');
      assert.equal(lifecycle.success, true, 'Expected lifecycle event to succeed');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
