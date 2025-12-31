const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  getCalendarEvents: () => ipcRenderer.invoke('get-calendar-events'),
  addCalendarEvent: (event) => ipcRenderer.invoke('add-calendar-event', event),
  updateCalendarEvent: (id, event) => ipcRenderer.invoke('update-calendar-event', id, event),
  deleteCalendarEvent: (id) => ipcRenderer.invoke('delete-calendar-event', id),
  
  getTodos: () => ipcRenderer.invoke('get-todos'),
  addTodo: (todo) => ipcRenderer.invoke('add-todo', todo),
  updateTodo: (id, todo) => ipcRenderer.invoke('update-todo', id, todo),
  deleteTodo: (id) => ipcRenderer.invoke('delete-todo', id),
  
  getConversations: () => ipcRenderer.invoke('get-conversations'),
  addConversation: (message) => ipcRenderer.invoke('add-conversation', message),
  clearConversations: () => ipcRenderer.invoke('clear-conversations'),
  
  // AI operations
  sendMessage: (message) => ipcRenderer.invoke('send-message', message),
  getAIProviders: () => ipcRenderer.invoke('get-ai-providers'),
  setAIProvider: (provider) => ipcRenderer.invoke('set-ai-provider', provider),
  setSystemPrompt: (prompt) => ipcRenderer.invoke('set-system-prompt', prompt),
  getSystemPrompt: () => ipcRenderer.invoke('get-system-prompt'),
  
  // MCP operations
  getMCPTools: () => ipcRenderer.invoke('get-mcp-tools'),
  getMCPToolsDocumentation: () => ipcRenderer.invoke('get-mcp-tools-documentation'),
  executeMCPTool: (toolName, params) => ipcRenderer.invoke('execute-mcp-tool', toolName, params),
  executeMCPToolOnce: (toolName, params) => ipcRenderer.invoke('execute-mcp-tool-once', toolName, params),
  executeTool: (toolName, params) => ipcRenderer.invoke('execute-tool', toolName, params),

  // Tool activation operations
  getToolStates: () => ipcRenderer.invoke('get-tool-states'),
  setToolActive: (toolName, active) => ipcRenderer.invoke('set-tool-active', toolName, active),
  
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  setAPIKey: (provider, key) => ipcRenderer.invoke('set-api-key', provider, key),
  setActiveModel: (provider, model) => ipcRenderer.invoke('setActiveModel', provider, model),
  getSetting: () => ipcRenderer.invoke('get-context-setting'),
  setContextSetting: (value) => ipcRenderer.invoke('set-context-setting', value),
  
  // Prompt Rules
  getPromptRules: () => ipcRenderer.invoke('get-prompt-rules'),
  getActivePromptRules: () => ipcRenderer.invoke('get-active-prompt-rules'),
  addPromptRule: (rule) => ipcRenderer.invoke('add-prompt-rule', rule),
  updatePromptRule: (id, rule) => ipcRenderer.invoke('update-prompt-rule', id, rule),
  togglePromptRule: (id, active) => ipcRenderer.invoke('toggle-prompt-rule', id, active),
  deletePromptRule: (id) => ipcRenderer.invoke('delete-prompt-rule', id),
  
  // Chat Sessions
  createChatSession: () => ipcRenderer.invoke('create-chat-session'),
  getChatSessions: (date, limit) => ipcRenderer.invoke('get-chat-sessions', date, limit),
  loadChatSession: (sessionId) => ipcRenderer.invoke('load-chat-session', sessionId),
  switchChatSession: (sessionId) => ipcRenderer.invoke('switch-chat-session', sessionId),
  deleteChatSession: (sessionId) => ipcRenderer.invoke('delete-chat-session', sessionId),
  
  // File handling
  handleFileDrop: (filePath) => ipcRenderer.invoke('handle-file-drop', filePath),
  
  // Provider operations
  getProviders: () => ipcRenderer.invoke('get-providers'),
  
  // LLM operations
  getModels: (provider) => ipcRenderer.invoke('llm:get-models', provider),
  llm: {
    getModels: (provider) => ipcRenderer.invoke('llm:get-models', provider),
    saveConfig: (config) => ipcRenderer.invoke('llm:save-config', config),
    getConfig: () => ipcRenderer.invoke('llm:get-config'),
    fetchQwenOAuth: () => ipcRenderer.invoke('llm:fetch-qwen-oauth')
  },
  
  // Event listeners
  onConversationUpdate: (callback) => ipcRenderer.on('conversation-update', callback),
  onCalendarUpdate: (callback) => ipcRenderer.on('calendar-update', callback),
  onTodoUpdate: (callback) => ipcRenderer.on('todo-update', callback),
  onToolUpdate: (callback) => ipcRenderer.on('tool-update', callback),
  onToolPermissionRequest: (callback) => ipcRenderer.on('tool-permission-request', callback),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // File system
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath)
});
