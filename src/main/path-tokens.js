const path = require('path');

function inferAgentinRoot(agentManager = null, sessionWorkspace = null) {
    if (agentManager?.basePath) {
        return path.dirname(agentManager.basePath);
    }
    if (sessionWorkspace?.basePath) {
        return path.dirname(sessionWorkspace.basePath);
    }
    return path.resolve(__dirname, '../../agentin');
}

async function resolveAgentHome(agentManager, context = {}) {
    if (context.agentFolderPath) {
        return context.agentFolderPath;
    }
    const agentId = context.agentId ?? context.agent_id ?? null;
    if (!agentId || !agentManager) {
        return null;
    }
    if (typeof agentManager.resolveAgentFolder === 'function') {
        return agentManager.resolveAgentFolder(agentId);
    }
    const agent = typeof agentManager.getAgent === 'function'
        ? await agentManager.getAgent(agentId)
        : null;
    return agent && typeof agentManager._getAgentFolderPath === 'function'
        ? agentManager._getAgentFolderPath(agent)
        : null;
}

async function buildPathTokenMap({ agentManager = null, sessionWorkspace = null, context = {}, sessionId = null, agentId = null } = {}) {
    const agentinRoot = inferAgentinRoot(agentManager, sessionWorkspace);
    const sid = sessionId ?? context.sessionId ?? context.session_id ?? 'default';
    const effectiveContext = {
        ...context,
        agentId: agentId ?? context.agentId ?? context.agent_id ?? null
    };
    const agentHome = await resolveAgentHome(agentManager, effectiveContext);
    const workspace = sessionWorkspace?.getWorkspacePath
        ? sessionWorkspace.getWorkspacePath(sid)
        : path.join(agentinRoot, 'workspaces', String(sid));

    const tokens = {
        '{agentin}': agentinRoot,
        '{workspace}': workspace,
        '{knowledge}': path.join(agentinRoot, 'knowledge'),
        '{memory}': path.join(agentinRoot, 'memory')
    };

    if (agentHome) {
        tokens['{agent_home}'] = agentHome;
        tokens['{agent_tasks}'] = path.join(agentHome, 'tasks');
        tokens['{agent_outputs}'] = path.join(agentHome, 'outputs');
    }

    return tokens;
}

async function resolvePathTokens(rawPath, options = {}) {
    const input = String(rawPath || '');
    const tokens = await buildPathTokenMap(options);
    const resolved = input.replace(/\{[a-z_]+\}/gi, token => tokens[token] || token);
    return path.normalize(resolved);
}

module.exports = {
    buildPathTokenMap,
    resolvePathTokens
};
