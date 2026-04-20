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
    this._currentAgentContext = null;
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

  setCurrentAgentContext(context = null) {
    this._currentAgentContext = context && typeof context === 'object' ? { ...context } : null;
  }

  getCurrentAgentContext() {
    const activeContext = this.getCurrentExecutionContext();
    if (!activeContext && !this._currentAgentContext) {
      return null;
    }
    return {
      ...(this._currentAgentContext || {}),
      ...(activeContext || {})
    };
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
    const normalizedDefinition = { ...definition };
    const scopeSlugs = this._normalizeToolAgentScope(normalizedDefinition);
    if (scopeSlugs) {
      normalizedDefinition.agentScopeSlugs = scopeSlugs;
    } else {
      delete normalizedDefinition.agentScopeSlugs;
    }
    this.tools.set(name, { definition: normalizedDefinition, handler });
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

  _resolveTimeoutMs(toolName, params, defaultTimeoutMs) {
    const baseTimeout = Math.max(1, Number(defaultTimeoutMs) || 5000);
    const normalizedName = String(toolName || '').trim();
    const requestedTimeout = Math.max(1, Number(params?.timeout_ms) || 0);
    const isAwaitedSubagent = (
      (normalizedName === 'subagent' || normalizedName === 'run_subagent')
      && params?.wait === true
      && requestedTimeout > 0
    );

    if (!isAwaitedSubagent) {
      return baseTimeout;
    }

    // Let awaited delegated runs use the requested child timeout, plus a small
    // cushion so the outer MCP tool wrapper does not fire first.
    return Math.max(baseTimeout, requestedTimeout + 1000);
  }

  async executeTool(toolName, params = {}, toolCallId = null, options = {}) {
    const bypassPermissions = options && options.bypassPermissions === true;
    const executionContext = options && options.context ? options.context : null;
    const activeContext = executionContext || this.getCurrentAgentContext() || null;
    const tool = this.tools.get(toolName);
    if (!tool) {
      this.emit('tool-executed', { toolName, success: false, error: 'Tool not found' });
      throw new Error(`Tool not found: ${toolName}`);
    }

    const allowedForAgent = await this._isToolAllowedByAgentScope(
      tool.definition,
      activeContext
    );
    if (!allowedForAgent) {
      const scopedError = `Tool "${toolName}" is not allowed for the active agent scope`;
      this.emit('tool-executed', { toolName, success: false, error: scopedError });
      throw new Error(scopedError);
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

      const configuredTimeoutMs = parseInt(await this.db.getSetting('tool_timeout_ms') || '5000', 10);
      const timeoutMs = this._resolveTimeoutMs(toolName, params, configuredTimeoutMs);
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
        sessionId: activeContext?.sessionId !== undefined ? activeContext.sessionId : this.getCurrentSessionId(),
        source: activeContext?.source || null,
        agentId: activeContext?.agentId ?? null,
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
        sessionId: activeContext?.sessionId !== undefined ? activeContext.sessionId : this.getCurrentSessionId(),
        source: activeContext?.source || null,
        agentId: activeContext?.agentId ?? null,
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
    const source = String(text || '');
    const calls = [];
    const invalidCandidates = [];
    const acceptedKeys = new Set();
    const toolPrefix = /TOOL\s*:\s*([A-Za-z0-9_]+)/gi;
    let match;

    while ((match = toolPrefix.exec(source)) !== null) {
      const previousChar = match.index > 0 ? source[match.index - 1] : '';
      const isBoundary = !previousChar || /\s|[`"'([{<]/.test(previousChar);
      if (!isBoundary) {
        continue;
      }

      const toolName = match[1];
      const afterTool = source.slice(match.index + match[0].length);
      const parsed = this._extractJsonObject(afterTool);
      if (!parsed.ok) {
        invalidCandidates.push({
          toolName,
          reason: parsed.reason,
          snippet: source.slice(match.index, Math.min(source.length, match.index + 220))
        });
        continue;
      }

      const validated = this._validateParsedToolCall(toolName, parsed.params);
      if (!validated.ok) {
        invalidCandidates.push({
          toolName,
          reason: validated.reason,
          snippet: source.slice(match.index, Math.min(source.length, match.index + 220))
        });
        continue;
      }

      const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const acceptedKey = `${toolName}:${JSON.stringify(validated.params)}`;
      if (acceptedKeys.has(acceptedKey)) {
        continue;
      }
      acceptedKeys.add(acceptedKey);
      calls.push({
        toolName,
        params: validated.params,
        toolCallId,
        timestamp: new Date().toISOString()
      });
    }

    // Recovery pass: tolerate malformed call shapes like:
    // search_web_bing."query":"...","max_results":5}
    for (const [toolName] of this.tools) {
      const escapedTool = toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const loosePattern = new RegExp(`\\b${escapedTool}\\b`, 'gi');
      let looseMatch;

      while ((looseMatch = loosePattern.exec(source)) !== null) {
        const before = looseMatch.index > 0 ? source[looseMatch.index - 1] : '';
        const afterStart = looseMatch.index + looseMatch[0].length;
        const after = source.slice(afterStart);

        // Skip already explicit TOOL:name forms (handled above).
        if (before === ':') {
          continue;
        }

        const startsLikeParams = /^\s*(\{|\.)/.test(after);
        if (!startsLikeParams) {
          continue;
        }

        const parsed = this._extractLooseKeyValueObject(after);
        if (!parsed.ok) {
          invalidCandidates.push({
            toolName,
            reason: parsed.reason,
            snippet: source.slice(looseMatch.index, Math.min(source.length, looseMatch.index + 220))
          });
          continue;
        }

        const validated = this._validateParsedToolCall(toolName, parsed.params);
        if (!validated.ok) {
          invalidCandidates.push({
            toolName,
            reason: validated.reason,
            snippet: source.slice(looseMatch.index, Math.min(source.length, looseMatch.index + 220))
          });
          continue;
        }

        const acceptedKey = `${toolName}:${JSON.stringify(validated.params)}`;
        if (acceptedKeys.has(acceptedKey)) {
          continue;
        }
        acceptedKeys.add(acceptedKey);
        calls.push({
          toolName,
          params: validated.params,
          toolCallId: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString()
        });
      }
    }

    this._lastInvalidToolCandidates = invalidCandidates;
    if (invalidCandidates.length > 0) {
      console.warn(`[MCP] Ignored ${invalidCandidates.length} malformed/non-executable tool candidate(s)`);
    }

    return calls;
  }

  _extractJsonObject(text) {
    let candidate = String(text || '').trimStart();
    if (!candidate) {
      return { ok: false, reason: 'missing_params_json' };
    }

    if (candidate.startsWith('```')) {
      const firstNewline = candidate.indexOf('\n');
      if (firstNewline !== -1) {
        candidate = candidate.slice(firstNewline + 1).trimStart();
        const fenceEnd = candidate.indexOf('```');
        if (fenceEnd !== -1) {
          candidate = candidate.slice(0, fenceEnd).trim();
        }
      }
    }

    const jsonStart = candidate.indexOf('{');
    if (jsonStart === -1) {
      return { ok: false, reason: 'missing_json_object' };
    }
    candidate = candidate.slice(jsonStart);

    let depth = 0;
    let end = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < candidate.length; i++) {
      const char = candidate[i];
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
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
    }

    if (end === 0) {
      return { ok: false, reason: 'unclosed_json_object' };
    }

    let params;
    try {
      params = JSON.parse(candidate.slice(0, end));
    } catch (error) {
      return { ok: false, reason: 'invalid_json' };
    }

    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return { ok: false, reason: 'params_not_object' };
    }

    return { ok: true, params };
  }

  _extractLooseKeyValueObject(text) {
    let candidate = String(text || '').trimStart();
    if (!candidate) {
      return { ok: false, reason: 'missing_loose_params' };
    }

    if (candidate.startsWith('```')) {
      const firstNewline = candidate.indexOf('\n');
      if (firstNewline !== -1) {
        candidate = candidate.slice(firstNewline + 1).trimStart();
        const fenceEnd = candidate.indexOf('```');
        if (fenceEnd !== -1) {
          candidate = candidate.slice(0, fenceEnd).trim();
        }
      }
    }

    if (candidate.startsWith('{')) {
      return this._extractJsonObject(candidate);
    }

    if (candidate.startsWith('.')) {
      candidate = candidate.slice(1).trimStart();
    }

    const firstLine = candidate.split(/\r?\n/)[0].trim();
    if (!firstLine || !firstLine.startsWith('"')) {
      return { ok: false, reason: 'missing_loose_object_body' };
    }

    let body = firstLine;
    if (body.endsWith('}')) {
      body = body.slice(0, -1).trimEnd();
    }

    try {
      const params = JSON.parse(`{${body}}`);
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return { ok: false, reason: 'loose_params_not_object' };
      }
      return { ok: true, params };
    } catch (_) {
      return { ok: false, reason: 'invalid_loose_json' };
    }
  }

  _validateParsedToolCall(toolName, params) {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { ok: false, reason: 'unknown_tool' };
    }

    const normalized = JSON.parse(JSON.stringify(params || {}));
    if (tool.definition.inputSchema?.properties) {
      for (const [key, prop] of Object.entries(tool.definition.inputSchema.properties)) {
        if (normalized[key] === undefined && prop.default !== undefined) {
          normalized[key] = prop.default;
        }
      }
    }

    if (tool.definition.inputSchema) {
      try {
        this.validateInput(normalized, tool.definition.inputSchema);
      } catch (error) {
        return { ok: false, reason: `schema_validation_failed:${error.message}` };
      }
    }

    return { ok: true, params: normalized };
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

  async getToolsForContext(context = null, { includeInternal = false } = {}) {
    const tools = [];
    for (const [, tool] of this.tools) {
      const def = tool?.definition;
      if (!def) continue;
      if (def.internal === true && !includeInternal) continue;
      if (!await this._isToolAllowedByAgentScope(def, context)) continue;
      tools.push(def);
    }
    return tools;
  }

  async getActiveToolsForContext(context = null) {
    const activeTools = this.getActiveTools();
    const filtered = [];
    for (const tool of activeTools) {
      if (!await this._isToolAllowedByAgentScope(tool, context)) continue;
      filtered.push(tool);
    }
    return filtered;
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

  _normalizeToolAgentScope(definition = {}) {
    const directScope = Array.isArray(definition.agentScope)
      ? definition.agentScope
      : (typeof definition.agentScope === 'string' ? [definition.agentScope] : []);
    const manifestScope = [
      definition.agentSlug,
      ...(Array.isArray(definition.agentSlugs) ? definition.agentSlugs : [])
    ];
    const merged = [...directScope, ...manifestScope]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    if (merged.length === 0 || merged.includes('*')) {
      return null;
    }
    return Array.from(new Set(merged));
  }

  _slugifyAgentName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async _resolveAgentScopeContext(context = null) {
    const executionContext = context && typeof context === 'object' ? context : {};
    let agentId = executionContext.agentId ?? null;
    const sessionId = executionContext.sessionId ?? this.getCurrentSessionId();

    if (!agentId && sessionId !== null && sessionId !== undefined && this.db?.get) {
      const row = this.db.get('SELECT agent_id FROM chat_sessions WHERE id = ?', [sessionId]);
      if (row?.agent_id) {
        agentId = row.agent_id;
      }
    }

    if (!agentId) {
      return { agentId: null, agentSlug: null };
    }

    let agent = null;
    if (this._agentManager && typeof this._agentManager.getAgent === 'function') {
      agent = await this._agentManager.getAgent(agentId);
    } else if (this.db?.getAgent) {
      agent = await this.db.getAgent(agentId);
    }

    if (!agent) {
      return { agentId, agentSlug: null };
    }

    const agentSlug = this._agentManager && typeof this._agentManager._getSafeFolderName === 'function'
      ? this._agentManager._getSafeFolderName(agent.name)
      : this._slugifyAgentName(agent.name);

    return { agentId, agentSlug };
  }

  async _isToolAllowedByAgentScope(definition = {}, context = null) {
    const requiredScopes = Array.isArray(definition.agentScopeSlugs)
      ? definition.agentScopeSlugs
      : null;
    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const { agentSlug } = await this._resolveAgentScopeContext(context);
    if (!agentSlug) {
      return false;
    }
    return requiredScopes.includes(String(agentSlug).trim().toLowerCase());
  }
}

module.exports = MCPServer;
