const { EventEmitter } = require('events');
const { registerConnectorTools } = require('./mcp/register-connector-tools');
const { registerAgentTools } = require('./mcp/register-agent-tools');
const { registerCoreTools } = require('./mcp/register-core-tools');
const { registerFileTools } = require('./mcp/register-file-tools');
const { registerMediaTools } = require('./mcp/register-media-tools');
const { registerPromptTools } = require('./mcp/register-prompt-tools');
const { registerTerminalTools } = require('./mcp/register-terminal-tools');
const { registerWebSystemTools } = require('./mcp/register-web-system-tools');
const { registerWorkflowTools } = require('./mcp/register-workflow-tools');
const { registerResearchTools } = require('./mcp/register-research-tools');

const BUILT_IN_TOOL_REGISTRARS = [
  registerCoreTools,
  registerAgentTools,
  registerPromptTools,
  registerConnectorTools,
  registerWorkflowTools,
  registerResearchTools,
  registerFileTools,
  registerWebSystemTools,
  registerMediaTools,
  registerTerminalTools
];

class MCPServer extends EventEmitter {
  constructor(db, capabilityManager = null) {
    super();
    this.db = db;
    this.capabilityManager = capabilityManager;
    this.aiService = null;
    this.tools = new Map();
    this.toolStates = new Map();
    this.proxyServers = new Map();
    this._executionContextStack = [];
    this.initializeBuiltInTools();
  }

  setAIService(aiService) {
    this.aiService = aiService;
  }

  setAgentLoop(agentLoop) {
    this._agentLoop = agentLoop;
  }

  setCurrentSessionId(sessionId) {
    this._currentSessionId = sessionId;
  }

  getCurrentSessionId() {
    const activeContext = this._executionContextStack[this._executionContextStack.length - 1];
    if (activeContext && activeContext.sessionId !== undefined) {
      return activeContext.sessionId;
    }
    return this._currentSessionId;
  }

  getCurrentExecutionContext() {
    return this._executionContextStack[this._executionContextStack.length - 1] || null;
  }

  setConnectorRuntime(connectorRuntime) {
    this._connectorRuntime = connectorRuntime;
  }

  setPromptFileManager(promptFileManager) {
    this._promptFileManager = promptFileManager;
  }

  setSessionWorkspace(sessionWorkspace) {
    this._sessionWorkspace = sessionWorkspace;
  }

  setWorkflowManager(workflowManager) {
    this._workflowManager = workflowManager;
  }

  setAgentManager(agentManager) {
    this._agentManager = agentManager;
  }

  setKnowledgeManager(knowledgeManager) {
    this._knowledgeManager = knowledgeManager;
  }

  setResearchRuntime(researchRuntime) {
    this._researchRuntime = researchRuntime;
  }

  initializeBuiltInTools() {
    for (const registerTools of BUILT_IN_TOOL_REGISTRARS) {
      registerTools(this);
    }
    this.loadToolGroups();
  }

  registerTool(name, definition, handler) {
    if (this.tools.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }
    this.tools.set(name, { definition, handler });
  }

  getToolsByNames(toolNames = [], { includeInternal = false } = {}) {
    const output = [];
    const seen = new Set();

    for (const toolName of toolNames) {
      const key = String(toolName || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const tool = this.tools.get(key);
      if (!tool?.definition) continue;
      if (tool.definition.internal === true && !includeInternal) continue;
      output.push(tool.definition);
    }

    return output;
  }

  async withExecutionContext(context, fn) {
    this._executionContextStack.push(context || {});
    try {
      return await fn();
    } finally {
      this._executionContextStack.pop();
    }
  }

  async executeTool(toolName, params = {}, toolCallId = null, options = {}) {
    const bypassPermissions = options && options.bypassPermissions === true;
    const executionContext = options && options.context ? options.context : null;
    const tool = this.tools.get(toolName);
    if (!tool) {
      this.emit('tool-executed', { toolName, success: false, error: 'Tool not found' });
      throw new Error(`Tool not found: ${toolName}`);
    }

    const isInternalTool = tool.definition?.internal === true;

    if (!bypassPermissions && !isInternalTool && this.capabilityManager && !this.capabilityManager.isToolActive(toolName)) {
      const permissionRequest = {
        needsPermission: true,
        toolName,
        params,
        toolDefinition: tool.definition,
        reason: 'capability_group_disabled'
      };
      console.log(`[MCP] Tool ${toolName} blocked by CapabilityManager`);
      return permissionRequest;
    }

    const isActive = (bypassPermissions || isInternalTool) ? true : await this.getToolActiveState(toolName);
    if (!isActive) {
      const permissionRequest = {
        needsPermission: true,
        toolName,
        params,
        toolDefinition: tool.definition,
        reason: 'tool_disabled'
      };
      console.log(`[MCP] Tool ${toolName} disabled (DB state), requesting permission`);
      return permissionRequest;
    }

    try {
      if (tool.definition.inputSchema?.properties) {
        for (const [key, prop] of Object.entries(tool.definition.inputSchema.properties)) {
          if (params[key] === undefined && prop.default !== undefined) {
            params[key] = prop.default;
          }
        }
      }

      if (tool.definition.inputSchema) {
        this.validateInput(params, tool.definition.inputSchema);
      }

      const timeoutMs = parseInt(await this.db.getSetting('tool_timeout_ms') || '5000');
      const result = executionContext
        ? await this.withExecutionContext(
          executionContext,
          () => this.executeWithTimeout(tool.handler(params), timeoutMs, toolName)
        )
        : await this.executeWithTimeout(tool.handler(params), timeoutMs, toolName);

      if (toolName.startsWith('calendar_')) this.emit('calendar-update');
      else if (toolName.startsWith('todo_')) this.emit('todo-update');

      const enrichedResult = {
        toolCallId: toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        toolName,
        timestamp: new Date().toISOString(),
        success: true,
        params,
        result
      };

      this.emit('tool-executed', enrichedResult);
      return enrichedResult;
    } catch (error) {
      const errorResult = {
        toolCallId: toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        toolName,
        timestamp: new Date().toISOString(),
        success: false,
        params,
        error: error.message
      };
      this.emit('tool-executed', errorResult);
      throw error;
    }
  }

  async executeWithTimeout(promise, timeoutMs, toolName) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Tool '${toolName}' timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async getToolActiveState(toolName) {
    try {
      if (this.toolStates.has(toolName)) {
        return this.toolStates.get(toolName);
      }

      const key = `tool.${toolName}.active`;
      const value = await this.db.getSetting(key);
      const isActive = value !== 'false';
      this.toolStates.set(toolName, isActive);
      return isActive;
    } catch (error) {
      console.error('Error getting tool state:', error);
      return true;
    }
  }

  async setToolActiveState(toolName, active) {
    try {
      const key = `tool.${toolName}.active`;
      const value = active ? 'true' : 'false';
      await this.db.setSetting(key, value);
      this.toolStates.set(toolName, active);
      console.log(`Tool ${toolName} ${active ? 'enabled' : 'disabled'}`);
      return { toolName, active };
    } catch (error) {
      console.error('Error setting tool state:', error);
      throw error;
    }
  }

  parseToolCall(text) {
    const calls = [];
    const toolPrefix = /TOOL:(\w+)/g;
    let match;

    while ((match = toolPrefix.exec(text)) !== null) {
      const toolName = match[1];
      const afterTool = text.slice(match.index + match[0].length);
      let params = {};

      if (afterTool.startsWith('{')) {
        let depth = 0;
        let end = 0;
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < afterTool.length; i++) {
          const char = afterTool[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            escapeNext = true;
            continue;
          }

          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') depth++;
            else if (char === '}') {
              depth--;
              if (depth === 0) {
                end = i + 1;
                break;
              }
            }
          }
        }

        if (end > 0) {
          try {
            params = JSON.parse(afterTool.slice(0, end));
          } catch (error) {
            console.error('Failed to parse tool params:', error);
          }
        }
      }

      const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      calls.push({
        toolName,
        params,
        toolCallId,
        timestamp: new Date().toISOString()
      });
    }

    return calls;
  }

  async executeToolCalls(text) {
    const calls = this.parseToolCall(text);
    const results = [];

    for (const call of calls) {
      try {
        const result = await this.executeTool(call.toolName, call.params);
        results.push({ tool: call.toolName, success: true, result });
      } catch (error) {
        results.push({ tool: call.toolName, success: false, error: error.message });
      }
    }

    return results;
  }

  validateInput(params, schema) {
    if (schema.required) {
      for (const requiredField of schema.required) {
        if (params[requiredField] === undefined) {
          throw new Error(`Missing required field: ${requiredField}`);
        }
      }
    }

    for (const [field, value] of Object.entries(params)) {
      const fieldSchema = schema.properties[field];
      if (!fieldSchema) {
        throw new Error(`Unknown field: ${field}`);
      }

      const actualType = Array.isArray(value)
        ? 'array'
        : value === null
          ? 'null'
          : typeof value;

      if (fieldSchema.type && actualType !== fieldSchema.type) {
        throw new Error(`Field ${field} must be of type ${fieldSchema.type}`);
      }

      if (fieldSchema.format === 'date-time' && isNaN(Date.parse(value))) {
        throw new Error(`Field ${field} must be a valid date-time string`);
      }
    }
  }

  getTools() {
    const tools = [];
    for (const [, tool] of this.tools) {
      if (tool.definition?.internal === true) continue;
      tools.push(tool.definition);
    }
    return tools;
  }

  getToolsDocumentation() {
    const docs = [];
    for (const [, tool] of this.tools) {
      const def = tool.definition;
      if (def?.internal === true) continue;
      const doc = {
        name: def.name,
        description: def.userDescription || def.description,
        technicalDescription: def.description,
        parameters: [],
        example: def.example || '',
        exampleOutput: def.exampleOutput || '',
        category: this.categorizeToolName(def.name)
      };

      if (def.inputSchema?.properties) {
        const required = def.inputSchema.required || [];
        Object.entries(def.inputSchema.properties).forEach(([key, prop]) => {
          doc.parameters.push({
            name: key,
            type: prop.type,
            description: prop.description || 'No description',
            required: required.includes(key),
            default: prop.default
          });
        });
      }

      docs.push(doc);
    }
    return docs;
  }

  categorizeToolName(name) {
    if (this.toolGroups) {
      for (const [, group] of this.toolGroups) {
        if (group.tools.includes(name)) {
          return group.name;
        }
      }
    }

    if (name.includes('calendar')) return 'Calendar';
    if (name.includes('todo')) return 'Todo';
    if (name.includes('weather') || name.includes('time')) return 'System';
    if (name.includes('conversation') || name.includes('search')) return 'Search';
    if (name.includes('calculate')) return 'Math';
    if (name.includes('rule')) return 'Rules';
    if (name.includes('stats') || name.includes('provider') || name.includes('prompt')) return 'System';
    return 'Other';
  }

  loadToolGroups() {
    if (this.capabilityManager) {
      try {
        this.toolGroups = new Map();
        this.activeGroups = new Set();
        const groups = this.capabilityManager.getGroupsConfig();
        for (const group of groups) {
          this.toolGroups.set(group.id, {
            name: group.name,
            description: group.description,
            icon: group.icon,
            tools: group.allTools || group.tools || []
          });
          if (group.enabled) this.activeGroups.add(group.id);
        }
        console.log(`[MCP] Loaded ${this.toolGroups.size} tool groups from CapabilityManager`);
        return;
      } catch (error) {
        console.error('[MCP] Failed to load groups from CapabilityManager, falling back:', error.message);
      }
    }

    try {
      const path = require('path');
      const fs = require('fs');
      const groupsPath = path.join(__dirname, 'tool-groups.json');
      const data = fs.readFileSync(groupsPath, 'utf-8');
      const config = JSON.parse(data);

      this.toolGroups = new Map();
      this.activeGroups = new Set();

      for (const [groupId, groupConfig] of Object.entries(config.groups)) {
        this.toolGroups.set(groupId, groupConfig);
        if (groupConfig.defaultActive) {
          this.activeGroups.add(groupId);
        }
      }
      console.warn('[MCP] WARNING: Using deprecated tool-groups.json. CapabilityManager not available.');
    } catch (error) {
      console.error('[MCP] Failed to load tool groups:', error.message);
      this.toolGroups = new Map();
      this.activeGroups = new Set();
    }
  }

  async activateGroup(groupId) {
    if (!this.toolGroups.has(groupId)) {
      throw new Error(`Unknown group: ${groupId}`);
    }

    this.activeGroups.add(groupId);
    const group = this.toolGroups.get(groupId);
    for (const toolName of group.tools) {
      await this.setToolActiveState(toolName, true);
    }

    console.log(`[MCP] Activated group: ${groupId} (${group.tools.length} tools)`);
    return { activated: groupId, tools: group.tools };
  }

  async deactivateGroup(groupId) {
    if (!this.toolGroups.has(groupId)) {
      throw new Error(`Unknown group: ${groupId}`);
    }

    this.activeGroups.delete(groupId);
    const group = this.toolGroups.get(groupId);
    for (const toolName of group.tools) {
      await this.setToolActiveState(toolName, false);
    }

    console.log(`Deactivated group: ${groupId}`);
    return { deactivated: groupId, tools: group.tools };
  }

  getActiveTools() {
    if (this.capabilityManager) {
      const activeToolNames = this.capabilityManager.getActiveTools();
      return activeToolNames
        .map(name => this.tools.get(name)?.definition)
        .filter(def => Boolean(def) && def.internal !== true);
    }

    const activeTools = [];
    for (const groupId of this.activeGroups) {
      const group = this.toolGroups.get(groupId);
      if (group) {
        for (const toolName of group.tools) {
          const tool = this.tools.get(toolName);
          if (tool && tool.definition?.internal !== true) {
            activeTools.push(tool.definition);
          }
        }
      }
    }
    return activeTools;
  }

  getToolGroups() {
    if (this.capabilityManager) {
      return this.capabilityManager.getGroupsConfig().map(group => ({
        id: group.id,
        name: group.name,
        description: group.description,
        icon: group.icon,
        tools: group.allTools || group.tools || [],
        active: group.enabled,
        toolCount: (group.allTools || group.tools || []).length,
        mode: group.mode,
        modes: group.modes
      }));
    }

    const groups = [];
    for (const [groupId, group] of this.toolGroups) {
      groups.push({
        id: groupId,
        name: group.name,
        description: group.description,
        icon: group.icon,
        tools: group.tools,
        active: this.activeGroups.has(groupId),
        toolCount: group.tools.length
      });
    }
    return groups;
  }

  async addProxyServer(name, config) {
    this.proxyServers.set(name, config);
    return { success: true, name };
  }

  async removeProxyServer(name) {
    this.proxyServers.delete(name);
    return { success: true, name };
  }

  getProxyServers() {
    return Array.from(this.proxyServers.entries()).map(([name, config]) => ({
      name,
      config
    }));
  }

  async stop() {
    this.proxyServers.clear();
    this.removeAllListeners();
  }

  registerCustomTool(tool) {
    const handler = new Function('params', tool.code);
    this.registerTool(tool.name, {
      name: tool.name,
      description: tool.description,
      userDescription: tool.description,
      inputSchema: tool.input_schema || { type: 'object' },
      isCustom: true
    }, async (params) => handler(params));

    if (this.capabilityManager) {
      this.capabilityManager.registerCustomTool(tool.name, false);
    }
    console.log(`[MCP] Custom tool registered: ${tool.name}`);
  }

  async loadCustomTools() {
    try {
      const tools = await this.db.getCustomTools();
      for (const tool of tools) {
        try {
          this.registerCustomTool({
            name: tool.name,
            description: tool.description,
            code: tool.code,
            input_schema: JSON.parse(tool.input_schema || '{}')
          });
        } catch (error) {
          console.error(`[MCP] Failed to load custom tool ${tool.name}:`, error);
        }
      }
      console.log(`[MCP] Loaded ${tools.length} custom tools`);
    } catch (error) {
      console.error('[MCP] Failed to load custom tools:', error);
    }
  }
}

module.exports = MCPServer;
