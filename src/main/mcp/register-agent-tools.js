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

function registerAgentTools(server) {
  server.registerTool('list_subagents', {
    name: 'list_subagents',
    description: 'List available sub-agents that can be delegated focused tasks. Use this before delegate_to_subagent when you are not sure which sub-agent to call.',
    userDescription: 'Lists available sub-agents for delegation',
    example: 'TOOL:list_subagents{}',
    exampleOutput: '[{"id":5,"name":"Search Agent","description":"Sub-agent: performs focused web searches and returns structured results","status":"idle"}]',
    inputSchema: { type: 'object' }
  }, async () => {
    if (!server._agentManager) {
      return [];
    }

    const agents = await server._agentManager.getAgents('sub');
    return agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      icon: agent.icon,
      description: agent.description,
      status: agent.status
    }));
  });

  server.registerTool('delegate_to_subagent', {
    name: 'delegate_to_subagent',
    description: 'Delegate a focused task to a sub-agent. Returns immediately with an accepted/running acknowledgment, run id, and file locations for the delegated run. The child later completes through a structured completion contract.',
    userDescription: 'Starts a delegated sub-agent run and returns an immediate acknowledgment',
    example: 'TOOL:delegate_to_subagent{"agent_name":"Search Agent","task":"Research recent local Electron security guidance","contract_type":"research_complete","expected_output":"Include findings, risks, and sources"}',
    exampleOutput: '{"accepted":true,"run_id":"subtask-20260408-ab12cd","status":"queued","child_session_id":"subtask-20260408-ab12cd","run_dir":"...\\\\agentin\\\\subtasks\\\\runs\\\\subtask-20260408-ab12cd","result_path":"...\\\\result.json"}',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'number', description: 'Numeric sub-agent id (preferred when known)' },
        agent_name: { type: 'string', description: 'Sub-agent name (case-insensitive fallback)' },
        task: { type: 'string', description: 'Focused task for the child agent to execute' },
        contract_type: {
          type: 'string',
          description: 'Required success status the child must return, e.g. "task_complete" or "research_complete"',
          default: 'task_complete'
        },
        expected_output: {
          type: 'string',
          description: 'Optional instructions describing the structure expected inside contract.data',
          default: ''
        }
      },
      required: ['task']
    }
  }, async (params) => {
    const agent = await resolveSubagent(server, params);
    return server._agentManager.invokeSubAgent(
      server.getCurrentSessionId() || null,
      agent.id,
      params.task,
      {
        contractType: params.contract_type || 'task_complete',
        expectedOutput: params.expected_output || ''
      }
    );
  });

  server.registerTool('get_subagent_run', {
    name: 'get_subagent_run',
    description: 'Get the current state of a delegated sub-agent run by run id. Use this to inspect queued, running, completed, or failed delegated runs and to discover the run folder and result file.',
    userDescription: 'Gets the current state of a delegated sub-agent run',
    example: 'TOOL:get_subagent_run{"run_id":"subtask-20260408-ab12cd"}',
    exampleOutput: '{"run_id":"subtask-20260408-ab12cd","status":"completed","summary":"Found three sources","run_dir":"...","result_path":"...","result":{"contract":{"status":"research_complete","summary":"Found three sources"}}}',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Delegated run id returned by delegate_to_subagent' }
      },
      required: ['run_id']
    }
  }, async (params) => {
    if (!server._agentManager) {
      return null;
    }
    return server._agentManager.getSubagentRun(params.run_id);
  });

  server.registerTool('list_subagent_runs', {
    name: 'list_subagent_runs',
    description: 'List recent delegated sub-agent runs and their completion state. Useful for tracing queued/running/completed tasks and discovering their run folders and result files.',
    userDescription: 'Lists recent sub-agent runs and their structured results',
    example: 'TOOL:list_subagent_runs{"limit":5}',
    exampleOutput: '[{"run_id":"subtask-20260408-ab12cd","parent_session_id":1,"child_session_id":"subtask-20260408-ab12cd","subagent_id":5,"status":"running","run_dir":"..."}]',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of runs to return', default: 10 },
        parent_session_id: { type: 'string', description: 'Optional parent session filter' },
        subagent_id: { type: 'number', description: 'Optional child agent filter' },
        status: { type: 'string', description: 'Optional run status filter' }
      }
    }
  }, async (params) => {
    if (!server._agentManager) {
      return [];
    }

    return server._agentManager.listSubagentRuns({
      limit: params.limit || 10,
      parentSessionId: params.parent_session_id,
      subagentId: params.subagent_id,
      status: params.status
    });
  });

  server.registerTool('complete_subtask', {
    name: 'complete_subtask',
    description: 'Signal structured completion of a delegated sub-agent task. Child agents should call this exactly once when they have finished the assigned task.',
    userDescription: 'Marks a delegated sub-agent task as complete with a structured result',
    example: 'TOOL:complete_subtask{"status":"research_complete","summary":"Found three relevant sources","data":{"sources":[...]}}',
    exampleOutput: '{"status":"research_complete","summary":"Found three relevant sources","data":{"sources":[...]},"artifacts":[],"notes":""}',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Completion status, e.g. task_complete, research_complete, or task_failed' },
        summary: { type: 'string', description: 'Short human-readable summary of the outcome' },
        data: { type: 'object', description: 'Structured result payload' },
        artifacts: {
          type: 'array',
          description: 'Optional files or outputs created during the task',
          default: []
        },
        notes: { type: 'string', description: 'Optional notes for the parent agent', default: '' }
      },
      required: ['status', 'summary']
    }
  }, async (params) => {
    return normalizeCompletionPayload(params);
  });
}

module.exports = { registerAgentTools };
