const { ipcRenderer } = require('electron');

// Expose both direct access and convenience wrappers
window.electronAPI = Object.assign(ipcRenderer, {
  // Convenience wrappers
  sendMessage: (msg, sessionId) => ipcRenderer.invoke('send-message', msg, true, sessionId),
  getConversations: (limit, sessionId) => ipcRenderer.invoke('get-conversations', limit, sessionId),
  clearConversations: () => ipcRenderer.invoke('clear-conversations'),
  getSystemPrompt: () => ipcRenderer.invoke('get-system-prompt'),
  setSystemPrompt: (prompt) => ipcRenderer.invoke('set-system-prompt', prompt),
  getSetting: (key) => ipcRenderer.invoke('get-context-setting'),
  getSettingValue: (key) => ipcRenderer.invoke('get-setting-value', key),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
  setContextSetting: (value) => ipcRenderer.invoke('set-context-setting', value),
  getProviders: () => ipcRenderer.invoke('get-providers'),
  handleFileDrop: (filePath) => ipcRenderer.invoke('handle-file-drop', filePath),
  getMCPTools: () => ipcRenderer.invoke('get-mcp-tools'),
  getMCPToolsDocumentation: () => ipcRenderer.invoke('get-mcp-tools-documentation'),
  executeMCPTool: (toolName, params) => ipcRenderer.invoke('execute-mcp-tool', toolName, params),
  executeMCPToolOnce: (toolName, params) => ipcRenderer.invoke('execute-mcp-tool-once', toolName, params),
  getToolStates: () => ipcRenderer.invoke('get-tool-states'),
  setToolActive: (toolName, active) => ipcRenderer.invoke('set-tool-active', toolName, active),
  createCustomTool: (toolData) => ipcRenderer.invoke('create-custom-tool', toolData),
  getCustomTools: () => ipcRenderer.invoke('get-custom-tools'),
  deleteCustomTool: (toolName) => ipcRenderer.invoke('delete-custom-tool', toolName),
  // Tool Groups
  getToolGroups: () => ipcRenderer.invoke('get-tool-groups'),
  activateToolGroup: (groupId) => ipcRenderer.invoke('activate-tool-group', groupId),
  deactivateToolGroup: (groupId) => ipcRenderer.invoke('deactivate-tool-group', groupId),
  getActiveTools: () => ipcRenderer.invoke('get-active-tools'),
  getCalendarEvents: () => ipcRenderer.invoke('get-calendar-events'),
  addCalendarEvent: (calendarEvent) => ipcRenderer.invoke('add-calendar-event', calendarEvent),
  updateCalendarEvent: (id, calendarEvent) => ipcRenderer.invoke('update-calendar-event', id, calendarEvent),
  deleteCalendarEvent: (id) => ipcRenderer.invoke('delete-calendar-event', id),
  getTodos: () => ipcRenderer.invoke('get-todos'),
  addTodo: (todo) => ipcRenderer.invoke('add-todo', todo),
  updateTodo: (id, todo) => ipcRenderer.invoke('update-todo', id, todo),
  deleteTodo: (id) => ipcRenderer.invoke('delete-todo', id),

  getChatSessions: (date, limit) => ipcRenderer.invoke('get-chat-sessions', date, limit),
  loadChatSession: (sessionId) => ipcRenderer.invoke('load-chat-session', sessionId),
  switchChatSession: (sessionId) => ipcRenderer.invoke('switch-chat-session', sessionId),
  deleteChatSession: (sessionId) => ipcRenderer.invoke('delete-chat-session', sessionId),
  deleteAllConversations: () => ipcRenderer.invoke('delete-all-conversations'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
  verifyQwenKey: (apiKey) => ipcRenderer.invoke('verify-qwen-key', apiKey),
  getPromptRules: () => ipcRenderer.invoke('get-prompt-rules'),
  addPromptRule: (rule) => ipcRenderer.invoke('add-prompt-rule', rule),
  updatePromptRule: (id, rule) => ipcRenderer.invoke('update-prompt-rule', id, rule),
  togglePromptRule: (id, active) => ipcRenderer.invoke('toggle-prompt-rule', id, active),
  deletePromptRule: (id) => ipcRenderer.invoke('delete-prompt-rule', id),
  llm: {
    getModels: (provider, forceRefresh = false) => ipcRenderer.invoke('llm:get-models', provider, forceRefresh),
    saveConfig: (config) => ipcRenderer.invoke('llm:save-config', config),
    getConfig: () => ipcRenderer.invoke('llm:get-config'),
    getProviderProfiles: () => ipcRenderer.invoke('llm:get-provider-profiles'),
    getModelProfile: (provider, model) => ipcRenderer.invoke('llm:get-model-profile', provider, model),
    fetchQwenOAuth: () => ipcRenderer.invoke('llm:fetch-qwen-oauth'),
    testModel: (provider, model) => ipcRenderer.invoke('llm:test-model', { provider, model }),
    setThinkingMode: (mode) => ipcRenderer.invoke('llm:set-thinking-mode', mode),
    getThinkingMode: () => ipcRenderer.invoke('llm:get-thinking-mode'),
    setShowThinking: (show) => ipcRenderer.invoke('llm:set-show-thinking', show)
  },
  // Workflow API
  getWorkflows: () => ipcRenderer.invoke('get-workflows'),
  saveWorkflow: (workflow) => ipcRenderer.invoke('save-workflow', workflow),
  runWorkflow: (workflowId) => ipcRenderer.invoke('run-workflow', workflowId),
  executeWorkflow: (workflowId, paramOverrides) => ipcRenderer.invoke('execute-workflow', workflowId, paramOverrides),
  captureWorkflow: (trigger, toolChain, name) => ipcRenderer.invoke('capture-workflow', trigger, toolChain, name),
  searchWorkflows: (query) => ipcRenderer.invoke('search-workflows', query),
  deleteWorkflow: (workflowId) => ipcRenderer.invoke('delete-workflow', workflowId),
  copyWorkflow: (workflowId, newName) => ipcRenderer.invoke('copy-workflow', workflowId, newName),
  updateWorkflow: (workflowId, data) => ipcRenderer.invoke('update-workflow', workflowId, data),
  interpretToolResult: (toolName, params, result) => ipcRenderer.invoke('interpret-tool-result', toolName, params, result),
  // Generation control
  stopGeneration: () => ipcRenderer.invoke('stop-generation'),
  isGenerating: () => ipcRenderer.invoke('is-generating'),
  onConversationUpdate: (callback) => ipcRenderer.on('conversation-update', callback),
  onCalendarUpdate: (callback) => ipcRenderer.on('calendar-update', callback),
  onTodoUpdate: (callback) => ipcRenderer.on('todo-update', callback),
  onToolUpdate: (callback) => ipcRenderer.on('tool-update', callback),
  onToolPermissionRequest: (callback) => ipcRenderer.on('tool-permission-request', callback),
  onCapabilityUpdate: (callback) => ipcRenderer.on('capability-update', callback),
  // Capability Management API
  capability: {
    getState: () => ipcRenderer.invoke('capability:get-state'),
    getGroups: () => ipcRenderer.invoke('capability:get-groups'),
    setMain: (enabled) => ipcRenderer.invoke('capability:set-main', enabled),
    setGroup: (groupId, enabled) => ipcRenderer.invoke('capability:set-group', groupId, enabled),
    setFilesMode: (mode) => ipcRenderer.invoke('capability:set-files-mode', mode),
    getActiveTools: () => ipcRenderer.invoke('capability:get-active-tools'),
    addPortListener: (listener) => ipcRenderer.invoke('capability:add-port-listener', listener),
    removePortListener: (port) => ipcRenderer.invoke('capability:remove-port-listener', port),
    getPortListeners: () => ipcRenderer.invoke('capability:get-port-listeners'),
    setCustomToolSafe: (toolName, isSafe) => ipcRenderer.invoke('capability:set-custom-tool-safe', toolName, isSafe)
  },
  // Port Listener API
  portListener: {
    register: (config) => ipcRenderer.invoke('port-listener:register', config),
    unregister: (port) => ipcRenderer.invoke('port-listener:unregister', port),
    list: () => ipcRenderer.invoke('port-listener:list')
  },
  onPortListenerUpdate: (callback) => ipcRenderer.on('port-listener-update', callback),
  // Agent Memory API
  agentMemory: {
    append: (type, content, filename) => ipcRenderer.invoke('agent-memory:append', type, content, filename),
    read: (type, filename) => ipcRenderer.invoke('agent-memory:read', type, filename),
    list: (type) => ipcRenderer.invoke('agent-memory:list', type),
    stats: () => ipcRenderer.invoke('agent-memory:stats'),
    saveImage: (imageBuffer, name) => ipcRenderer.invoke('agent-memory:save-image', imageBuffer, name)
  },
  // Agent Management API
  agents: {
    list: (type) => ipcRenderer.invoke('get-agents', type),
    get: (id) => ipcRenderer.invoke('get-agent', id),
    create: (data) => ipcRenderer.invoke('create-agent', data),
    update: (id, data) => ipcRenderer.invoke('update-agent', id, data),
    delete: (id) => ipcRenderer.invoke('delete-agent', id),
    activate: (id) => ipcRenderer.invoke('activate-agent', id),
    deactivate: (id) => ipcRenderer.invoke('deactivate-agent', id),
    compact: (id) => ipcRenderer.invoke('compact-agent', id),
  },
  onAgentUpdate: (callback) => ipcRenderer.on('agent-update', callback),

  // Background Daemon API
  daemon: {
    memoryStart: () => ipcRenderer.invoke('daemon:memory-start'),
    memoryStop: () => ipcRenderer.invoke('daemon:memory-stop'),
    memoryStatus: () => ipcRenderer.invoke('daemon:memory-status'),
    workflowStart: () => ipcRenderer.invoke('daemon:workflow-start'),
    workflowStop: () => ipcRenderer.invoke('daemon:workflow-stop'),
    workflowStatus: () => ipcRenderer.invoke('daemon:workflow-status'),
    addSchedule: (workflowId, intervalMinutes, name) => ipcRenderer.invoke('daemon:add-schedule', workflowId, intervalMinutes, name),
    removeSchedule: (scheduleId) => ipcRenderer.invoke('daemon:remove-schedule', scheduleId),
    toggleSchedule: (scheduleId, enabled) => ipcRenderer.invoke('daemon:toggle-schedule', scheduleId, enabled),
    getSchedules: () => ipcRenderer.invoke('daemon:get-schedules'),
  },

  // Session Init API
  sessionInit: {
    detect: () => ipcRenderer.invoke('session-init:detect'),
    getColdStartPrompt: (hoursInactive) => ipcRenderer.invoke('session-init:cold-start-prompt', hoursInactive),
  },

  // BaseInit API
  baseinit: {
    check: () => ipcRenderer.invoke('baseinit:check'),
    run: () => ipcRenderer.invoke('baseinit:run'),
  },

  // EventBus API
  eventBus: {
    getLog: (category, limit) => ipcRenderer.invoke('eventbus:get-log', category, limit),
  },
  onBackgroundEvent: (callback) => ipcRenderer.on('background-event', callback),
  onBackgroundNotification: (callback) => ipcRenderer.on('background-notification', callback),
});
