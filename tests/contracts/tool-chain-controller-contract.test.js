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
  server.registerTool('demo_fail', {
    name: 'demo_fail',
    description: 'Always fails',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' }
      }
    }
  }, async () => {
    throw new Error('upstream server unreachable');
  });
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
      const dispatcher = {
        async dispatch() {
          return {
            content: 'TOOL:demo_echo{"text":"unterminated"\nThe rest of this answer should remain visible.',
            reasoning: 'r1b',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('hello', [], {});
      assert.includes(result.content, 'The rest of this answer should remain visible.', 'Expected malformed TOOL payload to preserve trailing text');
    }

    {
      const mcp = createServer();
      let turn = 0;
      const syntheticMessages = [];
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
      const result = await chain.executeWithChaining('hello', [], {
        trace: {
          async onSyntheticUserMessage(payload) {
            syntheticMessages.push(payload);
          }
        }
      });
      assert.equal(result.content, 'done', 'Expected chain to continue after real tool execution');
      assert.equal(result.chain.steps, 2, 'Expected second step after successful tool run');
      assert.ok(result.chain.tools.includes('demo_echo'), 'Expected executed tool to be tracked in chain metadata');
      assert.equal(result.reasoning, 'r3', 'Expected latest reasoning to be returned');
      assert.equal(syntheticMessages.length, 1, 'Expected backend-generated tool-results message to be traceable');
      assert.includes(syntheticMessages[0].content, '<tool_results>', 'Expected synthetic message to preserve tool-results wrapper');
    }

    {
      const mcp = createServer();
      let turn = 0;
      const dispatcher = {
        async dispatch() {
          turn++;
          if (turn === 1) {
            return {
              content: '<minimax:tool_call><invoke name="demo_echo"><parameter name="text">ok-from-invoke</parameter></invoke></minimax:tool_call>',
              reasoning: 'invoke-r1',
              model: 'demo-model',
              renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
            };
          }
          return {
            content: 'invoke done',
            reasoning: 'invoke-r2',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('hello', [], {});
      assert.equal(result.content, 'invoke done', 'Expected invoke-style tool call to execute and continue chain');
      assert.equal(result.chain.steps, 2, 'Expected invoke-style call to trigger second step');
      assert.ok(result.chain.tools.includes('demo_echo'), 'Expected invoke-style call to record demo_echo tool');
    }

    {
      const mcp = createServer();
      let turn = 0;
      const syntheticMessages = [];
      const dispatcher = {
        async dispatch() {
          turn++;
          if (turn === 1) {
            return {
              content: 'TOOL:demo_fail{"city":"Moscow"}',
              reasoning: 'r4',
              model: 'demo-model',
              renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
            };
          }
          return {
            content: 'Weather service is unavailable right now.',
            reasoning: 'r5',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('weather?', [], {
        trace: {
          async onSyntheticUserMessage(payload) {
            syntheticMessages.push(payload);
          }
        }
      });

      assert.equal(result.content, 'Weather service is unavailable right now.', 'Expected failed tool to still continue with synthetic tool_results context');
      assert.equal(result.chain.steps, 2, 'Expected a second step after tool failure');
      assert.equal(syntheticMessages.length, 1, 'Expected one synthetic tool-results message for failed tool');
      assert.includes(syntheticMessages[0].content, 'Error: upstream server unreachable', 'Expected error details to be forwarded to the model');
    }
  }
};
