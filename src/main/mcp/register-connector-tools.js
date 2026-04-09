function registerConnectorTools(server) {
  function getConnectorFilePath(name) {
    const fs = require('fs');
    const path = require('path');
    const connectorsDir = server._connectorRuntime?.connectorsDir
      || path.join(__dirname, '../../../agentin/connectors');
    if (!fs.existsSync(connectorsDir)) {
      fs.mkdirSync(connectorsDir, { recursive: true });
    }
    return path.join(connectorsDir, `${name}.js`);
  }

  server.registerTool('create_connector', {
    name: 'create_connector',
    description: 'Create a new connector JS file in agentin/connectors/. The file should export {name, description, configSchema, start(context), stop()}. Use connector_config to store API keys BEFORE creating the file.',
    userDescription: 'Create a new external service connector script',
    example: 'TOOL:create_connector{"name":"my-service","code":"module.exports = { name: \'my-service\', ... }"}',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Connector name (used as filename, no .js extension)' },
        code: { type: 'string', description: 'Full JavaScript source code for the connector' }
      },
      required: ['name', 'code']
    }
  }, async (params) => {
    const fs = require('fs');
    const filePath = getConnectorFilePath(params.name);
    fs.writeFileSync(filePath, params.code, 'utf-8');
    return { success: true, path: filePath, name: params.name };
  });

  server.registerTool('start_connector', {
    name: 'start_connector',
    description: 'Start a connector by name. The connector JS file must exist in agentin/connectors/.',
    userDescription: 'Start an external service connector',
    example: 'TOOL:start_connector{"name":"telegram-bot"}',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Connector name (filename without .js)' }
      },
      required: ['name']
    }
  }, async (params) => {
    if (!server._connectorRuntime) return { error: 'Connector runtime not initialized' };
    return await server._connectorRuntime.startConnector(params.name);
  });

  server.registerTool('stop_connector', {
    name: 'stop_connector',
    description: 'Stop a running connector by name.',
    userDescription: 'Stop a running external service connector',
    example: 'TOOL:stop_connector{"name":"telegram-bot"}',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Connector name to stop' }
      },
      required: ['name']
    }
  }, async (params) => {
    if (!server._connectorRuntime) return { error: 'Connector runtime not initialized' };
    return await server._connectorRuntime.stopConnector(params.name);
  });

  server.registerTool('list_connectors', {
    name: 'list_connectors',
    description: 'List all available connectors and their status (running/stopped/error).',
    userDescription: 'List all external service connectors',
    example: 'TOOL:list_connectors{}',
    inputSchema: { type: 'object' }
  }, async () => {
    if (!server._connectorRuntime) return { error: 'Connector runtime not initialized' };
    return await server._connectorRuntime.listConnectors();
  });

  server.registerTool('connector_config', {
    name: 'connector_config',
    description: 'Set or get configuration values for a connector. API keys and secrets are stored securely in the database, never in connector files.',
    userDescription: 'Manage connector configuration (API keys, settings)',
    example: 'TOOL:connector_config{"name":"telegram-bot","action":"set","key":"botToken","value":"123:ABC"}',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Connector name' },
        action: { type: 'string', enum: ['set', 'get'], description: 'set or get config' },
        key: { type: 'string', description: 'Config key (for set action)' },
        value: { type: 'string', description: 'Config value (for set action)' }
      },
      required: ['name', 'action']
    }
  }, async (params) => {
    if (!server._connectorRuntime) return { error: 'Connector runtime not initialized' };
    if (params.action === 'set') {
      return await server._connectorRuntime.setConfig(params.name, params.key, params.value);
    }
    return await server._connectorRuntime.getConfig(params.name);
  });
}

module.exports = { registerConnectorTools };
