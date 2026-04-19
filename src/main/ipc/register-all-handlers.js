const { registerLlmHandlers } = require('./register-llm-handlers');
const { registerChatDataHandlers } = require('./register-chat-data-handlers');
const { registerToolsCapabilityHandlers } = require('./register-tools-capability-handlers');
const { registerWorkflowHandlers } = require('./register-workflow-handlers');
const { registerAgentSystemHandlers } = require('./register-agent-system-handlers');
const { registerPluginKnowledgeHandlers } = require('./register-plugin-knowledge-handlers');
const { registerTtsHandlers } = require('./register-tts-handlers');
const { createStaticWindowManager } = require('../window-manager');

function buildRuntime(container) {
  const windowManager = container.optional('windowManager')
    || createStaticWindowManager(container.optional('mainWindow'));

  return {
    container,
    db: container.get('db'),
    aiService: container.get('aiService'),
    mcpServer: container.get('mcpServer'),
    windowManager,
    ollamaService: container.optional('ollamaService'),
    chainController: container.get('chainController'),
    workflowManager: container.get('workflowManager'),
    vectorStore: container.get('vectorStore'),
    capabilityManager: container.get('capabilityManager'),
    portListenerManager: container.get('portListenerManager'),
    agentMemory: container.get('agentMemory'),
    promptFileManager: container.get('promptFileManager'),
    agentLoop: container.get('agentLoop'),
    connectorRuntime: container.get('connectorRuntime'),
    dispatcher: container.get('dispatcher'),
    agentManager: container.get('agentManager'),
    pluginManager: container.optional('pluginManager'),
    eventBus: container.get('eventBus'),
    memoryDaemon: container.get('memoryDaemon'),
    workflowScheduler: container.get('workflowScheduler'),
    sessionInitManager: container.get('sessionInitManager'),
    testClientMode: container.optional('testClientMode') === true,
    testClientStore: container.optional('testClientStore') || { sessions: new Map(), currentSessionId: null },
    userIdleDebounceMs: container.optional('userIdleDebounceMs')
  };
}

function registerAllHandlers(ipcMain, container) {
  const runtime = buildRuntime(container);
  const { db, eventBus, memoryDaemon, workflowScheduler } = runtime;

  const configuredDebounceMs = Number(runtime.userIdleDebounceMs);
  const USER_IDLE_DEBOUNCE_MS = Number.isFinite(configuredDebounceMs) && configuredDebounceMs >= 0
    ? configuredDebounceMs
    : 20 * 1000;
  let activeUserRequests = 0;
  let userIdleTimer = null;

  function markUserActive(sessionId = null) {
    if (!eventBus) return;

    if (userIdleTimer) {
      clearTimeout(userIdleTimer);
      userIdleTimer = null;
    }

    activeUserRequests += 1;
    if (activeUserRequests === 1) {
      eventBus.publish('chat:user-active', { sessionId });
    }
  }

  function markUserIdle(sessionId = null) {
    if (!eventBus) return;

    activeUserRequests = Math.max(0, activeUserRequests - 1);
    if (activeUserRequests > 0) return;

    if (userIdleTimer) {
      clearTimeout(userIdleTimer);
    }

    userIdleTimer = setTimeout(() => {
      if (activeUserRequests === 0) {
        eventBus.publish('chat:user-idle', { sessionId });
      }
    }, USER_IDLE_DEBOUNCE_MS);
    if (typeof userIdleTimer.unref === 'function') {
      userIdleTimer.unref();
    }
  }

  async function syncDaemonEnabledSetting() {
    const enabled = Boolean((memoryDaemon && memoryDaemon.running) || (workflowScheduler && workflowScheduler.running));
    await db.saveSetting('baseinit.daemonEnabled', enabled ? 'true' : 'false');
  }

  registerLlmHandlers(ipcMain, runtime);
  registerChatDataHandlers(ipcMain, runtime, { markUserActive, markUserIdle });
  registerToolsCapabilityHandlers(ipcMain, runtime);
  registerWorkflowHandlers(ipcMain, runtime);
  registerAgentSystemHandlers(ipcMain, runtime, { syncDaemonEnabledSetting });
  registerPluginKnowledgeHandlers(ipcMain, runtime);
  registerTtsHandlers(ipcMain, runtime);
}

module.exports = { registerAllHandlers };
