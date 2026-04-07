const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('./database');
const AIService = require('./ai-service');
const MCPServer = require('./mcp-server');
const ToolChainController = require('./tool-chain-controller');
const WorkflowManager = require('./workflow-manager');
const EmbeddingService = require('./embedding-service');
const VectorStore = require('./vector-store');
const CapabilityManager = require('./capability-manager');
const PortListenerManager = require('./port-listener-manager');
const AgentMemory = require('./agent-memory');
const PromptFileManager = require('./prompt-file-manager');
const AgentLoop = require('./agent-loop');
const ConnectorRuntime = require('./connector-runtime');
const InferenceDispatcher = require('./inference-dispatcher');
const SessionWorkspace = require('./session-workspace');
const AgentManager = require('./agent-manager');
const ollamaService = require('./ollama-service');
const BackendEventBus = require('./backend-event-bus');
const BackgroundMemoryDaemon = require('./background-memory-daemon');
const BackgroundWorkflowScheduler = require('./background-workflow-scheduler');
const SessionInitManager = require('./session-init-manager');
const ServiceContainer = require('./service-container');
const PluginManager = require('./plugin-manager');
const KnowledgeManager = require('./knowledge-manager');
const { runCheckSkins } = require('../../tools/check-skins');
const { runApplySimulation } = require('../../tools/test-skin-apply');

let mainWindow;
const container = new ServiceContainer();

const args = process.argv.slice(1);
const isTestMode = args.includes('--test');
const isNoWindowMode = args.includes('--nowindow');

if (!app || typeof app.whenReady !== 'function') {
  if (isTestMode && isNoWindowMode) {
    console.log('[HeadlessTest] Running in Node fallback mode...');
    const started = Date.now();
    const skinCheck = runCheckSkins();
    const skinApplySimulation = runApplySimulation();
    const durationMs = Date.now() - started;
    const report = {
      mode: 'test-nowindow-node-fallback',
      durationMs,
      checks: {
        skins: skinCheck,
        skinApplySimulation
      }
    };
    console.log('[HeadlessTest] Report:');
    console.log(JSON.stringify(report, null, 2));
    process.exit(skinCheck.ok && skinApplySimulation.ok ? 0 : 1);
  } else {
    throw new Error('Electron app context is unavailable. Run this entrypoint with Electron for normal app mode.');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    titleBarStyle: 'default',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    if (isTestMode && isNoWindowMode) {
      console.log('[HeadlessTest] Starting --test --nowindow checks...');
      const started = Date.now();
      const skinCheck = runCheckSkins();
      const skinApplySimulation = runApplySimulation();
      const durationMs = Date.now() - started;
      const report = {
        mode: 'test-nowindow',
        durationMs,
        checks: {
          skins: skinCheck,
          skinApplySimulation
        }
      };
      console.log('[HeadlessTest] Report:');
      console.log(JSON.stringify(report, null, 2));
      app.exit(skinCheck.ok && skinApplySimulation.ok ? 0 : 1);
      return;
    }

    // Initialize services
    const db = new Database();
    await db.init();
    container.register('db', db);

    // Create Event Bus (foundation for background architecture)
    const eventBus = new BackendEventBus();
    container.register('eventBus', eventBus);

    // Create Capability Manager for tool permissions
    const capabilityManager = new CapabilityManager(db);
    container.register('capabilityManager', capabilityManager);

    // Create MCP server first, then pass it to AI service
    const mcpServer = new MCPServer(db, capabilityManager);
    const aiService = new AIService(db, mcpServer);
    mcpServer.setAIService(aiService);
    await mcpServer.loadCustomTools();
    container.register('mcpServer', mcpServer);
    container.register('aiService', aiService);

    // Create central inference dispatcher
    const dispatcher = new InferenceDispatcher(aiService, db, mcpServer);
    container.register('dispatcher', dispatcher);

    // Create chain controller for multi-tool execution (uses dispatcher)
    const chainController = new ToolChainController(dispatcher, mcpServer, db);
    container.register('chainController', chainController);

    // Create workflow manager for learning tool chains
    const workflowManager = new WorkflowManager(db, mcpServer);
    chainController.setWorkflowManager(workflowManager);
    mcpServer.setWorkflowManager(workflowManager);
    container.register('workflowManager', workflowManager);

    // Create embedding service and vector store for semantic search
    const embeddingService = new EmbeddingService();
    const vectorStore = new VectorStore(db, embeddingService);
    container.register('embeddingService', embeddingService);
    container.register('vectorStore', vectorStore);

    // Create Port Listener Manager for external triggers (uses dispatcher)
    const portListenerManager = new PortListenerManager(dispatcher);
    container.register('portListenerManager', portListenerManager);

    // Create Agent Memory manager
    const agentMemory = new AgentMemory();
    container.register('agentMemory', agentMemory);

    // Create Session Workspace for per-session temp folders
    const sessionWorkspace = new SessionWorkspace();
    sessionWorkspace.cleanupStale(30); // Purge workspaces older than 30 days
    container.register('sessionWorkspace', sessionWorkspace);

    // Create Prompt File Manager for file-based prompts/rules
    const promptFileManager = new PromptFileManager(db);
    await promptFileManager.initialize();
    // Load system prompt from file into ai-service
    const systemPrompt = await promptFileManager.loadSystemPrompt();
    await aiService.setSystemPrompt(systemPrompt);
    container.register('promptFileManager', promptFileManager);

    // Create Agent Loop for autonomous behaviors (uses dispatcher)
    const agentLoop = new AgentLoop(dispatcher, agentMemory, db, sessionWorkspace);
    mcpServer.setAgentLoop(agentLoop);
    mcpServer.setSessionWorkspace(sessionWorkspace);
    container.register('agentLoop', agentLoop);

    // Create Connector Runtime for dynamic external service connectors (uses dispatcher)
    const connectorRuntime = new ConnectorRuntime(dispatcher, db);
    mcpServer.setConnectorRuntime(connectorRuntime);
    container.register('connectorRuntime', connectorRuntime);

    // Create Agent Manager for multi-agent system
    const agentManager = new AgentManager(db, dispatcher, agentLoop, agentMemory);
    await agentManager.initialize();
    dispatcher.setAgentManager(agentManager);
    container.register('agentManager', agentManager);

    // Create Session Init Manager
    const sessionInitManager = new SessionInitManager(db, agentMemory, eventBus);
    container.register('sessionInitManager', sessionInitManager);

    // Create Background Memory Daemon (escalating tick schedule)
    const memoryDaemon = new BackgroundMemoryDaemon(dispatcher, agentMemory, db, eventBus);
    container.register('memoryDaemon', memoryDaemon);

    // Create Background Workflow Scheduler (15-min fixed tick)
    const workflowScheduler = new BackgroundWorkflowScheduler(workflowManager, db, eventBus);
    container.register('workflowScheduler', workflowScheduler);
    container.register('ollamaService', ollamaService);

    createWindow();

    // Update mainWindow reference now that it exists
    container.register('mainWindow', mainWindow);

    // Setup IPC handlers (pass container instead of 22 params)
    require('./ipc-handlers')(ipcMain, container);

    // Late-bind EventBus dependencies (needs mainWindow)
    eventBus.init({ mainWindow, dispatcher, db });

    // Initialize Knowledge System (before plugins, so plugins can write knowledge)
    const knowledgeManager = new KnowledgeManager(db);
    container.register('knowledgeManager', knowledgeManager);
    await knowledgeManager.initialize();

    // Register explore_knowledge tool in MCPServer
    mcpServer.registerTool('explore_knowledge', {
      name: 'explore_knowledge',
      description: 'Get the knowledge file tree. Returns all knowledge items with metadata (titles, categories, tags, file paths, line counts). Use read_file to access specific knowledge content after exploring.',
      userDescription: 'Explore the personal knowledge store',
      inputSchema: { type: 'object' }
    }, async () => {
      return await knowledgeManager.getKnowledgeTree();
    });

    // Initialize Plugin System (after all core services are wired)
    const pluginManager = new PluginManager(container);
    container.register('pluginManager', pluginManager);
    await pluginManager.initialize();

    // Auto-start background daemons if baseinit was completed
    const baseinitDone = await db.getSetting('baseinit.completed');
    const daemonEnabled = await db.getSetting('baseinit.daemonEnabled');
    const shouldAutoStartDaemons =
      daemonEnabled === 'true' || (baseinitDone === 'true' && daemonEnabled !== 'false');
    if (shouldAutoStartDaemons) {
      memoryDaemon.start().catch(e => console.error('[Main] Memory daemon start failed:', e));
      workflowScheduler.start().catch(e => console.error('[Main] Workflow scheduler start failed:', e));
    }

    // CLI: --seed <script.js> — run a seed script with live DB after init
    const seedIdx = process.argv.indexOf('--seed');
    if (seedIdx !== -1 && process.argv[seedIdx + 1]) {
      const seedPath = require('path').resolve(process.argv[seedIdx + 1]);
      console.log(`[Seed] Running seed script: ${seedPath}`);
      try {
        const seedFn = require(seedPath);
        if (typeof seedFn === 'function') {
          await seedFn({ db, workflowManager, mcpServer });
          console.log('[Seed] Seed script completed successfully');
        } else {
          console.error('[Seed] Seed script must export a function: module.exports = async ({ db, workflowManager }) => { ... }');
        }
      } catch (err) {
        console.error('[Seed] Seed script failed:', err);
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error('Error during app initialization:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  const pluginManager = container.optional('pluginManager');
  const memoryDaemon = container.optional('memoryDaemon');
  const workflowScheduler = container.optional('workflowScheduler');
  const agentLoop = container.optional('agentLoop');
  const agentManager = container.optional('agentManager');
  const connectorRuntime = container.optional('connectorRuntime');
  const portListenerManager = container.optional('portListenerManager');
  const mcpServer = container.optional('mcpServer');
  const db = container.optional('db');

  // Disable all plugins
  if (pluginManager) await pluginManager.disableAll();
  // Stop background daemons
  if (memoryDaemon) memoryDaemon.stop();
  if (workflowScheduler) workflowScheduler.stop();
  // Save all agent loop sessions on quit
  if (agentLoop) await agentLoop.onAppQuit();
  // Deactivate all agents
  if (agentManager) await agentManager.onAppQuit();
  // Stop all connectors
  if (connectorRuntime) await connectorRuntime.stopAll();
  // Cleanup resources
  if (portListenerManager) await portListenerManager.stopAll();
  if (mcpServer) await mcpServer.stop();
  if (db) await db.close();
});
