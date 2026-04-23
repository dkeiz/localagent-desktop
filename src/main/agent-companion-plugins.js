async function hasOtherActiveAgentForPlugin(manager, currentAgent, pluginId) {
    const pluginManager = manager.pluginManager;
    if (!pluginManager || !pluginId) return false;

    const agents = await manager.getAgents();
    for (const agent of agents) {
        if (Number(agent.id) === Number(currentAgent.id)) continue;
        if (agent.status !== 'active') continue;

        const slug = manager._getSafeFolderName(agent.name);
        const resolved = typeof pluginManager.resolvePrimaryAgentChatUIPlugin === 'function'
            ? pluginManager.resolvePrimaryAgentChatUIPlugin({ ...agent, slug }, { allowFallback: true })
            : null;
        if (resolved && resolved === pluginId) {
            return true;
        }
    }

    return false;
}

async function enableCompanionPlugin(manager, agent) {
    const pluginManager = manager.pluginManager;
    if (!pluginManager || typeof pluginManager.resolvePrimaryAgentChatUIPlugin !== 'function') return;

    const slug = manager._getSafeFolderName(agent.name);
    const pluginId = pluginManager.resolvePrimaryAgentChatUIPlugin({ ...agent, slug }, { allowFallback: true });
    if (!pluginId) return;

    try {
        await pluginManager.enablePlugin(pluginId, { persistStatus: false });
        console.log(`[AgentManager] Auto-enabled companion plugin "${pluginId}" for agent "${agent.name}"`);
    } catch (error) {
        console.warn(`[AgentManager] Failed to auto-enable companion plugin "${pluginId}":`, error.message);
    }
}

async function disableCompanionPlugin(manager, agent) {
    const pluginManager = manager.pluginManager;
    if (!pluginManager || typeof pluginManager.resolvePrimaryAgentChatUIPlugin !== 'function') return;

    const slug = manager._getSafeFolderName(agent.name);
    const pluginId = pluginManager.resolvePrimaryAgentChatUIPlugin({ ...agent, slug }, { allowFallback: true });
    if (!pluginId) return;

    if (await hasOtherActiveAgentForPlugin(manager, agent, pluginId)) return;
    try {
        await pluginManager.disablePlugin(pluginId, { persistStatus: false });
        console.log(`[AgentManager] Auto-disabled companion plugin "${pluginId}" for agent "${agent.name}"`);
    } catch (error) {
        console.warn(`[AgentManager] Failed to auto-disable companion plugin "${pluginId}":`, error.message);
    }
}

module.exports = {
    enableCompanionPlugin,
    disableCompanionPlugin
};
