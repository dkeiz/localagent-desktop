const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const SessionWorkspace = require('../../src/main/session-workspace');
const { MemoryDB, makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'path-portable-tools-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-portable-tools-');
    const agentinRoot = path.join(tempDir, 'agentin');
    const agentBase = path.join(agentinRoot, 'agents');
    const workspaceBase = path.join(agentinRoot, 'workspaces');
    const connectorsDir = path.join(agentinRoot, 'connectors');
    const agentHome = path.join(agentBase, 'pro', 'portable-agent');

    fs.mkdirSync(agentHome, { recursive: true });
    fs.mkdirSync(workspaceBase, { recursive: true });
    fs.mkdirSync(connectorsDir, { recursive: true });

    const db = new MemoryDB();
    const server = new MCPServer(db, null);
    const sessionWorkspace = new SessionWorkspace(workspaceBase);
    const agentManager = {
      basePath: agentBase,
      sessionWorkspace,
      resolveAgentFolder: async () => agentHome
    };

    server.setSessionWorkspace(sessionWorkspace);
    server.setAgentManager(agentManager);
    server.setCurrentSessionId('s-portable');
    server.setCurrentAgentContext({ agentId: 1, sessionId: 's-portable' });
    server.setConnectorRuntime({
      connectorsDir,
      listConnectors: () => [],
      startConnector: async () => ({ success: true }),
      stopConnector: async () => ({ success: true }),
      getConfig: async () => ({ success: true }),
      setConfig: async () => ({ success: true })
    });

    try {
      const connectorRes = await server.executeTool('connector_op', {
        action: 'create',
        name: 'portable-test',
        code: 'module.exports = { run: async () => ({ ok: true }) };'
      });
      assert.equal(connectorRes.result.success, true, 'connector_op create should succeed');
      assert.includes(connectorRes.result.path, '{agentin}/connectors/portable-test.js', 'connector path should be tokenized');
      assert.ok(!connectorRes.result.path.includes('\\'), 'connector path should use forward slashes');

      await server.executeTool('write_file', {
        path: '{workspace}/images/demo.png',
        content: 'not-a-real-image'
      });
      const imageInfoRes = await server.executeTool('get_image_info', {
        path: '{workspace}/images/demo.png'
      });
      assert.includes(imageInfoRes.result.path, '{workspace}/images/demo.png', 'get_image_info path should be tokenized');
      assert.ok(!imageInfoRes.result.path.includes('\\'), 'get_image_info path should use forward slashes');
      assert.ok(imageInfoRes.result.size > 0, 'get_image_info should return file size');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
