const MCPServer = require('../../src/main/mcp-server');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  name: 'mcp-agent-scope-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = {
      async getSetting(key) {
        if (key === 'tool_timeout_ms') return '5000';
        return null;
      },
      get(sql, params) {
        if (!sql.includes('FROM chat_sessions')) return null;
        const sessionId = params?.[0];
        if (String(sessionId) === 'session-rag') return { agent_id: 101 };
        if (String(sessionId) === 'session-other') return { agent_id: 202 };
        return null;
      }
    };

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

    const server = new MCPServer(db, capabilityManager);
    server.setAgentManager({
      async getAgent(id) {
        if (Number(id) === 101) return { id, name: 'Universal RAG Agent' };
        if (Number(id) === 202) return { id, name: 'Web Researcher' };
        return null;
      },
      _getSafeFolderName(name) {
        return slugify(name);
      }
    });

    server.registerTool('scoped_rag_tool', {
      name: 'scoped_rag_tool',
      description: 'RAG scoped tool',
      agentScope: ['universal-rag-agent'],
      inputSchema: { type: 'object' }
    }, async () => ({ ok: true }));

    server.registerTool('global_tool', {
      name: 'global_tool',
      description: 'Global tool',
      inputSchema: { type: 'object' }
    }, async () => ({ ok: true }));

    const ragScopedTools = await server.getToolsForContext({ sessionId: 'session-rag' });
    const ragNames = ragScopedTools.map((tool) => tool.name);
    assert.ok(ragNames.includes('scoped_rag_tool'), 'Scoped tool should be visible for allowed agent scope');
    assert.ok(ragNames.includes('global_tool'), 'Global tool should stay visible for all agents');

    const otherScopedTools = await server.getToolsForContext({ sessionId: 'session-other' });
    const otherNames = otherScopedTools.map((tool) => tool.name);
    assert.equal(otherNames.includes('scoped_rag_tool'), false, 'Scoped tool should be hidden for non-matching agent');
    assert.ok(otherNames.includes('global_tool'), 'Global tool should remain visible for non-matching agent');

    const allowedResult = await server.executeTool('scoped_rag_tool', {}, null, {
      context: { sessionId: 'session-rag' }
    });
    assert.equal(allowedResult.success, true, 'Scoped tool should execute for matching agent');

    let blockedError = null;
    try {
      await server.executeTool('scoped_rag_tool', {}, null, {
        context: { sessionId: 'session-other' }
      });
    } catch (error) {
      blockedError = error;
    }

    assert.ok(blockedError, 'Scoped tool should reject for non-matching agent');
    assert.includes(blockedError.message, 'not allowed for the active agent scope');
  }
};
