const MCPServer = require('../../src/main/mcp-server');
const ToolChainController = require('../../src/main/tool-chain-controller');

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
  }, async (params) => ({ echoed: params.text }));
  return server;
}

module.exports = {
  name: 'tool-chain-controller-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = {};

    {
      const mcp = createServer();
      let executeCount = 0;
      const originalExecute = mcp.executeTool.bind(mcp);
      mcp.executeTool = async (...args) => {
        executeCount++;
        return originalExecute(...args);
      };

      const dispatcher = {
        async dispatch() {
          return {
            content: 'TOOL:demo_echo{"text":}',
            reasoning: 'r1',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('hello', [], {});
      assert.equal(executeCount, 0, 'Expected malformed tool call not to execute');
      assert.equal(result.chain.steps, 1, 'Expected malformed response to end turn without continuation');
      assert.equal(result.reasoning, 'r1', 'Expected reasoning to be preserved on terminal return');
    }

    {
      const mcp = createServer();
      let turn = 0;
      const dispatcher = {
        async dispatch() {
          turn++;
          if (turn === 1) {
            return {
              content: 'TOOL:demo_echo{"text":"ok"}',
              reasoning: 'r2',
              model: 'demo-model',
              renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
            };
          }
          return {
            content: 'done',
            reasoning: 'r3',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('hello', [], {});
      assert.equal(result.content, 'done', 'Expected chain to continue after real tool execution');
      assert.equal(result.chain.steps, 2, 'Expected second step after successful tool run');
      assert.ok(result.chain.tools.includes('demo_echo'), 'Expected executed tool to be tracked in chain metadata');
      assert.equal(result.reasoning, 'r3', 'Expected latest reasoning to be returned');
    }
  }
};

