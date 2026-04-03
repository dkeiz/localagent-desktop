const MCPServer = require('../src/main/mcp-server');

class FakeDB {
  constructor() {
    this.settings = new Map();
  }

  async getSetting(key) {
    if (!this.settings.has(key)) return null;
    return this.settings.get(key);
  }

  async setSetting(key, value) {
    this.settings.set(key, value);
    return true;
  }
}

async function run() {
  const db = new FakeDB();
  const capabilityManager = {
    isToolActive: () => false,
    getGroupsConfig: () => []
  };

  const server = new MCPServer(db, capabilityManager);
  server.registerTool('probe_tool', {
    name: 'probe_tool',
    description: 'Probe tool',
    userDescription: 'Probe tool',
    inputSchema: { type: 'object' }
  }, async () => ({ ok: true }));

  // Simulate old allow-once logic behavior:
  // set per-tool DB state true, then execute without bypass.
  await server.setToolActiveState('probe_tool', true);
  const oldFlowResult = await server.executeTool('probe_tool', {});

  // Set DB back to disabled and test new bypass execution.
  await server.setToolActiveState('probe_tool', false);
  const bypassResult = await server.executeTool('probe_tool', {}, null, { bypassPermissions: true });

  const output = {
    oldFlow: {
      needsPermission: oldFlowResult && oldFlowResult.needsPermission === true,
      reason: oldFlowResult && oldFlowResult.reason
    },
    bypassFlow: {
      success: bypassResult && bypassResult.success === true,
      toolName: bypassResult && bypassResult.toolName,
      payload: bypassResult && bypassResult.result
    }
  };

  console.log(JSON.stringify(output, null, 2));

  const ok = output.oldFlow.needsPermission
    && output.oldFlow.reason === 'capability_group_disabled'
    && output.bypassFlow.success
    && output.bypassFlow.payload
    && output.bypassFlow.payload.ok === true;

  process.exitCode = ok ? 0 : 1;
}

run().catch((err) => {
  console.error(err);
  process.exit(2);
});
