const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { getManifestCapabilityContract } = require('./plugin-capability-contracts');

const ACTIVE_PLUGIN_MANAGERS = new Set();
let EMERGENCY_HOOKS_INSTALLED = false;
let EMERGENCY_EXIT_IN_PROGRESS = false;

/**
 * PluginManager — Discovers, loads, and manages plugins.
 * 
 * Plugins live in agentin/plugins/<id>/plugin.json.
 * When enabled, their main.js is loaded and onEnable(context) is called.
 * Plugins register handlers via context.registerHandler() which delegates
 * to MCPServer.registerTool() — the existing mechanism.
 * 
 * When enabled, a knowledge item is auto-generated in agentin/knowledge/
 * describing the plugin's available handlers for LLM discovery.
 */
class PluginManager extends EventEmitter {
    constructor(container, options = {}) {
        super();
        this.container = container;
        this.db = container.get('db');
        this.mcpServer = container.get('mcpServer');
        this.capabilityManager = container.optional('capabilityManager');
        this.pluginsDir = options.pluginsDir || path.join(__dirname, '../../agentin/plugins');
        this.plugins = new Map(); // id -> { manifest, status, module, handlers[] }
        this._ensureDir();
        ACTIVE_PLUGIN_MANAGERS.add(this);
        this._installEmergencyProcessHooks();
    }

    _ensureDir() {
        if (!fs.existsSync(this.pluginsDir)) {
            fs.mkdirSync(this.pluginsDir, { recursive: true });
        }
    }

    // ==================== Discovery ====================

    async initialize() {
        await this.scanPlugins();
        const cleanup = this._cleanupOrphanedPluginTools();
        if (cleanup.removed > 0) {
            console.warn(`[PluginManager] Removed ${cleanup.removed} stale plugin tool registration(s): ${cleanup.toolNames.join(', ')}`);
        }
        // Auto-enable previously-enabled plugins
        for (const [id, plugin] of this.plugins) {
            const row = this.db.get('SELECT status FROM plugins WHERE id = ?', [id]);
            const shouldEnable = (row?.status || plugin.persistedStatus) === 'enabled';
            if (shouldEnable) {
                try {
                    await this.enablePlugin(id);
                } catch (e) {
                    console.error(`[PluginManager] Failed to auto-enable "${id}":`, e.message);
                    this._updateDbStatus(id, 'error', e.message);
                }
            }
        }
        const contract = this._validatePluginToolContracts();
        if (!contract.ok) {
            console.error('[PluginManager] Plugin contract validation failed:', contract.issues);
        }
        console.log(`[PluginManager] Initialized ${this.plugins.size} plugin(s)`);
    }

    async scanPlugins(options = {}) {
        if (!fs.existsSync(this.pluginsDir)) return;
        const preserveExisting = options.preserveExisting === true;

        const dirs = fs.readdirSync(this.pluginsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .sort((a, b) => a.name.localeCompare(b.name));

        for (const dir of dirs) {
            const manifestPath = path.join(this.pluginsDir, dir.name, 'plugin.json');
            if (!fs.existsSync(manifestPath)) continue;

            try {
                const raw = fs.readFileSync(manifestPath, 'utf-8');
                const manifest = JSON.parse(raw);

                if (!manifest.id || !manifest.name || !manifest.main) {
                    console.warn(`[PluginManager] Invalid manifest in ${dir.name}: missing id/name/main`);
                    continue;
                }
                const pluginDir = path.join(this.pluginsDir, dir.name);

                // Ensure DB row exists
                const existing = this.db.get('SELECT id, status FROM plugins WHERE id = ?', [manifest.id]);
                if (!existing) {
                    this.db.run(
                        'INSERT INTO plugins (id, name, version, status) VALUES (?, ?, ?, ?)',
                        [manifest.id, manifest.name, manifest.version || '0.0.0', 'disabled']
                    );
                }

                const current = this.plugins.get(manifest.id);
                if (preserveExisting && current) {
                    current.manifest = manifest;
                    current.dir = pluginDir;
                    current.persistedStatus = existing?.status || current.persistedStatus || 'disabled';
                    if (!current.managedProcesses) {
                        current.managedProcesses = new Set();
                    }
                    continue;
                }

                this.plugins.set(manifest.id, {
                    manifest,
                    dir: pluginDir,
                    status: 'disabled',
                    persistedStatus: existing?.status || 'disabled',
                    module: null,
                    context: null,
                    handlers: [],
                    chatUIs: [],
                    managedProcesses: new Set()
                });
            } catch (e) {
                console.error(`[PluginManager] Failed to read manifest in ${dir.name}:`, e.message);
            }
        }
    }

    async rescanPlugins() {
        const before = new Set(this.plugins.keys());
        await this.scanPlugins({ preserveExisting: true });
        const added = [...this.plugins.keys()].filter(id => !before.has(id));
        return { added, total: this.plugins.size };
    }

    // ==================== Lifecycle ====================

    async enablePlugin(pluginId, options = {}) {
        const persistStatus = options.persistStatus !== false;
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
        if (plugin.status === 'enabled' && plugin.module && plugin.context) {
            if (persistStatus && plugin.persistedStatus !== 'enabled') {
                plugin.persistedStatus = 'enabled';
                this._updateDbStatus(pluginId, 'enabled');
            }
            return;
        }

        try {
            const mainPath = path.join(plugin.dir, plugin.manifest.main);
            if (!fs.existsSync(mainPath)) {
                throw new Error(`Plugin entry point not found: ${mainPath}`);
            }

            // Clear plugin subtree from require cache for reliable hot-reload.
            this._clearPluginRequireCache(plugin.dir);

            const pluginModule = require(mainPath);
            plugin.module = pluginModule;
            plugin.handlers = [];
            plugin.chatUIs = [];

            // Build context for the plugin
            const context = this._buildPluginContext(pluginId, plugin);
            plugin.context = context;

            // Call onEnable
            if (typeof pluginModule.onEnable === 'function') {
                await pluginModule.onEnable(context);
            }
        } catch (error) {
            this._cleanupPluginHandlers(plugin);
            plugin.module = null;
            plugin.context = null;
            plugin.status = 'error';
            this._updateDbStatus(pluginId, 'error', error.message);
            throw error;
        }

        plugin.status = 'enabled';
        if (persistStatus) {
            plugin.persistedStatus = 'enabled';
            this._updateDbStatus(pluginId, 'enabled');
        }
        
        // Auto-generate knowledge item for this plugin
        await this._generatePluginKnowledge(pluginId, plugin);

        this.emit('plugin-enabled', { id: pluginId, handlers: plugin.handlers.map(h => h.name) });
        console.log(`[PluginManager] Enabled "${pluginId}" with ${plugin.handlers.length} handler(s)`);
    }

    async disablePlugin(pluginId, options = {}) {
        const persistStatus = options.persistStatus !== false;
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
        if (plugin.status !== 'enabled') return;

        // Call onDisable
        if (plugin.module && typeof plugin.module.onDisable === 'function') {
            try {
                await plugin.module.onDisable(plugin.context);
            } catch (e) {
                console.error(`[PluginManager] onDisable error for "${pluginId}":`, e.message);
            }
        }
        this._terminateManagedProcesses(plugin, `disable:${pluginId}`);

        this._cleanupPluginHandlers(plugin);
        plugin.status = 'disabled';
        plugin.module = null;
        plugin.context = null;
        if (persistStatus) {
            plugin.persistedStatus = 'disabled';
            this._updateDbStatus(pluginId, 'disabled');
        }

        this.emit('plugin-disabled', { id: pluginId });
        console.log(`[PluginManager] Disabled "${pluginId}"`);
    }

    // ==================== Plugin Context ====================

    _buildPluginContext(pluginId, plugin) {
        const self = this;
        const config = this._loadPluginConfig(pluginId);
        const manifestAgentScopes = this._resolveManifestAgentScopes(plugin.manifest);
        const connectorRuntime = this.container.optional('connectorRuntime');

        return {
            config,
            pluginId,
            pluginDir: plugin.dir,

            registerHandler(name, definition, handler) {
                const toolName = `plugin_${pluginId.replace(/-/g, '_')}_${name}`;
                const definitionScope = self._normalizeScopeList(definition?.agentScope);
                const effectiveScope = definitionScope || manifestAgentScopes;
                
                self.mcpServer.registerTool(toolName, {
                    name: toolName,
                    description: `[Plugin: ${plugin.manifest.name}] ${definition.description || name}`,
                    userDescription: definition.description || name,
                    inputSchema: definition.inputSchema || { type: 'object' },
                    isPlugin: true,
                    pluginId,
                    ...(effectiveScope ? { agentScope: effectiveScope } : {})
                }, async (params) => {
                    try {
                        return await handler(params);
                    } catch (e) {
                        console.error(`[Plugin:${pluginId}] Handler "${name}" error:`, e.message);
                        throw e;
                    }
                });

                if (self.capabilityManager) {
                    // Plugin enablement is already an explicit user action.
                    self.capabilityManager.registerCustomTool(toolName, true);
                }

                // Track handler for cleanup on disable
                plugin.handlers.push({ name, toolName, definition });
                console.log(`[PluginManager] Registered handler: ${toolName}`);
            },

            registerChatUI(contribution) {
                if (!contribution || typeof contribution !== 'object') {
                    throw new Error('registerChatUI requires a contribution object');
                }
                plugin.chatUIs.push({
                    title: contribution.title || plugin.manifest.name,
                    renderPanel: contribution.renderPanel || null,
                    html: contribution.html || '',
                    css: contribution.css || '',
                    actions: contribution.actions && typeof contribution.actions === 'object'
                        ? contribution.actions
                        : {},
                    onTabActivated: contribution.onTabActivated || null,
                    onTabDeactivated: contribution.onTabDeactivated || null
                });
                console.log(`[PluginManager] Registered chat UI for "${pluginId}"`);
            },

            log(message) {
                console.log(`[Plugin:${pluginId}] ${message}`);
            },

            getConfig(key) {
                const latest = self._loadPluginConfig(pluginId);
                if (typeof key === 'undefined') return latest;
                return latest[key];
            },

            async setConfig(key, value) {
                await self.setPluginConfig(pluginId, key, value);
                config[key] = value;
            },

            registerManagedProcess(proc, metadata = {}) {
                return self._registerManagedProcess(plugin, proc, metadata);
            },

            connectors: {
                async list() {
                    if (!connectorRuntime?.listConnectors) return [];
                    return connectorRuntime.listConnectors();
                },
                async start(name) {
                    if (!connectorRuntime?.startConnector) {
                        throw new Error('Connector runtime is unavailable');
                    }
                    return connectorRuntime.startConnector(String(name || ''));
                },
                async stop(name) {
                    if (!connectorRuntime?.stopConnector) {
                        throw new Error('Connector runtime is unavailable');
                    }
                    return connectorRuntime.stopConnector(String(name || ''));
                },
                async getConfig(name) {
                    if (!connectorRuntime?.getConfig) {
                        throw new Error('Connector runtime is unavailable');
                    }
                    return connectorRuntime.getConfig(String(name || ''));
                },
                async setConfig(name, key, value) {
                    if (!connectorRuntime?.setConfig) {
                        throw new Error('Connector runtime is unavailable');
                    }
                    return connectorRuntime.setConfig(
                        String(name || ''),
                        String(key || ''),
                        String(value == null ? '' : value)
                    );
                }
            }
        };
    }

    // ==================== Knowledge Generation ====================

    async _generatePluginKnowledge(pluginId, plugin) {
        const knowledgeManager = this.container.optional('knowledgeManager');
        if (!knowledgeManager) return; // Knowledge system not yet initialized

        const manifest = plugin.manifest;
        const handlers = plugin.handlers;

        // Build knowledge content describing this plugin's handlers
        let content = `# Plugin: ${manifest.name}\n`;
        content += `Version: ${manifest.version || '0.0.0'}\n`;
        content += `Description: ${manifest.description || 'No description'}\n\n`;
        content += `## Available Handlers\n\n`;

        for (const handler of handlers) {
            content += `### ${handler.toolName}\n`;
            content += `${handler.definition.description || handler.name}\n`;
            if (handler.definition.inputSchema?.properties) {
                content += `Parameters:\n`;
                for (const [key, prop] of Object.entries(handler.definition.inputSchema.properties)) {
                    const required = (handler.definition.inputSchema.required || []).includes(key);
                    content += `  - ${key} (${prop.type})${required ? ' [REQUIRED]' : ''}: ${prop.description || ''}\n`;
                }
            }
            content += `\n`;
        }

        if (manifest.configSchema) {
            content += `## Configuration\n\n`;
            for (const [key, schema] of Object.entries(manifest.configSchema)) {
                content += `- ${key}: ${schema.description || schema.type}${schema.required ? ' [REQUIRED]' : ''}\n`;
            }
        }

        try {
            await knowledgeManager.createItem({
                title: `Plugin: ${manifest.name}`,
                content,
                category: 'plugins',
                tags: ['plugin', pluginId, 'auto-generated'],
                source: 'plugin-manager',
                confidence: 1.0,
                slug: `plugin-${pluginId}`
            });
        } catch (e) {
            // May already exist — update instead
            try {
                await knowledgeManager.updateItemContent(`plugin-${pluginId}`, content);
            } catch (e2) {
                console.error(`[PluginManager] Failed to generate knowledge for "${pluginId}":`, e2.message);
            }
        }
    }

    // ==================== Config ====================

    _loadPluginConfig(pluginId) {
        const config = {};
        const prefix = `plugin.${pluginId}.`;
        const settings = this.db.all('SELECT key, value FROM settings WHERE key LIKE ?', [`${prefix}%`]);
        for (const row of settings) {
            config[row.key.slice(prefix.length)] = row.value;
        }
        return config;
    }

    async setPluginConfig(pluginId, key, value, options = {}) {
        const settingKey = `plugin.${pluginId}.${key}`;
        this.db.run(
            'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [settingKey, String(value)]
        );

        const plugin = this.plugins.get(pluginId);
        if (plugin?.context?.config) {
            plugin.context.config[key] = String(value);
        }

        if (
            options?.notifyHook !== false
            && plugin?.status === 'enabled'
            && plugin?.module
            && typeof plugin.module.onConfigChanged === 'function'
        ) {
            await plugin.module.onConfigChanged(String(key), String(value), plugin.context);
        }
    }

    async getPluginConfig(pluginId) {
        return this._loadPluginConfig(pluginId);
    }

    // ==================== State ====================

    _updateDbStatus(pluginId, status, error = null) {
        this.db.run(
            'UPDATE plugins SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, error, pluginId]
        );
    }

    _cleanupOrphanedPluginTools() {
        let removed = 0;
        const toolNames = [];
        for (const [toolName, tool] of this.mcpServer.tools) {
            const def = tool?.definition;
            if (!def?.isPlugin) continue;
            this.mcpServer.tools.delete(toolName);
            if (this.capabilityManager) {
                this.capabilityManager.unregisterCustomTool(toolName);
            }
            removed++;
            toolNames.push(toolName);
        }
        return { removed, toolNames };
    }

    _validatePluginToolContracts() {
        const issues = [];

        for (const [toolName, tool] of this.mcpServer.tools) {
            const def = tool?.definition;
            if (!def?.isPlugin) continue;
            const pluginId = def.pluginId;
            const plugin = this.plugins.get(pluginId);
            if (!plugin) {
                issues.push(`Tool ${toolName} references missing plugin "${pluginId}"`);
                continue;
            }
            if (plugin.status !== 'enabled') {
                issues.push(`Tool ${toolName} is registered but plugin "${pluginId}" is status="${plugin.status}"`);
                continue;
            }
            const listed = plugin.handlers.some(h => h.toolName === toolName);
            if (!listed) {
                issues.push(`Tool ${toolName} is registered but not tracked in plugin.handlers for "${pluginId}"`);
            }
        }

        for (const [pluginId, plugin] of this.plugins) {
            if (plugin.status !== 'enabled') continue;
            for (const handler of plugin.handlers) {
                if (!this.mcpServer.tools.has(handler.toolName)) {
                    issues.push(`Enabled plugin "${pluginId}" missing registered tool "${handler.toolName}"`);
                }
            }
        }

        return { ok: issues.length === 0, issues };
    }

    listPlugins() {
        const result = [];
        for (const [id, plugin] of this.plugins) {
            result.push({
                id,
                name: plugin.manifest.name,
                version: plugin.manifest.version || '0.0.0',
                description: plugin.manifest.description || '',
                agentSlug: plugin.manifest.agentSlug || null,
                agentSlugs: plugin.manifest.agentSlugs || [],
                capabilities: Array.isArray(plugin.manifest.capabilities) ? plugin.manifest.capabilities : [],
                capabilityContracts: plugin.manifest.capabilityContracts || plugin.manifest.contracts || {},
                status: plugin.status,
                handlerCount: plugin.handlers.length,
                handlers: plugin.handlers.map(h => h.toolName),
                chatUICount: plugin.chatUIs?.length || 0
            });
        }
        return result;
    }

    getAgentPlugin(agentSlug) {
        return this.getAgentPlugins(agentSlug)[0] || null;
    }

    _parseAgentConfig(agentInfo) {
        const raw = agentInfo?.config;
        if (!raw) return {};
        if (typeof raw === 'object' && !Array.isArray(raw)) {
            return raw;
        }
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed;
                }
            } catch (error) {
                return {};
            }
        }
        return {};
    }

    _normalizeUiMode(value) {
        const mode = String(value || 'plugin').trim().toLowerCase();
        if (mode === 'no_ui' || mode === 'noplugin' || mode === 'classic') {
            return 'no_ui';
        }
        return 'plugin';
    }

    _getConfiguredUiPluginId(agentInfo) {
        const config = this._parseAgentConfig(agentInfo);
        return String(
            config.chat_ui_plugin
            || config.chatUiPlugin
            || config.ui_plugin_id
            || config.uiPluginId
            || ''
        ).trim() || null;
    }

    _resolveFallbackUiPluginId(agentInfo) {
        const slug = String(agentInfo?.slug || '').trim();
        if (!slug) return null;

        const legacyContractMap = {
            'file-manager': 'agent-file-browser',
            'research-orchestrator': 'agent-research-orchestrator-ui',
            'universal-rag-agent': 'agent-rag-studio'
        };
        const mappedPlugin = legacyContractMap[slug];
        if (mappedPlugin && this.plugins.has(mappedPlugin)) {
            return mappedPlugin;
        }

        const exactMatches = [];
        for (const [id, plugin] of this.plugins) {
            const declared = String(plugin.manifest?.agentSlug || '').trim();
            if (declared && declared === slug) {
                exactMatches.push(id);
            }
        }
        exactMatches.sort((a, b) => a.localeCompare(b));
        return exactMatches[0] || null;
    }

    resolvePrimaryAgentChatUIPlugin(agentInfo, options = {}) {
        const allowFallback = options.allowFallback !== false;
        const configured = this._getConfiguredUiPluginId(agentInfo);
        if (configured && this.plugins.has(configured)) {
            return configured;
        }
        if (!allowFallback) return null;
        return this._resolveFallbackUiPluginId(agentInfo);
    }

    _resolveAgentChatUITarget(agentInfo, uiContext = {}) {
        const uiMode = this._normalizeUiMode(uiContext?.uiMode);
        if (uiMode !== 'plugin') {
            return { uiMode, pluginId: null, plugin: null };
        }

        const requestedPluginId = String(uiContext?.uiPluginId || '').trim() || null;
        const primaryPluginId = this.resolvePrimaryAgentChatUIPlugin(agentInfo, { allowFallback: true });
        const resolvedPluginId = requestedPluginId || primaryPluginId;
        if (!resolvedPluginId) {
            return { uiMode, pluginId: null, plugin: null };
        }

        // Enforce 1:1 contract: only the primary plugin can own chat UI for this agent.
        if (primaryPluginId && resolvedPluginId !== primaryPluginId) {
            return { uiMode, pluginId: primaryPluginId, plugin: null, rejectedPluginId: resolvedPluginId };
        }

        const plugin = this.plugins.get(resolvedPluginId) || null;
        if (!plugin || plugin.status !== 'enabled' || !plugin.chatUIs?.length) {
            return { uiMode, pluginId: resolvedPluginId, plugin: null };
        }

        return { uiMode, pluginId: resolvedPluginId, plugin };
    }

    getPluginsByCapability(capability, options = {}) {
        const requested = String(capability || '').trim();
        if (!requested) return [];
        const enabledOnly = options.enabledOnly === true;
        const matches = [];
        for (const [id, plugin] of this.plugins) {
            const capabilities = Array.isArray(plugin.manifest?.capabilities)
                ? plugin.manifest.capabilities.map(value => String(value).trim())
                : [];
            if (!capabilities.includes(requested)) continue;
            if (enabledOnly && plugin.status !== 'enabled') continue;
            matches.push({
                id,
                name: plugin.manifest.name,
                description: plugin.manifest.description || '',
                status: plugin.status,
                capabilities,
                contract: getManifestCapabilityContract(plugin.manifest, requested)
            });
        }
        return matches;
    }

    getAgentPlugins(agentSlug) {
        const slug = String(agentSlug || '').trim();
        if (!slug) return [];
        const matches = [];
        for (const [id, plugin] of this.plugins) {
            const manifest = plugin.manifest || {};
            const slugs = [
                manifest.agentSlug,
                ...(Array.isArray(manifest.agentSlugs) ? manifest.agentSlugs : [])
            ].filter(Boolean).map(value => String(value).trim());

            if (slugs.includes(slug) || slugs.includes('*')) {
                matches.push(id);
            }
        }

        return matches;
    }

    async getAgentChatUI(agentInfo, uiContext = {}) {
        const target = this._resolveAgentChatUITarget(agentInfo, uiContext);
        if (!target.plugin) {
            return null;
        }

        const panels = [];
        const css = [];
        const actions = {};

        const pluginId = target.pluginId;
        const plugin = target.plugin;
        for (const contribution of plugin.chatUIs) {
            try {
                const html = typeof contribution.renderPanel === 'function'
                    ? await contribution.renderPanel(agentInfo)
                    : contribution.html;
                if (!html) continue;
                panels.push(`<div class="agent-ui-plugin" data-agent-ui-plugin-id="${pluginId}">${html}</div>`);
                if (contribution.css) {
                    css.push(`/* ${pluginId} */\n${contribution.css}`);
                }
                actions[pluginId] = Object.keys(contribution.actions || {});
            } catch (error) {
                console.error(`[PluginManager] Chat UI render failed for "${pluginId}":`, error.message);
            }
        }

        if (panels.length === 0) {
            return null;
        }

        return {
            pluginIds: [pluginId],
            uiPluginId: pluginId,
            uiMode: target.uiMode,
            title: agentInfo?.name || 'Agent',
            html: panels.join('\n'),
            css: css.join('\n\n'),
            actions
        };
    }

    _getEnabledChatContributions(agentInfo, pluginId = null, uiContext = {}) {
        const contextWithPlugin = {
            ...uiContext,
            ...(pluginId ? { uiPluginId: pluginId } : {})
        };
        const target = this._resolveAgentChatUITarget(agentInfo, contextWithPlugin);
        const pluginIds = target.plugin ? [target.pluginId] : [];
        const output = [];

        for (const id of pluginIds) {
            const plugin = this.plugins.get(id);
            if (!plugin || plugin.status !== 'enabled' || !plugin.chatUIs?.length) {
                continue;
            }
            for (const contribution of plugin.chatUIs) {
                output.push({ pluginId: id, plugin, contribution });
            }
        }

        return output;
    }

    async runAgentChatUIAction(agentInfo, action, payload = {}, uiContext = {}) {
        const actionName = String(action || '').trim();
        if (!actionName) {
            throw new Error('Agent chat UI action is required');
        }

        const requestedPluginId = payload?.pluginId || payload?._pluginId || null;
        const contributions = this._getEnabledChatContributions(agentInfo, requestedPluginId, uiContext);
        for (const { pluginId, plugin, contribution } of contributions) {
            const handler = contribution.actions?.[actionName];
            if (typeof handler !== 'function') {
                continue;
            }
            return handler({
                agentInfo,
                payload,
                pluginId,
                context: plugin.context,
                render: () => {
                    if (typeof contribution.renderPanel === 'function') {
                        return contribution.renderPanel(agentInfo);
                    }
                    return contribution.html || '';
                }
            });
        }

        throw new Error(`Agent chat UI action "${actionName}" not found`);
    }

    async handleAgentChatUIEvent(agentInfo, eventName, payload = {}, uiContext = {}) {
        const key = eventName === 'activated'
            ? 'onTabActivated'
            : eventName === 'deactivated'
                ? 'onTabDeactivated'
                : null;
        if (!key) return null;

        const results = [];
        for (const { pluginId, plugin, contribution } of this._getEnabledChatContributions(agentInfo, null, uiContext)) {
            const handler = contribution[key];
            if (typeof handler !== 'function') continue;
            results.push(await handler(agentInfo, payload, plugin.context, pluginId));
        }
        return { success: true, results };
    }

    getPluginDetail(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return null;
        return {
            id: pluginId,
            manifest: plugin.manifest,
            status: plugin.status,
            capabilities: Array.isArray(plugin.manifest.capabilities) ? plugin.manifest.capabilities : [],
            capabilityContracts: plugin.manifest.capabilityContracts || plugin.manifest.contracts || {},
            handlers: plugin.handlers.map(h => ({
                name: h.name,
                toolName: h.toolName,
                description: h.definition.description
            })),
            config: this._loadPluginConfig(pluginId)
        };
    }

    async runPluginAction(pluginId, action, params = {}) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
        if (plugin.status !== 'enabled') throw new Error(`Plugin "${pluginId}" must be enabled to run actions`);
        if (!plugin.module) throw new Error(`Plugin "${pluginId}" module is not loaded`);

        if (typeof plugin.module.runAction === 'function') {
            return plugin.module.runAction(action, params, plugin.context);
        }

        if (plugin.module.actions && typeof plugin.module.actions[action] === 'function') {
            return plugin.module.actions[action](params, plugin.context);
        }

        throw new Error(`Plugin "${pluginId}" does not implement action "${action}"`);
    }

    // ==================== Shutdown ====================

    async disableAll(options = {}) {
        for (const [id, plugin] of this.plugins) {
            if (plugin.status === 'enabled') {
                try {
                    await this.disablePlugin(id, options);
                } catch (e) {
                    console.error(`[PluginManager] Failed to disable "${id}":`, e.message);
                }
            }
        }
    }

    _registerManagedProcess(plugin, proc, metadata = {}) {
        if (!plugin || !proc || typeof proc.kill !== 'function') {
            return () => {};
        }

        const entry = { proc, metadata };
        plugin.managedProcesses = plugin.managedProcesses || new Set();
        plugin.managedProcesses.add(entry);

        const cleanup = () => {
            plugin.managedProcesses.delete(entry);
        };

        if (typeof proc.once === 'function') {
            proc.once('exit', cleanup);
        }

        return cleanup;
    }

    _terminateManagedProcesses(plugin, reason = '') {
        const tracked = Array.from(plugin.managedProcesses || []);
        plugin.managedProcesses?.clear();
        for (const entry of tracked) {
            this._terminateManagedProcess(entry.proc, reason, entry.metadata);
        }
    }

    _terminateManagedProcess(proc, reason = '', metadata = {}) {
        if (!proc || typeof proc.kill !== 'function') return;
        const label = metadata?.name ? `${metadata.name}` : 'managed-process';
        try {
            proc.kill('SIGTERM');
        } catch (_) {}
        try {
            proc.kill('SIGKILL');
        } catch (_) {}
        if (reason) {
            console.log(`[PluginManager] Forced stop ${label} (${reason})`);
        }
    }

    _emergencyTerminateAllManagedProcesses(reason = 'emergency-exit') {
        for (const [, plugin] of this.plugins) {
            this._terminateManagedProcesses(plugin, reason);
        }
    }

    _installEmergencyProcessHooks() {
        if (EMERGENCY_HOOKS_INSTALLED) return;
        EMERGENCY_HOOKS_INSTALLED = true;

        const runEmergencyStop = (reason) => {
            if (EMERGENCY_EXIT_IN_PROGRESS) return;
            EMERGENCY_EXIT_IN_PROGRESS = true;
            for (const manager of ACTIVE_PLUGIN_MANAGERS) {
                try {
                    manager._emergencyTerminateAllManagedProcesses(reason);
                } catch (error) {
                    console.error('[PluginManager] Emergency managed-process cleanup failed:', error.message);
                }
            }
        };

        process.on('exit', () => {
            runEmergencyStop('process-exit');
        });

        for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
            process.on(signal, () => {
                runEmergencyStop(`signal:${signal}`);
                process.exit(0);
            });
        }
    }

    _cleanupPluginHandlers(plugin) {
        for (const handler of plugin.handlers) {
            this.mcpServer.tools.delete(handler.toolName);
            if (this.capabilityManager) {
                this.capabilityManager.unregisterCustomTool(handler.toolName);
            }
        }
        plugin.handlers = [];
        plugin.chatUIs = [];
    }

    _clearPluginRequireCache(pluginDir) {
        const resolvedRoot = path.resolve(pluginDir);
        const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
        const isWin = process.platform === 'win32';
        const normRoot = isWin ? rootPrefix.toLowerCase() : rootPrefix;
        const normExactRoot = isWin ? resolvedRoot.toLowerCase() : resolvedRoot;

        for (const cachedPath of Object.keys(require.cache)) {
            const resolvedPath = path.resolve(cachedPath);
            const probe = isWin ? resolvedPath.toLowerCase() : resolvedPath;
            if (probe === normExactRoot || probe.startsWith(normRoot)) {
                delete require.cache[cachedPath];
            }
        }
    }

    _normalizeScopeList(rawScope) {
        if (!rawScope) return null;
        const values = Array.isArray(rawScope) ? rawScope : [rawScope];
        const normalized = values
            .map(value => String(value || '').trim())
            .filter(Boolean);
        if (normalized.length === 0 || normalized.includes('*')) {
            return null;
        }
        return Array.from(new Set(normalized));
    }

    _resolveManifestAgentScopes(manifest = {}) {
        const scopes = [
            manifest.agentSlug,
            ...(Array.isArray(manifest.agentSlugs) ? manifest.agentSlugs : [])
        ];
        return this._normalizeScopeList(scopes);
    }
}

module.exports = PluginManager;
