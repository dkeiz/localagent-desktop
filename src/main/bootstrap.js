const Database = require('./database');
const AIService = require('./ai-service');
const MCPServer = require('./mcp-server');
const ToolChainController = require('./tool-chain-controller');
const WorkflowManager = require('./workflow-manager');
const WorkflowRuntime = require('./workflow-runtime');
const EmbeddingService = require('./embedding-service');
const VectorStore = require('./vector-store');
const CapabilityManager = require('./capability-manager');
const ToolPermissionStore = require('./tool-permission-store');
const ToolPermissionService = require('./tool-permission-service');
const PortListenerManager = require('./port-listener-manager');
const AgentMemory = require('./agent-memory');
const PromptFileManager = require('./prompt-file-manager');
const AgentLoop = require('./agent-loop');
const ConnectorRuntime = require('./connector-runtime');
const InferenceDispatcher = require('./inference-dispatcher');
const SessionWorkspace = require('./session-workspace');
const AgentManager = require('./agent-manager');
const SubtaskRuntime = require('./subtask-runtime');
const ollamaService = require('./ollama-service');
const BackendEventBus = require('./backend-event-bus');
const BackgroundMemoryDaemon = require('./background-memory-daemon');
const BackgroundWorkflowScheduler = require('./background-workflow-scheduler');
const SessionInitManager = require('./session-init-manager');
const ServiceContainer = require('./service-container');
const PluginManager = require('./plugin-manager');
const KnowledgeManager = require('./knowledge-manager');
const ResearchRuntime = require('./research-runtime');
const TaskQueueService = require('./task-queue-service');
const setupIpcHandlers = require('./ipc-handlers');
const { WindowManager } = require('./window-manager');
const { buildRuntimePaths } = require('./runtime-paths');

function resolveWindowManager(paths, options = {}) {
  if (options.windowManager) {
    return options.windowManager;
  }

  return new WindowManager({
    BrowserWindow: options.BrowserWindow || null,
    rendererPath: paths.rendererPath,
    createWindow: options.createWindow || null
  });
}

async function bootstrapApplication(options = {}) {
  const container = options.container || new ServiceContainer();
  const args = options.args || process.argv.slice(1);
  const isTestClientMode = options.isTestClientMode === true || args.includes('--testclient');
  const isExternalTestMode = args.includes('--external-test');
  const isTestMode = args.includes('--test');
  const isNoWindowMode = args.includes('--nowindow') || args.includes('--windowless') || args.includes('-windowless');
  const ipcMain = options.ipcMain || null;
  const autoStartDaemons = options.autoStartDaemons !== false;
  const createInitialWindow = options.createInitialWindow !== false;
  const paths = buildRuntimePaths(options);
  const windowManager = resolveWindowManager(paths, options);

  container.register('runtimePaths', paths);
  container.register('windowManager', windowManager);

  const db = new Database({ dbPath: options.dbPath, app: options.app });
  await db.init();
  container.register('db', db);
  container.register('testClientMode', isTestClientMode);
  const testClientStore = options.testClientStore || { sessions: new Map(), currentSessionId: null };
  container.register('testClientStore', testClientStore);

  const eventBus = new BackendEventBus({
    notifyPromptPath: paths.backgroundNotifyPromptPath
  });
  container.register('eventBus', eventBus);

  const capabilityManager = new CapabilityManager(db);
  container.register('capabilityManager', capabilityManager);

  const mcpServer = new MCPServer(db, capabilityManager);
  const aiService = new AIService(db, mcpServer);
  await aiService.initialize();
  mcpServer.setAIService(aiService);
  await mcpServer.loadCustomTools();
  container.register('mcpServer', mcpServer);
  container.register('aiService', aiService);

  const dispatcher = new InferenceDispatcher(aiService, db, mcpServer);
  container.register('dispatcher', dispatcher);

  const chainController = new ToolChainController(dispatcher, mcpServer, db);
  container.register('chainController', chainController);

  const workflowManager = new WorkflowManager(db, mcpServer);
  const workflowRuntime = new WorkflowRuntime(workflowManager, eventBus);
  workflowRuntime.initialize();
  workflowManager.setWorkflowRuntime(workflowRuntime);
  chainController.setWorkflowManager(workflowManager);
  mcpServer.setWorkflowManager(workflowManager);
  container.register('workflowManager', workflowManager);
  container.register('workflowRuntime', workflowRuntime);

  const embeddingService = new EmbeddingService();
  const vectorStore = new VectorStore(db, embeddingService);
  container.register('embeddingService', embeddingService);
  container.register('vectorStore', vectorStore);

  const portListenerManager = new PortListenerManager(dispatcher);
  container.register('portListenerManager', portListenerManager);

  const agentMemory = new AgentMemory(paths.memoryBasePath);
  container.register('agentMemory', agentMemory);

  const taskQueueService = new TaskQueueService({
    db,
    tasksFilePath: paths.tasksQueueFile,
    onQueueUpdated(payload) {
      windowManager.send('task-queue-update', payload || {});
    }
  });
  await taskQueueService.initialize();
  container.register('taskQueueService', taskQueueService);

  const sessionWorkspace = new SessionWorkspace(paths.sessionWorkspaceBase);
  sessionWorkspace.cleanupStale(30);
  container.register('sessionWorkspace', sessionWorkspace);

  const persistConversationMessage = async (message, sessionId = null) => {
    const isTestSession = typeof sessionId === 'string' && sessionId.startsWith('testclient-');
    if (isTestClientMode && isTestSession) {
      if (!testClientStore.sessions.has(sessionId)) {
        testClientStore.sessions.set(sessionId, {
          id: sessionId,
          title: 'Test Client',
          created_at: new Date().toISOString(),
          messages: []
        });
      }
      const session = testClientStore.sessions.get(sessionId);
      session.messages.push({
        role: message.role,
        content: message.content,
        metadata: message.metadata || null,
        timestamp: new Date().toISOString()
      });
      testClientStore.currentSessionId = sessionId;
      return message;
    }

    return db.addConversation(message, sessionId);
  };
  const subtaskRuntime = new SubtaskRuntime(db, sessionWorkspace, eventBus, null, {
    persistConversationMessage,
    notifyConversationUpdate(sessionId) {
      if (sessionId === null || sessionId === undefined) {
        return windowManager.send('conversation-update');
      }
      return windowManager.send('conversation-update', { sessionId });
    }
  });
  container.register('subtaskRuntime', subtaskRuntime);

  const promptFileManager = new PromptFileManager(db, paths.promptBasePath);
  await promptFileManager.initialize();
  const systemPrompt = await promptFileManager.loadSystemPrompt();
  await aiService.setSystemPrompt(systemPrompt);
  mcpServer.setPromptFileManager(promptFileManager);
  container.register('promptFileManager', promptFileManager);

  const agentLoop = new AgentLoop(dispatcher, agentMemory, db, sessionWorkspace, {
    templateBasePath: paths.promptTemplatesDir,
    userProfilePath: paths.userProfilePath,
    taskQueueService
  });
  mcpServer.setAgentLoop(agentLoop);
  mcpServer.setSessionWorkspace(sessionWorkspace);
  container.register('agentLoop', agentLoop);

  const connectorRuntime = new ConnectorRuntime(dispatcher, db, {
    connectorsDir: paths.connectorsDir
  });
  mcpServer.setConnectorRuntime(connectorRuntime);
  container.register('connectorRuntime', connectorRuntime);

  const agentManager = new AgentManager(
    db,
    dispatcher,
    agentLoop,
    agentMemory,
    sessionWorkspace,
    chainController,
    eventBus,
    subtaskRuntime,
    { basePath: paths.agentBasePath }
  );
  await agentManager.initialize();
  dispatcher.setAgentManager(agentManager);
  mcpServer.setAgentManager(agentManager);
  container.register('agentManager', agentManager);

  const toolPermissionStore = new ToolPermissionStore(db);
  const toolPermissionService = new ToolPermissionService({
    db,
    capabilityManager,
    mcpServer,
    agentManager,
    store: toolPermissionStore
  });
  await toolPermissionService.initialize();
  mcpServer.setToolPermissionService(toolPermissionService);
  agentManager.setToolPermissionService(toolPermissionService);
  container.register('toolPermissionStore', toolPermissionStore);
  container.register('toolPermissionService', toolPermissionService);

  const sessionInitManager = new SessionInitManager(db, agentMemory, eventBus, {
    agentinPath: paths.agentinRoot,
    templatePath: paths.coldStartTemplatePath,
    connectorsDir: paths.connectorsDir,
    userProfilePath: paths.userProfilePath,
    memoryBasePath: paths.memoryBasePath
  });
  container.register('sessionInitManager', sessionInitManager);

  const memoryDaemon = new BackgroundMemoryDaemon(dispatcher, agentMemory, db, eventBus, {
    basePath: paths.backgroundDaemonBasePath,
    userProfilePath: paths.userProfilePath,
    taskQueueService
  });
  container.register('memoryDaemon', memoryDaemon);

  const workflowScheduler = new BackgroundWorkflowScheduler(workflowManager, db, eventBus);
  container.register('workflowScheduler', workflowScheduler);
  container.register('ollamaService', ollamaService);

  const knowledgeManager = new KnowledgeManager(db, { baseDir: paths.knowledgeBaseDir });
  container.register('knowledgeManager', knowledgeManager);
  await knowledgeManager.initialize();
  mcpServer.setKnowledgeManager(knowledgeManager);

  const researchRuntime = new ResearchRuntime(workflowManager, knowledgeManager, eventBus);
  researchRuntime.initialize();
  mcpServer.setResearchRuntime(researchRuntime);
  container.register('researchRuntime', researchRuntime);

  mcpServer.registerTool('explore_knowledge', {
    name: 'explore_knowledge',
    description: 'Get the knowledge file tree. Returns all knowledge items with metadata (titles, categories, tags, file paths, line counts). Use read_file to access specific knowledge content after exploring.',
    userDescription: 'Explore the personal knowledge store',
    inputSchema: { type: 'object' }
  }, async () => knowledgeManager.getKnowledgeTree());
  capabilityManager.registerCustomTool('explore_knowledge', true);

  const pluginManager = new PluginManager(container, { pluginsDir: paths.pluginsDir });
  container.register('pluginManager', pluginManager);
  await pluginManager.initialize();
  agentManager.setPluginManager(pluginManager);

  if (ipcMain) {
    setupIpcHandlers(ipcMain, container);
  }

  eventBus.init({ windowManager, dispatcher, db });

  if (createInitialWindow) {
    windowManager.createMainWindow();
  }

  if (autoStartDaemons) {
    const isAnyTestMode = isTestClientMode || isExternalTestMode || isTestMode || isNoWindowMode;
    if (!isAnyTestMode) {
      memoryDaemon.start().catch(e => console.error('[Bootstrap] Memory daemon start failed:', e));
      workflowScheduler.start().catch(e => console.error('[Bootstrap] Workflow scheduler start failed:', e));
    }
  }

  return {
    container,
    windowManager,
    handleActivate() {
      if (!windowManager.hasMainWindow()) {
        return windowManager.createMainWindow();
      }
      return windowManager.getMainWindow();
    },
    async shutdown() {
      const pluginMgr = container.optional('pluginManager');
      const memorySvc = container.optional('memoryDaemon');
      const workflowSvc = container.optional('workflowScheduler');
      const loopSvc = container.optional('agentLoop');
      const managerSvc = container.optional('agentManager');
      const connectorSvc = container.optional('connectorRuntime');
      const portSvc = container.optional('portListenerManager');
      const promptSvc = container.optional('promptFileManager');
      const mcpSvc = container.optional('mcpServer');
      const dbSvc = container.optional('db');

      // Unload plugin runtime cleanly without changing persisted enabled state.
      if (pluginMgr) await pluginMgr.disableAll({ persistStatus: false });
      if (memorySvc) memorySvc.stop();
      if (workflowSvc) workflowSvc.stop();
      if (loopSvc) await loopSvc.onAppQuit();
      if (managerSvc) await managerSvc.onAppQuit();
      if (connectorSvc) await connectorSvc.stopAll();
      if (portSvc) await portSvc.stopAll();
      if (promptSvc) promptSvc.stopWatching();
      if (mcpSvc) await mcpSvc.stop();
      if (dbSvc) await dbSvc.close();
    }
  };
}

module.exports = {
  bootstrapApplication
};
