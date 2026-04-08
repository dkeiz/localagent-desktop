const MCPServer = require('../../src/main/mcp-server');

module.exports = {
  name: 'mcp-session-context-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const capabilityManager = {
      isToolActive() {
        return true;
      },
      getGroupsConfig() {
        return [];
      },
      getActiveTools() {
        return [];
      }
    };

    const server = new MCPServer(
      {
        async getSetting(key) {
          if (key === 'tool_timeout_ms') return '5000';
          return null;
        }
      },
      capabilityManager
    );

    server.registerTool('session_echo_test', {
      name: 'session_echo_test',
      description: 'Test helper',
      inputSchema: { type: 'object' }
    }, async () => ({ sessionId: server.getCurrentSessionId() || null }));

    server.setCurrentSessionId('parent-session');

    const baseResult = await server.executeTool('session_echo_test', {});
    assert.equal(baseResult.result.sessionId, 'parent-session', 'Expected default current session id');

    const childResult = await server.executeTool('session_echo_test', {}, null, {
      context: {
        sessionId: 'child-session'
      }
    });
    assert.equal(childResult.result.sessionId, 'child-session', 'Expected execution context session id override');

    const restoredResult = await server.executeTool('session_echo_test', {});
    assert.equal(restoredResult.result.sessionId, 'parent-session', 'Expected execution context to be restored after scoped tool call');
  }
};
