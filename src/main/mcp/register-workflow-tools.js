function registerWorkflowTools(server) {
  server.registerTool('list_workflows', {
    name: 'list_workflows',
    description: 'List all saved workflows with their names, descriptions, tool chains, and execution stats. Use this to discover available workflows before executing them.',
    userDescription: 'List all saved automation workflows',
    example: 'TOOL:list_workflows{}',
    inputSchema: { type: 'object' }
  }, async () => {
    if (!server._workflowManager) return { error: 'Workflow manager not initialized' };
    const workflows = await server._workflowManager.getWorkflows();
    return workflows.map(workflow => {
      let tools = [];
      try {
        const chain = typeof workflow.tool_chain === 'string'
          ? JSON.parse(workflow.tool_chain)
          : (workflow.tool_chain || []);
        tools = chain.map(step => step.tool);
      } catch {}

      return {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        tools,
        success_count: workflow.success_count || 0,
        failure_count: workflow.failure_count || 0,
        last_used: workflow.last_used,
        created_at: workflow.created_at
      };
    });
  });

  server.registerTool('execute_workflow', {
    name: 'execute_workflow',
    description: 'Execute a saved workflow by its ID. Optionally override parameters for specific tools. The workflow runs each tool in sequence and returns all results.',
    userDescription: 'Run a saved workflow with optional parameter overrides',
    example: 'TOOL:execute_workflow{"id":1}',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Workflow ID to execute' },
        param_overrides: {
          type: 'object',
          description: 'Optional parameter overrides keyed by tool name, e.g. {"search_web_bing": {"query": "new query"}}',
          default: {}
        }
      },
      required: ['id']
    }
  }, async (params) => {
    if (!server._workflowManager) return { error: 'Workflow manager not initialized' };
    return await server._workflowManager.executeWorkflow(params.id, params.param_overrides || {});
  });

  server.registerTool('create_workflow', {
    name: 'create_workflow',
    description: 'Create a new workflow from a name, description, and tool chain. The tool_chain is an array of steps, each with a tool name and its parameters.',
    userDescription: 'Create a new automation workflow',
    example: 'TOOL:create_workflow{"name":"System Health Check","description":"Checks memory and disk","tool_chain":[{"tool":"get_memory_usage","params":{}},{"tool":"get_disk_space","params":{}}]}',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        description: { type: 'string', description: 'What this workflow does' },
        tool_chain: {
          type: 'array',
          description: 'Array of tool steps: [{"tool": "tool_name", "params": {...}}, ...]',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'Tool name' },
              params: { type: 'object', description: 'Tool parameters', default: {} }
            },
            required: ['tool']
          }
        }
      },
      required: ['name', 'tool_chain']
    }
  }, async (params) => {
    if (!server._workflowManager) return { error: 'Workflow manager not initialized' };
    const result = await server._workflowManager.captureWorkflow(
      params.name,
      params.tool_chain.map(step => ({ tool: step.tool, params: step.params || {} })),
      params.name
    );
    return { success: true, id: result.id, name: params.name, tools: params.tool_chain.map(step => step.tool) };
  });

  server.registerTool('copy_workflow', {
    name: 'copy_workflow',
    description: 'Clone an existing workflow to create a new one based on it. Useful for creating variations of proven workflows.',
    userDescription: 'Copy/clone a workflow as a starting point for a new one',
    example: 'TOOL:copy_workflow{"source_id":1,"new_name":"Extended System Check"}',
    inputSchema: {
      type: 'object',
      properties: {
        source_id: { type: 'number', description: 'ID of the workflow to copy' },
        new_name: { type: 'string', description: 'Name for the copy (defaults to "Original (copy)")' }
      },
      required: ['source_id']
    }
  }, async (params) => {
    if (!server._workflowManager) return { error: 'Workflow manager not initialized' };
    return await server._workflowManager.copyWorkflow(params.source_id, params.new_name);
  });

  server.registerTool('delete_workflow', {
    name: 'delete_workflow',
    description: 'Delete a saved workflow by its ID.',
    userDescription: 'Delete a saved workflow',
    example: 'TOOL:delete_workflow{"id":1}',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Workflow ID to delete' }
      },
      required: ['id']
    }
  }, async (params) => {
    if (!server._workflowManager) return { error: 'Workflow manager not initialized' };
    await server._workflowManager.deleteWorkflow(params.id);
    return { success: true, deleted_id: params.id };
  });
}

module.exports = { registerWorkflowTools };
