const PROFILE_GROUP_FIELDS = {
    unsafe: 'unsafe_enabled',
    web: 'web_enabled',
    terminal: 'terminal_enabled',
    ports: 'ports_enabled',
    visual: 'visual_enabled'
};

class ToolPermissionService {
    constructor({ db, capabilityManager, mcpServer, agentManager, store }) {
        this.db = db;
        this.capabilityManager = capabilityManager;
        this.mcpServer = mcpServer;
        this.agentManager = agentManager;
        this.store = store;
        this.runScopedGrants = new Map();
    }

    async initialize() {
        await this.store.initialize();
    }

    async resolveContext(context = {}) {
        const resolvedAgentId = await this._resolveAgentId(context);
        if (!resolvedAgentId) {
            return this._buildGlobalContext();
        }

        await this.ensureAgentProfile(resolvedAgentId);
        const profileRow = this.store.getAgentProfile(resolvedAgentId);
        const agentToolStates = this.store.getAgentToolStates(resolvedAgentId);
        const global = await this._buildGlobalContext();
        const groups = { ...global.groups };

        groups.files = String(profileRow?.files_mode || global.groups.files || 'read');
        for (const [groupId, field] of Object.entries(PROFILE_GROUP_FIELDS)) {
            if (profileRow && Object.prototype.hasOwnProperty.call(profileRow, field)) {
                groups[groupId] = profileRow[field] === 1;
            }
        }

        const output = {
            scope: 'agent',
            agentId: resolvedAgentId,
            mainEnabled: profileRow ? profileRow.main_enabled === 1 : global.mainEnabled,
            groups,
            toolStates: {},
            activeToolNames: [],
            source: {
                agentProfile: true
            }
        };

        const toolNames = this._getAllKnownTools();
        for (const toolName of toolNames) {
            const active = await this._resolveToolActiveForAgent({
                toolName,
                agentToolStates,
                groups,
                mainEnabled: output.mainEnabled,
                global
            });
            output.toolStates[toolName] = active;
            if (active) output.activeToolNames.push(toolName);
        }

        return output;
    }

    async isToolAllowed({ toolName, context = {} }) {
        const normalizedTool = String(toolName);
        const resolved = await this.resolveContext(context);
        const resolvedAllowed = resolved.toolStates[normalizedTool] === true;
        if (resolvedAllowed) return true;

        const runGrant = this.getRunScopedGrant(context?.subagentRunId || null);
        if (runGrant && runGrant.safeTools.has(normalizedTool)) {
            return true;
        }
        return false;
    }

    async getContextActiveToolNames(context = {}) {
        const resolved = await this.resolveContext(context);
        const output = new Set(resolved.activeToolNames.slice());
        const runGrant = this.getRunScopedGrant(context?.subagentRunId || null);
        if (runGrant) {
            runGrant.safeTools.forEach(toolName => output.add(toolName));
        }
        return Array.from(output);
    }

    setRunScopedGrant(runId, agentId, contract = {}) {
        const key = String(runId || '').trim();
        if (!key) return;

        const safeTools = new Set(
            this._coerceToolList(contract.safeTools || contract.safe_tools)
                .filter(toolName => !this._isUnsafeTool(toolName))
        );
        const unsafeTools = new Set(this._coerceToolList(contract.unsafeTools || contract.unsafe_tools));
        this.runScopedGrants.set(key, {
            agentId: agentId ? Number(agentId) : null,
            safeTools,
            unsafeTools
        });
    }

    clearRunScopedGrant(runId) {
        const key = String(runId || '').trim();
        if (!key) return;
        this.runScopedGrants.delete(key);
    }

    getRunScopedGrant(runId) {
        const key = String(runId || '').trim();
        if (!key) return null;
        return this.runScopedGrants.get(key) || null;
    }

    async ensureAgentProfile(agentId) {
        const current = this.store.getAgentProfile(agentId);
        if (current) return current;

        const global = await this._buildGlobalContext();
        const profile = {
            main_enabled: global.mainEnabled,
            files_mode: global.groups.files || 'read',
            unsafe_enabled: global.groups.unsafe === true,
            web_enabled: global.groups.web === true,
            terminal_enabled: global.groups.terminal === true,
            ports_enabled: global.groups.ports === true,
            visual_enabled: global.groups.visual === true
        };
        this.store.setAgentProfile(agentId, profile);

        const initialToolStates = {};
        for (const toolName of this._getAllKnownTools()) {
            const isGlobalActive = global.toolStates[toolName] === true;
            const isUnsafe = this._isUnsafeTool(toolName);
            const isScoped = await this._isToolScopedToAgent(toolName, agentId);

            if (isGlobalActive || isUnsafe || isScoped) {
                initialToolStates[toolName] = isScoped ? true : isGlobalActive;
            }
        }
        this.store.setManyAgentToolStates(agentId, initialToolStates);
        return this.store.getAgentProfile(agentId);
    }

    async getAgentProfile(agentId) {
        await this.ensureAgentProfile(agentId);
        const profile = this.store.getAgentProfile(agentId);
        const toolStates = this.store.getAgentToolStates(agentId);
        return { profile, toolStates };
    }

    async setAgentGroup(agentId, groupId, value) {
        await this.ensureAgentProfile(agentId);
        const row = this.store.getAgentProfile(agentId) || {};
        const next = {
            main_enabled: row.main_enabled === 1,
            files_mode: row.files_mode || 'read',
            unsafe_enabled: row.unsafe_enabled === 1,
            web_enabled: row.web_enabled === 1,
            terminal_enabled: row.terminal_enabled === 1,
            ports_enabled: row.ports_enabled === 1,
            visual_enabled: row.visual_enabled === 1
        };

        if (groupId === 'main') {
            next.main_enabled = Boolean(value);
        } else if (groupId === 'files') {
            const filesMode = ['off', 'read', 'full'].includes(String(value)) ? String(value) : 'read';
            next.files_mode = filesMode;
        } else if (PROFILE_GROUP_FIELDS[groupId]) {
            next[PROFILE_GROUP_FIELDS[groupId]] = Boolean(value);
        } else {
            throw new Error(`Unsupported groupId "${groupId}"`);
        }

        this.store.setAgentProfile(agentId, next);
        return this.getAgentProfile(agentId);
    }

    async setAgentTool(agentId, toolName, active) {
        await this.ensureAgentProfile(agentId);
        this.store.setAgentToolState(agentId, toolName, Boolean(active));
        return { success: true, agentId, toolName, active: Boolean(active) };
    }

    async resetAgentProfile(agentId) {
        this.store.deleteAgentProfile(agentId);
        await this.ensureAgentProfile(agentId);
        return this.getAgentProfile(agentId);
    }

    async deleteAgentProfile(agentId) {
        this.store.deleteAgentProfile(agentId);
        return { success: true, agentId: Number(agentId) };
    }

    async syncUnsafeFromGlobal() {
        const global = await this._buildGlobalContext();
        const unsafeEnabled = global.groups.unsafe === true;
        const unsafeTools = this._getUnsafeToolNames();
        const ids = this.store.listProfileAgentIds();

        for (const agentId of ids) {
            const row = this.store.getAgentProfile(agentId);
            if (!row) continue;
            this.store.setAgentProfile(agentId, {
                main_enabled: row.main_enabled === 1,
                files_mode: row.files_mode || 'read',
                unsafe_enabled: unsafeEnabled,
                web_enabled: row.web_enabled === 1,
                terminal_enabled: row.terminal_enabled === 1,
                ports_enabled: row.ports_enabled === 1,
                visual_enabled: row.visual_enabled === 1
            });

            unsafeTools.forEach(toolName => {
                this.store.setAgentToolState(agentId, toolName, global.toolStates[toolName] === true);
            });
        }
    }

    async _isToolScopedToAgent(toolName, agentId) {
        const def = this.mcpServer?.tools?.get(toolName)?.definition;
        const scopes = Array.isArray(def?.agentScopeSlugs) ? def.agentScopeSlugs : [];
        if (scopes.length === 0) return false;
        if (!agentId || !this.agentManager?.getAgent) return false;
        const agent = await this.agentManager.getAgent(agentId);
        if (!agent) return false;
        const slug = this.agentManager?._getSafeFolderName
            ? this.agentManager._getSafeFolderName(agent.name)
            : String(agent.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return scopes.includes(String(slug || '').trim().toLowerCase());
    }

    _coerceToolList(list) {
        if (!Array.isArray(list)) return [];
        return list
            .map(value => String(value || '').trim())
            .filter(Boolean);
    }

    _getUnsafeToolNames() {
        const groups = this.capabilityManager?.getGroupsConfig?.() || [];
        const unsafe = groups.find(group => group.id === 'unsafe');
        return Array.isArray(unsafe?.allTools || unsafe?.tools) ? [...new Set(unsafe.allTools || unsafe.tools)] : [];
    }

    _isUnsafeTool(toolName) {
        const unsafeSet = new Set(this._getUnsafeToolNames());
        if (unsafeSet.has(toolName)) return true;
        return this.capabilityManager?.isCustomToolSafe?.(toolName) === false
            && this.capabilityManager?.customToolSafety?.has(toolName);
    }

    _getSafeTools() {
        const list = this.capabilityManager?.config?.safeTools?.tools;
        return Array.isArray(list) ? list.slice() : [];
    }

    _getAllKnownTools() {
        const fromRegistry = this.mcpServer?.getTools?.() || [];
        const names = new Set(fromRegistry.map(tool => String(tool.name || '').trim()).filter(Boolean));
        this._getSafeTools().forEach(name => names.add(String(name)));

        const groups = this.capabilityManager?.getGroupsConfig?.() || [];
        groups.forEach(group => {
            (group.allTools || group.tools || []).forEach(name => names.add(String(name)));
        });
        return Array.from(names);
    }

    _isGroupAllowedForTool(groupId, toolName, filesMode) {
        if (!groupId) return true;
        if (groupId === 'files') {
            const groups = this.capabilityManager?.getGroupsConfig?.() || [];
            const filesGroup = groups.find(group => group.id === 'files');
            const modes = filesGroup?.modes || {};
            const modeTools = new Set(modes[String(filesMode || 'read')] || []);
            return modeTools.has(toolName);
        }
        return true;
    }

    async _resolveToolActiveForAgent({ toolName, agentToolStates, groups, mainEnabled, global }) {
        if (!mainEnabled) return false;

        const groupId = this.capabilityManager?.getGroupForTool?.(toolName) || null;
        if (groupId) {
            const groupValue = groups[groupId];
            if (groupId !== 'files' && groupValue !== true) return false;
            if (!this._isGroupAllowedForTool(groupId, toolName, groups.files)) return false;
        }

        if (Object.prototype.hasOwnProperty.call(agentToolStates, toolName)) {
            return agentToolStates[toolName] === true;
        }

        if (this._isUnsafeTool(toolName)) {
            return global.toolStates[toolName] === true;
        }

        return false;
    }

    async _buildGlobalContext() {
        const groups = {};
        const groupsConfig = this.capabilityManager?.getGroupsConfig?.() || [];
        groupsConfig.forEach(group => {
            groups[group.id] = group.id === 'files'
                ? (group.mode || 'read')
                : group.enabled === true;
        });

        const mainEnabled = this.capabilityManager?.isMainEnabled?.() !== false;
        const toolStates = {};
        const activeToolNames = [];
        const toolNames = this._getAllKnownTools();
        for (const toolName of toolNames) {
            const active = await this.mcpServer.getToolActiveState(toolName);
            toolStates[toolName] = mainEnabled && active;
            if (toolStates[toolName]) activeToolNames.push(toolName);
        }

        return {
            scope: 'global',
            agentId: null,
            mainEnabled,
            groups,
            toolStates,
            activeToolNames,
            source: {
                agentProfile: false
            }
        };
    }

    async _resolveAgentId(context = {}) {
        if (context.agentId !== null && context.agentId !== undefined) {
            return Number(context.agentId) || null;
        }
        const sessionId = context.sessionId;
        if (sessionId === null || sessionId === undefined || !this.db?.get) {
            return null;
        }
        const row = this.db.get('SELECT agent_id FROM chat_sessions WHERE id = ?', [sessionId]);
        return row?.agent_id ? Number(row.agent_id) : null;
    }
}

module.exports = ToolPermissionService;
