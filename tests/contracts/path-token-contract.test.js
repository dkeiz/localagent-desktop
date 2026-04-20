const fs = require('fs');
const path = require('path');
const { buildPathTokenMap, resolvePathTokens, tokenizePath } = require('../../src/main/path-tokens');
const { makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'path-token-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-path-token-');
    const agentBase = path.join(tempDir, 'agentin', 'agents');
    const workspaceBase = path.join(tempDir, 'agentin', 'workspaces');
    const agentHome = path.join(agentBase, 'pro', 'research-orchestrator');
    const agentManager = {
      basePath: agentBase,
      resolveAgentFolder: async () => agentHome
    };
    const sessionWorkspace = {
      basePath: workspaceBase,
      getWorkspacePath(sessionId) {
        return path.join(workspaceBase, String(sessionId));
      }
    };

    try {
      const tokens = await buildPathTokenMap({
        agentManager,
        sessionWorkspace,
        context: { agentId: 12, sessionId: 'abc' }
      });
      const resolved = await resolvePathTokens('{agent_outputs}/report.md', {
        agentManager,
        sessionWorkspace,
        context: { agentId: 12, sessionId: 'abc' }
      });
      const tokenized = await tokenizePath(path.join(agentHome, 'outputs', 'report.md'), {
        agentManager,
        sessionWorkspace,
        context: { agentId: 12, sessionId: 'abc' }
      });
      const unknownPath = await tokenizePath(path.join(tempDir, 'misc', 'note.txt'), {
        agentManager,
        sessionWorkspace,
        context: { agentId: 12, sessionId: 'abc' }
      });

      assert.equal(tokens['{agent_home}'], agentHome, 'Expected agent_home token');
      assert.equal(tokens['{workspace}'], path.join(workspaceBase, 'abc'), 'Expected workspace token');
      assert.equal(resolved, path.join(agentHome, 'outputs', 'report.md'), 'Expected tokenized output path');
      assert.equal(tokenized, '{agent_outputs}/report.md', 'Expected absolute path to be tokenized');
      assert.ok(unknownPath.includes('/'), 'Expected non-tokenized paths to be normalized with forward slashes');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
