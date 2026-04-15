const MCPServer = require('../../src/main/mcp-server');

function createServer() {
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

  const db = {
    async getSetting(key) {
      if (key === 'tool_timeout_ms') return '5000';
      return null;
    }
  };

  const server = new MCPServer(db, capabilityManager);
  server.registerTool('demo_echo', {
    name: 'demo_echo',
    description: 'Echo input',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' }
      }
    }
  }, async (params) => ({ text: params.text }));
  return server;
}

module.exports = {
  name: 'mcp-tool-parse-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const server = createServer();

    const valid = server.parseToolCall('TOOL:demo_echo{"text":"ok"}');
    assert.equal(valid.length, 1, 'Expected valid tool call to be executable');
    assert.equal(valid[0].toolName, 'demo_echo', 'Expected parsed tool name to match');
    assert.equal(valid[0].params.text, 'ok', 'Expected parsed params to be preserved');

    const malformed = server.parseToolCall('TOOL:demo_echo{"text":}');
    assert.equal(malformed.length, 0, 'Expected malformed JSON call to be non-executable');

    const unknownTool = server.parseToolCall('TOOL:does_not_exist{"text":"x"}');
    assert.equal(unknownTool.length, 0, 'Expected unknown tool to be non-executable');

    const recovered = server.parseToolCall(
      'Need a quick action. Use demo_echo."text":"purple sun"}'
    );
    assert.equal(recovered.length, 1, 'Expected malformed no-TOOL fragment to be recovered into one executable call');
    assert.equal(recovered[0].toolName, 'demo_echo', 'Expected recovered tool name');
    assert.equal(recovered[0].params.text, 'purple sun', 'Expected recovered parameter value');
  }
};
