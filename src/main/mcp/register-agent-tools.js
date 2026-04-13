async function resolveSubagent(server, params) {
  if (!server._agentManager) {
    throw new Error('AgentManager not initialized');
  }

  if (params.agent_id !== undefined && params.agent_id !== null) {
    const agent = await server._agentManager.getAgent(params.agent_id);
    if (!agent || agent.type !== 'sub') {
      throw new Error(`Sub-agent ${params.agent_id} not found`);
    }
    return agent;
  }

  if (params.agent_name) {
    const targetName = String(params.agent_name).trim().toLowerCase();
    const agents = await server._agentManager.getAgents('sub');
    const match = agents.find(agent => agent.name.toLowerCase() === targetName);
    if (!match) {
      throw new Error(`Sub-agent "${params.agent_name}" not found`);
    }
    return match;
  }

  throw new Error('Provide agent_id or agent_name');
}

function normalizeSubagentMode(rawMode, fallback = 'no_ui') {
  const value = String(rawMode || '').trim().toLowerCase();
  if (value === 'ui') return 'ui';
  if (value === 'noui' || value === 'no_ui' || value === 'backend') return 'no_ui';
  return fallback;
}

function normalizeCompletionPayload(params) {
  const status = String(params.status || '').trim();
  const summary = String(params.summary || '').trim();
  const notes = params.notes ? String(params.notes) : '';
  const data = params.data && typeof params.data === 'object' && !Array.isArray(params.data)
    ? params.data
    : {};
  const artifacts = Array.isArray(params.artifacts)
    ? params.artifacts.map(artifact => ({
      path: artifact?.path ? String(artifact.path) : '',
      name: artifact?.name ? String(artifact.name) : '',
      description: artifact?.description ? String(artifact.description) : '',
      source: artifact?.source ? String(artifact.source) : 'contract'
    })).filter(artifact => artifact.path || artifact.name)
    : [];

  if (!status) {
    throw new Error('complete_subtask requires status');
  }
  if (!summary) {
    throw new Error('complete_subtask requires summary');
  }

  return {
    status,
    summary,
    data,
    artifacts,
    notes
  };
}

function registerAgentTools(server) {
  server.registerTool('run_subagent', {
    name: 'run_subagent',
    description: 'Delegate a focused task to a sub-agent and return immediate run metadata.',
    userDescription: 'Run a task on a sub-agent',
    example: 'TOOL:run_subagent{"agent_name":"Search Agent","task":"Find 3 reliable sources about topic X"}',
    exampleOutput: '{"accepted":true,"run_id":"subtask-20260408-ab12cd","status":"queued","child_session_id":"subtask-20260408-ab12cd"}',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'number', description: 'Numeric sub-agent id (preferred when known)' },
        agent_name: { type: 'string', description: 'Sub-agent name (case-insensitive fallback)' },
        task: { type: 'string', description: 'Focused task for the sub-agent' },
        contract_type: {
          type: 'string',
          description: 'Expected completion status for success',
          default: 'task_complete'
        },
        expected_output: {
          type: 'string',
          description: 'Optional shape guidance for returned contract.data',
          default: ''
        },
        subagent_mode: {
          type: 'string',
          description: 'Subagent mode: "ui" (open child chat tab animation) or "no_ui" (backend only). If omitted: chat-llm defaults to ui, backend defaults to no_ui.'
        }
      },
      required: ['task']
    }
  }, async (params) => {
    const agent = await resolveSubagent(server, params);
    const execCtx = server.getCurrentExecutionContext ? server.getCurrentExecutionContext() : null;
    const defaultMode = execCtx?.source === 'chat-llm' ? 'ui' : 'no_ui';
    const subagentMode = normalizeSubagentMode(params.subagent_mode, defaultMode);
    return server._agentManager.invokeSubAgent(
      server.getCurrentSessionId() || null,
      agent.id,
      params.task,
      {
        contractType: params.contract_type || 'task_complete',
        expectedOutput: params.expected_output || '',
        subagentMode
      }
    );
  });

  server.registerTool('complete_subtask', {
    name: 'complete_subtask',
    description: 'Signal structured completion of a delegated sub-agent task. Child agents should call this exactly once when finished.',
    userDescription: 'Marks delegated sub-task completion with structured payload',
    example: 'TOOL:complete_subtask{"status":"task_complete","summary":"Done","data":{"key":"value"}}',
    exampleOutput: '{"status":"task_complete","summary":"Done","data":{"key":"value"},"artifacts":[],"notes":""}',
    internal: true,
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Completion status, e.g. task_complete or task_failed' },
        summary: { type: 'string', description: 'Short human-readable summary' },
        data: { type: 'object', description: 'Structured result payload' },
        artifacts: { type: 'array', description: 'Optional produced artifacts', default: [] },
        notes: { type: 'string', description: 'Optional notes', default: '' }
      },
      required: ['status', 'summary']
    }
  }, async (params) => normalizeCompletionPayload(params));
}

module.exports = { registerAgentTools };
