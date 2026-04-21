const DEFAULT_SUBAGENT_SYSTEM_PROMPT = 'You are a delegated sub-agent. Complete only the assigned task, stay within scope, and return structured results when asked.';

const {
  buildSubagentIdentifiers,
  normalizeCompletionPayload: normalizeCompletionEnvelope
} = require('../subagent-contract');

function formatSubagent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    status: agent.status || 'idle',
    icon: agent.icon || '',
    description: agent.description || ''
  };
}

function formatSubagentRun(run) {
  const identifiers = buildSubagentIdentifiers(run);
  return {
    run_id: identifiers.run_id,
    status: run.status || '',
    subagent_id: identifiers.subagent_id,
    agent_name: run.agent_name || run.agentName || '',
    parent_session_id: identifiers.parent_session_id,
    child_session_id: identifiers.child_session_id,
    summary: run.summary || run.result_summary || '',
    error: run.error || '',
    created_at: run.created_at || null,
    completed_at: run.completed_at || null,
    identifiers
  };
}

function normalizeSubagentAction(rawAction) {
  const value = String(rawAction || 'list').trim().toLowerCase();
  if (value === 'list' || value === 'ls' || value === 'show') return 'list';
  if (value === 'run' || value === 'start' || value === 'invoke') return 'run';
  if (value === 'run_batch' || value === 'batch' || value === 'invoke_multiple') return 'run_batch';
  if (value === 'status' || value === 'get' || value === 'inspect') return 'status';
  if (value === 'new' || value === 'create' || value === 'add') return 'new';
  if (value === 'stop' || value === 'deactivate' || value === 'disable') return 'stop';
  throw new Error(`Unsupported subagent action "${value}"`);
}

function normalizeSubagentParams(params = {}) {
  return {
    action: normalizeSubagentAction(params.action),
    id: params.id ?? params.agent_id ?? null,
    name: params.name ?? params.agent_name ?? '',
    task: params.task ? String(params.task) : '',
    contract_type: params.contract_type ? String(params.contract_type) : 'task_complete',
    expected_output: params.expected_output ? String(params.expected_output) : '',
    subagent_mode: params.subagent_mode ? String(params.subagent_mode) : '',
    tasks: Array.isArray(params.tasks) ? params.tasks : [],
    wait: params.wait === true,
    timeout_ms: Number.isFinite(Number(params.timeout_ms)) ? Number(params.timeout_ms) : null,
    description: params.description ? String(params.description) : '',
    system_prompt: params.system_prompt ? String(params.system_prompt) : '',
    icon: params.icon ? String(params.icon) : '🤖',
    run_id: params.run_id ? String(params.run_id) : ''
    ,
    permissions_contract: params.permissions_contract && typeof params.permissions_contract === 'object'
      ? params.permissions_contract
      : null
  };
}

async function runBatchSubagents(server, params) {
  if (!Array.isArray(params.tasks) || params.tasks.length === 0) {
    throw new Error('subagent action="run_batch" requires non-empty tasks array');
  }
  if (!server._agentManager || typeof server._agentManager.invokeMultipleSubAgents !== 'function') {
    throw new Error('Batch subagent invocation is unavailable');
  }

  return server._agentManager.invokeMultipleSubAgents(
    server.getCurrentSessionId() || null,
    params.tasks,
    {
      wait: params.wait,
      timeout_ms: params.timeout_ms
    }
  );
}

async function resolveSubagent(server, params) {
  if (!server._agentManager) {
    throw new Error('AgentManager not initialized');
  }

  if (params.id !== undefined && params.id !== null && params.id !== '') {
    const agent = await server._agentManager.getAgent(params.id);
    if (!agent || agent.type !== 'sub') {
      throw new Error(`Sub-agent ${params.id} not found`);
    }
    return agent;
  }

  if (params.name) {
    const targetName = String(params.name).trim().toLowerCase();
    const agents = await server._agentManager.getAgents('sub');
    const match = agents.find(agent => agent.name.toLowerCase() === targetName);
    if (!match) {
      throw new Error(`Sub-agent "${params.name}" not found`);
    }
    return match;
  }

  const agents = await server._agentManager.getAgents('sub');
  if (agents.length === 1) {
    return agents[0];
  }

  throw new Error('Provide subagent id or name, or call subagent with action="list" first');
}

function normalizeSubagentMode(rawMode, fallback = 'no_ui') {
  const value = String(rawMode || '').trim().toLowerCase();
  if (value === 'ui') return 'ui';
  if (value === 'noui' || value === 'no_ui' || value === 'backend') return 'no_ui';
  return fallback;
}

function normalizeCompletionPayload(params) {
  return normalizeCompletionEnvelope({
    ...params,
    artifacts: Array.isArray(params.artifacts)
      ? params.artifacts.map(artifact => ({
        path: artifact?.path ? String(artifact.path) : '',
        name: artifact?.name ? String(artifact.name) : '',
        description: artifact?.description ? String(artifact.description) : '',
        source: artifact?.source ? String(artifact.source) : 'contract'
      })).filter(artifact => artifact.path || artifact.name)
      : []
  }, {
    preferredStatus: 'delivered'
  });
}

async function listSubagents(server) {
  const agents = await server._agentManager.getAgents('sub');
  const parentSessionId = server.getCurrentSessionId ? server.getCurrentSessionId() : null;
  const runs = typeof server._agentManager.listSubagentRuns === 'function'
    ? await server._agentManager.listSubagentRuns({ limit: 10, parentSessionId })
    : [];

  return {
    success: true,
    action: 'list',
    count: agents.length,
    agents: agents.map(formatSubagent),
    recent_runs: runs.map(formatSubagentRun),
    note: agents.length
      ? 'Prefer id when running a subagent.'
      : 'No sub-agents are configured yet. Use action="new" to create one.'
  };
}

async function createSubagent(server, params) {
  const name = String(params.name || '').trim();
  if (!name) {
    throw new Error('subagent action="new" requires name');
  }

  const created = await server._agentManager.createAgent({
    name,
    type: 'sub',
    icon: params.icon || '🤖',
    description: params.description || 'Sub-agent created via MCP tool',
    system_prompt: params.system_prompt || DEFAULT_SUBAGENT_SYSTEM_PROMPT
  });

  return {
    success: true,
    action: 'new',
    agent: formatSubagent(created)
  };
}

async function runSubagent(server, params) {
  if (!String(params.task || '').trim()) {
    throw new Error('subagent action="run" requires task');
  }

  const agent = await resolveSubagent(server, params);
  const defaultMode = 'no_ui';
  const subagentMode = normalizeSubagentMode(params.subagent_mode, defaultMode);
  const result = await server._agentManager.invokeSubAgent(
    server.getCurrentSessionId() || null,
    agent.id,
    params.task,
    {
      contractType: params.contract_type || 'task_complete',
      expectedOutput: params.expected_output || '',
      subagentMode,
      permissionsContract: params.permissions_contract || null
    }
  );
  const queuedRun = formatSubagentRun({
    ...result,
    subagent_id: result?.subagent_id ?? result?.agentId ?? agent.id,
    agent_name: result?.agent_name || result?.agentName || agent.name,
    parent_session_id: result?.parent_session_id ?? result?.parentSessionId ?? (server.getCurrentSessionId ? server.getCurrentSessionId() : null)
  });

  if (params.wait) {
    if (typeof server._agentManager.waitForSubagentRun !== 'function') {
      throw new Error('Awaited subagent runs are unavailable (AgentManager.waitForSubagentRun missing)');
    }

    const completed = await server._agentManager.waitForSubagentRun(
      result.run_id || result.runId,
      params.timeout_ms || 30000
    );

    return {
      ...result,
      action: 'run',
      agent: formatSubagent(agent),
      waited: true,
      done: true,
      status: completed?.status || result.status,
      identifiers: queuedRun.identifiers,
      run_id: queuedRun.run_id,
      child_session_id: queuedRun.child_session_id,
      parent_session_id: queuedRun.parent_session_id,
      subagent_id: queuedRun.subagent_id,
      run: formatSubagentRun(completed || {}),
      result: completed?.result || null,
      contract: completed?.result?.contract || null
    };
  }

  return {
    ...result,
    action: 'run',
    agent: formatSubagent(agent),
    waited: false,
    identifiers: queuedRun.identifiers,
    run_id: queuedRun.run_id,
    child_session_id: queuedRun.child_session_id,
    parent_session_id: queuedRun.parent_session_id,
    subagent_id: queuedRun.subagent_id
  };
}

async function getSubagentStatus(server, params) {
  const runId = String(params.run_id || '').trim();
  if (!runId) {
    throw new Error('subagent action="status" requires run_id');
  }
  if (!server._agentManager || typeof server._agentManager.getSubagentRun !== 'function') {
    throw new Error('Subagent run status is unavailable (AgentManager.getSubagentRun missing)');
  }

  const run = await server._agentManager.getSubagentRun(runId);
  if (!run) {
    return {
      success: false,
      action: 'status',
      run_id: runId,
      status: 'not_found',
      error: `Subagent run "${runId}" not found`
    };
  }

  const normalized = formatSubagentRun(run);
  const contract = run.result?.contract || null;
  const runStatus = String(run.status || '').trim();
  const contractStatus = String(contract?.status || '').trim();
  const done = Boolean(run.result) || (runStatus && !new Set(['queued', 'running']).has(runStatus));

  return {
    success: true,
    action: 'status',
    run_id: normalized.run_id,
    status: runStatus || contractStatus || 'unknown',
    done,
    run: normalized,
    result: run.result || null,
    contract
  };
}

async function stopSubagent(server, params) {
  if (params.run_id) {
    return {
      success: false,
      action: 'stop',
      run_id: params.run_id,
      error: 'Scoped subagent run cancellation is not implemented yet'
    };
  }

  const agent = await resolveSubagent(server, params);
  await server._agentManager.deactivateAgent(agent.id);

  return {
    success: true,
    action: 'stop',
    agent: formatSubagent({ ...agent, status: 'idle' }),
    note: 'Agent status set to idle. This does not guarantee cancellation of an in-flight delegated run.'
  };
}

async function handleSubagentOperation(server, rawParams = {}) {
  if (!server._agentManager) {
    throw new Error('AgentManager not initialized');
  }

  const params = normalizeSubagentParams(rawParams);

  switch (params.action) {
    case 'list':
      return listSubagents(server);
    case 'status':
      return getSubagentStatus(server, params);
    case 'new':
      return createSubagent(server, params);
    case 'run':
      return runSubagent(server, params);
    case 'run_batch':
      return runBatchSubagents(server, params);
    case 'stop':
      return stopSubagent(server, params);
    default:
      throw new Error(`Unsupported subagent action "${params.action}"`);
  }
}

function registerAgentTools(server) {
  server.registerTool('subagent', {
    name: 'subagent',
    description: 'Manage sub-agents through a single tool. Use action="list" to inspect sub-agents, action="run" to delegate one task, action="run_batch" to delegate multiple tasks with provider-aware queuing, action="status" to poll a run, action="new" to create, or action="stop" to deactivate.',
    userDescription: 'List, create, run, batch run, check status, or stop sub-agents',
    example: 'TOOL:subagent{"action":"run_batch","tasks":[{"id":5,"task":"Find 3 reliable sources about topic X"}]}',
    exampleOutput: '{"accepted":true,"run_id":"subtask-20260408-ab12cd","status":"queued","child_session_id":"subtask-20260408-ab12cd"}',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Sub-agent action: list, run, run_batch, status, new, or stop',
          default: 'list'
        },
        id: { type: 'number', description: 'Sub-agent id. Prefer id over name; use action="list" first if needed.' },
        name: { type: 'string', description: 'Sub-agent name for run/new/stop actions' },
        task: { type: 'string', description: 'Focused task for action="run"' },
        tasks: {
          type: 'array',
          description: 'Batch entries for action="run_batch". Each entry supports id/name, task, provider, contract_type, expected_output, subagent_mode, and permissions_contract.'
        },
        contract_type: {
          type: 'string',
          description: 'Expected completion status for action="run"',
          default: 'task_complete'
        },
        expected_output: {
          type: 'string',
          description: 'Optional shape guidance for action="run" result data',
          default: ''
        },
        subagent_mode: {
          type: 'string',
          description: 'Subagent mode: "ui" (open child chat tab animation) or "no_ui" (backend only). If omitted, default is "no_ui".'
        },
        wait: {
          type: 'boolean',
          description: 'When true, wait for the delegated run to finish and return its final contract in this tool result.',
          default: false
        },
        timeout_ms: {
          type: 'number',
          description: 'Optional wait timeout in milliseconds when wait=true.',
          default: 30000
        },
        description: { type: 'string', description: 'Description for action="new"' },
        system_prompt: { type: 'string', description: 'System prompt for action="new"' },
        icon: { type: 'string', description: 'Optional icon for action="new"', default: '🤖' },
        run_id: { type: 'string', description: 'Existing run id for action="status" (and future stop/status flows)' }
        ,
        permissions_contract: {
          type: 'object',
          description: 'Optional delegation permission contract: { safe_tools: string[], unsafe_tools: string[] }. Safe tools may be run-scoped granted; unsafe tools still require explicit user approval.'
        }
      },
      required: []
    }
  }, async (params) => handleSubagentOperation(server, params));

  server.registerTool('run_subagent', {
    name: 'run_subagent',
    description: 'Compatibility alias for subagent action="run".',
    userDescription: 'Compatibility alias for subagent action="run"',
    example: 'TOOL:run_subagent{"agent_id":5,"task":"Find 3 reliable sources about topic X"}',
    exampleOutput: '{"accepted":true,"run_id":"subtask-20260408-ab12cd","status":"queued","child_session_id":"subtask-20260408-ab12cd"}',
    internal: true,
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
          description: 'Subagent mode: "ui" or "no_ui"'
        },
        wait: {
          type: 'boolean',
          description: 'When true, wait for the delegated run to finish and return its final contract.',
          default: false
        },
        timeout_ms: {
          type: 'number',
          description: 'Optional wait timeout in milliseconds when wait=true.',
          default: 30000
        },
        permissions_contract: {
          type: 'object',
          description: 'Optional delegation permission contract for this run.'
        }
      },
      required: ['task']
    }
  }, async (params) => handleSubagentOperation(server, {
    action: 'run',
    id: params.agent_id,
    name: params.agent_name,
    task: params.task,
    contract_type: params.contract_type,
    expected_output: params.expected_output,
    subagent_mode: params.subagent_mode,
    wait: params.wait,
    timeout_ms: params.timeout_ms,
    permissions_contract: params.permissions_contract
  }));

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
        status: { type: 'string', description: 'Short outcome label, e.g. task_complete, partial, empty, blocked, or task_failed', default: 'delivered' },
        summary: { type: 'string', description: 'Short human-readable summary' },
        data: { type: 'object', description: 'Structured result payload' },
        artifacts: { type: 'array', description: 'Optional produced artifacts', default: [] },
        notes: { type: 'string', description: 'Optional notes', default: '' }
      },
      required: ['summary']
    }
  }, async (params) => normalizeCompletionPayload(params));
}

module.exports = { registerAgentTools };
