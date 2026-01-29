const { ipcRenderer } = require('electron');

// Expose both direct access and convenience wrappers
window.electronAPI = Object.assign(ipcRenderer, {
  // Convenience wrappers
  sendMessage: (msg) => ipcRenderer.invoke('send-message', msg),
  getConversations: (limit, sessionId) => ipcRenderer.invoke('get-conversations', limit, sessionId),
  clearConversations: () => ipcRenderer.invoke('clear-conversations'),
  getSystemPrompt: () => ipcRenderer.invoke('get-system-prompt'),
  setSystemPrompt: (prompt) => ipcRenderer.invoke('set-system-prompt', prompt),
  getSetting: (key) => ipcRenderer.invoke('get-context-setting'),
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
  getChatSessions: (date, limit) => ipcRenderer.invoke('get-chat-sessions', date, limit),
  loadChatSession: (sessionId) => ipcRenderer.invoke('load-chat-session', sessionId),
  switchChatSession: (sessionId) => ipcRenderer.invoke('switch-chat-session', sessionId),
  deleteChatSession: (sessionId) => ipcRenderer.invoke('delete-chat-session', sessionId),
  getSettings: () => ipcRenderer.invoke('get-settings'),
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
    fetchQwenOAuth: () => ipcRenderer.invoke('llm:fetch-qwen-oauth')
  },
  onConversationUpdate: (callback) => ipcRenderer.on('conversation-update', callback),
  onToolUpdate: (callback) => ipcRenderer.on('tool-update', callback),
  onToolPermissionRequest: (callback) => ipcRenderer.on('tool-permission-request', callback)
});
