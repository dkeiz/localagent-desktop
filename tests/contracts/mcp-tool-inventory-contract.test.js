const MCPServer = require('../../src/main/mcp-server');
const expectedInventory = require('../fixtures/mcp-tool-inventory.json');

module.exports = {
  name: 'mcp-tool-inventory-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const server = new MCPServer(
      { getSetting: async () => null },
      { getGroupsConfig: () => [], getActiveTools: () => [] }
    );

    const actualInventory = server.getTools().map(tool => tool.name).sort();
    assert.deepEqual(
      actualInventory,
      expectedInventory,
      'Built-in MCP tool inventory changed unexpectedly'
    );
  }
};
