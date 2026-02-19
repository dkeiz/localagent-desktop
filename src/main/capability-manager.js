const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * CapabilityManager - Manages tool permissions and capability groups
 * 
 * Architecture:
 * - Main Switch: Master toggle for all tools
 * - Safe Tools: Always available when main switch ON
 * - 6 Groups: Toggleable capability groups
 */
class CapabilityManager extends EventEmitter {
    constructor(db) {
        super();
        this.db = db;
        this.config = null;
        this.customToolSafety = new Map(); // toolName -> isSafe
        this.loadConfig();
    }

    loadConfig() {
        const configPath = path.join(__dirname, 'tool-classification.json');
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        this.config = JSON.parse(rawConfig);
    }

    saveConfig() {
        const configPath = path.join(__dirname, 'tool-classification.json');
        fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
        this.emit('config-changed', this.config);
    }

    // ==================== Main Switch ====================

    isMainEnabled() {
        return this.config.mainSwitch.enabled;
    }

    setMainEnabled(enabled) {
        this.config.mainSwitch.enabled = enabled;
        this.saveConfig();
        return this.config.mainSwitch.enabled;
    }

    // ==================== Group Management ====================

    isGroupEnabled(groupId) {
        const group = this.config.groups[groupId];
        if (!group) return false;

        // Files group uses mode instead of enabled
        if (groupId === 'files') {
            return group.mode !== 'off';
        }
        return group.enabled === true;
    }

    setGroupEnabled(groupId, enabled) {
        const group = this.config.groups[groupId];
        if (!group) return false;

        // If enabling any group, auto-enable main switch
        if (enabled && !this.config.mainSwitch.enabled) {
            this.config.mainSwitch.enabled = true;
        }

        if (groupId === 'files') {
            // Files uses mode
            group.mode = enabled ? 'read' : 'off';
        } else {
            group.enabled = enabled;
        }

        this.saveConfig();
        return true;
    }

    getFilesMode() {
        return this.config.groups.files.mode;
    }

    setFilesMode(mode) {
        if (!['off', 'read', 'full'].includes(mode)) {
            throw new Error('Invalid files mode. Use: off, read, full');
        }

        // If enabling files, auto-enable main switch
        if (mode !== 'off' && !this.config.mainSwitch.enabled) {
            this.config.mainSwitch.enabled = true;
        }

        this.config.groups.files.mode = mode;
        this.saveConfig();
        return mode;
    }

    // ==================== Tool Access ====================

    getActiveTools() {
        // If main switch is off, no tools available
        if (!this.config.mainSwitch.enabled) {
            return [];
        }

        const activeTools = new Set();

        // Always include safe tools when main is on
        this.config.safeTools.tools.forEach(tool => activeTools.add(tool));

        // Add tools from enabled groups
        for (const [groupId, group] of Object.entries(this.config.groups)) {
            if (groupId === 'files') {
                // Files group uses mode
                const modeTools = group.modes[group.mode] || [];
                modeTools.forEach(tool => activeTools.add(tool));
            } else if (groupId === 'ports') {
                // Ports group doesn't have regular tools
                continue;
            } else if (group.enabled && group.tools) {
                group.tools.forEach(tool => activeTools.add(tool));
            }
        }

        // Add safe custom tools
        for (const [toolName, isSafe] of this.customToolSafety) {
            if (isSafe || this.config.groups.unsafe.enabled) {
                activeTools.add(toolName);
            }
        }

        return Array.from(activeTools);
    }

    isToolActive(toolName) {
        return this.getActiveTools().includes(toolName);
    }

    // ==================== Custom Tools ====================

    registerCustomTool(toolName, isSafe = false) {
        this.customToolSafety.set(toolName, isSafe);
    }

    setCustomToolSafe(toolName, isSafe) {
        this.customToolSafety.set(toolName, isSafe);
        this.emit('custom-tool-safety-changed', { toolName, isSafe });
    }

    isCustomToolSafe(toolName) {
        return this.customToolSafety.get(toolName) === true;
    }

    // ==================== Port Listeners ====================

    getPortListeners() {
        return this.config.groups.ports.listeners || [];
    }

    addPortListener(listener) {
        if (!this.config.groups.ports.listeners) {
            this.config.groups.ports.listeners = [];
        }
        this.config.groups.ports.listeners.push(listener);
        this.saveConfig();
        this.emit('port-listener-added', listener);
        return listener;
    }

    removePortListener(port) {
        const listeners = this.config.groups.ports.listeners || [];
        this.config.groups.ports.listeners = listeners.filter(l => l.port !== port);
        this.saveConfig();
        this.emit('port-listener-removed', port);
    }

    // ==================== State Export ====================

    getState() {
        // Build groups dynamically from config — no hard-coding
        const groups = {};
        for (const [id, group] of Object.entries(this.config.groups)) {
            if (id === 'files') {
                groups[id] = group.mode; // string: 'off'|'read'|'full'
            } else {
                groups[id] = group.enabled === true;
            }
        }
        return {
            mainEnabled: this.config.mainSwitch.enabled,
            groups,
            activeToolCount: this.getActiveTools().length,
            portListeners: this.getPortListeners()
        };
    }

    // Returns the group id that owns a given tool name, or null
    getGroupForTool(toolName) {
        for (const [id, group] of Object.entries(this.config.groups)) {
            if (id === 'files') {
                // Check all mode arrays
                const allTools = new Set([
                    ...(group.modes?.off || []),
                    ...(group.modes?.read || []),
                    ...(group.modes?.full || [])
                ]);
                if (allTools.has(toolName)) return id;
            } else if (Array.isArray(group.tools) && group.tools.includes(toolName)) {
                return id;
            }
        }
        return null;
    }

    getGroupsConfig() {
        return Object.entries(this.config.groups).map(([id, group]) => {
            // For files group, compute active tools based on current mode
            const tools = id === 'files'
                ? (group.modes?.[group.mode] || [])
                : (group.tools || []);
            return {
                id,
                name: group.name,
                description: group.description,
                icon: group.icon,
                enabled: id === 'files' ? group.mode !== 'off' : group.enabled === true,
                mode: id === 'files' ? group.mode : undefined,
                modes: id === 'files' ? group.modes : undefined,
                tools,
                allTools: id === 'files'
                    ? Object.values(group.modes || {}).flat()
                    : (group.tools || []),
                listeners: group.listeners
            };
        });
    }
}

module.exports = CapabilityManager;
