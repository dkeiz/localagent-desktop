const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

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

    async scanPlugins() {
        if (!fs.existsSync(this.pluginsDir)) return;

        const dirs = fs.readdirSync(this.pluginsDir, { withFileTypes: true })
            .filter(d => d.isDirectory());

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

                // Ensure DB row exists
                const existing = this.db.get('SELECT id, status FROM plugins WHERE id = ?', [manifest.id]);
                if (!existing) {
                    this.db.run(
                        'INSERT INTO plugins (id, name, version, status) VALUES (?, ?, ?, ?)',
                        [manifest.id, manifest.name, manifest.version || '0.0.0', 'disabled']
                    );
                }

                this.plugins.set(manifest.id, {
                    manifest,
                    dir: path.join(this.pluginsDir, dir.name),
                    status: 'disabled',
                    persistedStatus: existing?.status || 'disabled',
                    module: null,
                    context: null,
                    handlers: []
                });
            } catch (e) {
                console.error(`[PluginManager] Failed to read manifest in ${dir.name}:`, e.message);
            }
        }
    }

    // ==================== Lifecycle ====================

    async enablePlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
        if (plugin.status === 'enabled' && plugin.module && plugin.context) return;

        const mainPath = path.join(plugin.dir, plugin.manifest.main);
        if (!fs.existsSync(mainPath)) {
            throw new Error(`Plugin entry point not found: ${mainPath}`);
        }

        // Clear require cache for hot-reload during development
        delete require.cache[require.resolve(mainPath)];

        const pluginModule = require(mainPath);
        plugin.module = pluginModule;
        plugin.handlers = [];

        // Build context for the plugin
        const context = this._buildPluginContext(pluginId, plugin);
        plugin.context = context;

        try {
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
        plugin.persistedStatus = 'enabled';
        this._updateDbStatus(pluginId, 'enabled');
        
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
                await plugin.module.onDisable();
            } catch (e) {
                console.error(`[PluginManager] onDisable error for "${pluginId}":`, e.message);
            }
        }

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

        return {
            config,
            pluginId,
            pluginDir: plugin.dir,

            registerHandler(name, definition, handler) {
                const toolName = `plugin_${pluginId.replace(/-/g, '_')}_${name}`;
                
                self.mcpServer.registerTool(toolName, {
                    name: toolName,
                    description: `[Plugin: ${plugin.manifest.name}] ${definition.description || name}`,
                    userDescription: definition.description || name,
                    inputSchema: definition.inputSchema || { type: 'object' },
                    isPlugin: true,
                    pluginId
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

    async setPluginConfig(pluginId, key, value) {
        const settingKey = `plugin.${pluginId}.${key}`;
        this.db.run(
            'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [settingKey, String(value)]
        );

        const plugin = this.plugins.get(pluginId);
        if (plugin?.context?.config) {
            plugin.context.config[key] = String(value);
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
                status: plugin.status,
                handlerCount: plugin.handlers.length,
                handlers: plugin.handlers.map(h => h.toolName)
            });
        }
        return result;
    }

    getPluginDetail(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return null;
        return {
            id: pluginId,
            manifest: plugin.manifest,
            status: plugin.status,
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

    _cleanupPluginHandlers(plugin) {
        for (const handler of plugin.handlers) {
            this.mcpServer.tools.delete(handler.toolName);
            if (this.capabilityManager) {
                this.capabilityManager.unregisterCustomTool(handler.toolName);
            }
        }
        plugin.handlers = [];
    }
}

module.exports = PluginManager;
