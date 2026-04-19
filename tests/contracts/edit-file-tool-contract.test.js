const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const { MemoryDB, makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'edit-file-tool-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-edit-file-');
    const agentHome = path.join(tempDir, 'agents', 'sub', 'worker');
    fs.mkdirSync(path.join(agentHome, 'tasks'), { recursive: true });

    try {
      const server = new MCPServer(new MemoryDB(), null);
      server.setAgentManager({
        basePath: path.join(tempDir, 'agents'),
        resolveAgentFolder: async () => agentHome
      });
      server.setCurrentAgentContext({ agentId: 1, sessionId: 's1' });

      await server.executeTool('write_file', {
        path: '{agent_tasks}/plan.md',
        content: 'Status: pending\n- [ ] collect data\n'
      });
      const editResult = await server.executeTool('edit_file', {
        path: '{agent_tasks}/plan.md',
        edits: [
          { search: 'Status: pending', replace: 'Status: in-progress' },
          { search: '- [ ] collect data', replace: '- [x] collect data' },
          { search: 'missing text', replace: 'unused' }
        ]
      });
      const readResult = await server.executeTool('read_file', {
        path: '{agent_tasks}/plan.md'
      });

      assert.equal(editResult.result.editsApplied, 2, 'Expected two applied edits');
      assert.equal(editResult.result.editsSkipped, 1, 'Expected one skipped edit');
      assert.includes(readResult.result.content, 'Status: in-progress');
      assert.includes(readResult.result.content, '- [x] collect data');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
