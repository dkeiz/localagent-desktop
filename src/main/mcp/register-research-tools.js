function registerResearchTools(server) {
  server.registerTool('start_research', {
    name: 'start_research',
    description: 'Start an empirical research run that executes baseline and variant workflows, measures outcomes, ranks candidates, and produces artifacts.',
    userDescription: 'Start an experimental workflow-based research run',
    example: 'TOOL:start_research{"goal":"Find best workflow variant","baseline_workflow_id":1,"variants":[{"id":"V1","workflow_id":2}]}',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Research goal statement' },
        baseline_workflow_id: { type: 'number', description: 'Workflow ID used as baseline' },
        baseline_param_overrides: { type: 'object', description: 'Optional baseline overrides', default: {} },
        variants: {
          type: 'array',
          description: 'Variant workflow configs',
          default: []
        },
        workflow_mode: {
          type: 'string',
          description: 'Default workflow execution mode for experiments',
          default: 'auto'
        },
        scoring_method: {
          type: 'string',
          description: 'Scoring method label to record in artifacts',
          default: 'model-selected'
        },
        auto_save_knowledge: {
          type: 'boolean',
          description: 'Persist summarized research outcome to knowledge store',
          default: true
        }
      },
      required: ['goal', 'baseline_workflow_id']
    }
  }, async (params) => {
    if (!server._researchRuntime) {
      return { error: 'Research runtime not initialized' };
    }
    return server._researchRuntime.startResearch({
      ...params,
      session_id: server.getCurrentSessionId?.() || null
    });
  });

  server.registerTool('get_research_run', {
    name: 'get_research_run',
    description: 'Get an empirical research run by run_id including status and final result if available.',
    userDescription: 'Get current state of a research run',
    example: 'TOOL:get_research_run{"run_id":"research-20260409-ab12cd"}',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Research run identifier' }
      },
      required: ['run_id']
    }
  }, async (params) => {
    if (!server._researchRuntime) {
      return null;
    }
    return server._researchRuntime.getRun(params.run_id);
  });

  server.registerTool('list_research_runs', {
    name: 'list_research_runs',
    description: 'List recent research runs and statuses for polling and tracking.',
    userDescription: 'List recent research runs',
    example: 'TOOL:list_research_runs{"limit":10}',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum runs to return', default: 20 },
        status: { type: 'string', description: 'Optional status filter' }
      }
    }
  }, async (params) => {
    if (!server._researchRuntime) {
      return [];
    }
    return server._researchRuntime.listRuns({
      limit: params.limit || 20,
      status: params.status
    });
  });
}

module.exports = { registerResearchTools };
