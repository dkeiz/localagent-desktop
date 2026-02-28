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
  // Workflows
  getWorkflows: () => ipcRenderer.invoke('get-workflows'),
  saveWorkflow: (workflow) => ipcRenderer.invoke('save-workflow', workflow),
  runWorkflow: (workflowId) => ipcRenderer.invoke('run-workflow', workflowId),
  deleteWorkflow: (workflowId) => ipcRenderer.invoke('delete-workflow', workflowId),
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
    getModels: (provider) => ipcRenderer.invoke('llm:get-models', provider),
    saveConfig: (config) => ipcRenderer.invoke('llm:save-config', config),
    getConfig: () => ipcRenderer.invoke('llm:get-config'),
    fetchQwenOAuth: () => ipcRenderer.invoke('llm:fetch-qwen-oauth'),
    testModel: (provider, model) => ipcRenderer.invoke('llm:test-model', { provider, model }),
    setThinkingMode: (mode) => ipcRenderer.invoke('llm:set-thinking-mode', mode),
    getThinkingMode: () => ipcRenderer.invoke('llm:get-thinking-mode'),
    setShowThinking: (show) => ipcRenderer.invoke('llm:set-show-thinking', show)
  },
  // Workflow API
  getWorkflows: () => ipcRenderer.invoke('get-workflows'),
  executeWorkflow: (workflowId, paramOverrides) => ipcRenderer.invoke('execute-workflow', workflowId, paramOverrides),
  captureWorkflow: (trigger, toolChain, name) => ipcRenderer.invoke('capture-workflow', trigger, toolChain, name),
  searchWorkflows: (query, topK) => ipcRenderer.invoke('search-workflows', query, topK),
  deleteWorkflow: (workflowId) => ipcRenderer.invoke('delete-workflow', workflowId),
  interpretToolResult: (toolName, params, result) => ipcRenderer.invoke('interpret-tool-result', toolName, params, result),
  // Generation control
  stopGeneration: () => ipcRenderer.invoke('stop-generation'),
  isGenerating: () => ipcRenderer.invoke('is-generating'),
  onConversationUpdate: (callback) => ipcRenderer.on('conversation-update', callback),
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
  }
});
