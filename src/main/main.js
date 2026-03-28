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

let mainWindow;
let db;
let aiService;
let mcpServer;
let chainController;
let workflowManager;
let embeddingService;
let vectorStore;
let capabilityManager;
let portListenerManager;
let agentMemory;
let promptFileManager;
let agentLoop;
let connectorRuntime;
let dispatcher;
let sessionWorkspace;
let agentManager;
let eventBus;
let memoryDaemon;
let workflowScheduler;
let sessionInitManager;

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
    // Initialize services
    db = new Database();
    await db.init();

    // Create Event Bus (foundation for background architecture)
    eventBus = new BackendEventBus();

    // Create Capability Manager for tool permissions
    capabilityManager = new CapabilityManager(db);

    // Create MCP server first, then pass it to AI service
    mcpServer = new MCPServer(db, capabilityManager);
    aiService = new AIService(db, mcpServer);
    mcpServer.setAIService(aiService);
    await mcpServer.loadCustomTools();

    // Create central inference dispatcher
    dispatcher = new InferenceDispatcher(aiService, db, mcpServer);

    // Create chain controller for multi-tool execution (uses dispatcher)
    chainController = new ToolChainController(dispatcher, mcpServer, db);

    // Create workflow manager for learning tool chains
    workflowManager = new WorkflowManager(db, mcpServer);
    chainController.setWorkflowManager(workflowManager);
    mcpServer.setWorkflowManager(workflowManager);

    // Create embedding service and vector store for semantic search
    embeddingService = new EmbeddingService();
    vectorStore = new VectorStore(db, embeddingService);

    // Create Port Listener Manager for external triggers (uses dispatcher)
    portListenerManager = new PortListenerManager(dispatcher);

    // Create Agent Memory manager
    agentMemory = new AgentMemory();

    // Create Session Workspace for per-session temp folders
    sessionWorkspace = new SessionWorkspace();
    sessionWorkspace.cleanupStale(30); // Purge workspaces older than 30 days

    // Create Prompt File Manager for file-based prompts/rules
    promptFileManager = new PromptFileManager(db);
    await promptFileManager.initialize();
    // Load system prompt from file into ai-service
    const systemPrompt = await promptFileManager.loadSystemPrompt();
    await aiService.setSystemPrompt(systemPrompt);

    // Create Agent Loop for autonomous behaviors (uses dispatcher)
    agentLoop = new AgentLoop(dispatcher, agentMemory, db, sessionWorkspace);
    mcpServer.setAgentLoop(agentLoop);
    mcpServer.setSessionWorkspace(sessionWorkspace);

    // Create Connector Runtime for dynamic external service connectors (uses dispatcher)
    connectorRuntime = new ConnectorRuntime(dispatcher, db);
    mcpServer.setConnectorRuntime(connectorRuntime);

    // Create Agent Manager for multi-agent system
    agentManager = new AgentManager(db, dispatcher, agentLoop, agentMemory);
    await agentManager.initialize();
    dispatcher.setAgentManager(agentManager);

    // Create Session Init Manager
    sessionInitManager = new SessionInitManager(db, agentMemory, eventBus);

    // Create Background Memory Daemon (escalating tick schedule)
    memoryDaemon = new BackgroundMemoryDaemon(dispatcher, agentMemory, db, eventBus);

    // Create Background Workflow Scheduler (15-min fixed tick)
    workflowScheduler = new BackgroundWorkflowScheduler(workflowManager, db, eventBus);

    createWindow();

    // Setup IPC handlers (pass all services)
    require('./ipc-handlers')(ipcMain, db, aiService, mcpServer, mainWindow, ollamaService, chainController, workflowManager, vectorStore, capabilityManager, portListenerManager, agentMemory, promptFileManager, agentLoop, connectorRuntime, dispatcher, agentManager, eventBus, memoryDaemon, workflowScheduler, sessionInitManager);

    // Late-bind EventBus dependencies (needs mainWindow)
    eventBus.init({ mainWindow, dispatcher, db });

    // Auto-start background daemons if baseinit was completed
    const baseinitDone = await db.getSetting('baseinit.completed');
    const daemonEnabled = await db.getSetting('baseinit.daemonEnabled');
    if (baseinitDone === 'true' || daemonEnabled === 'true') {
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
  // Stop background daemons
  if (memoryDaemon) {
    memoryDaemon.stop();
  }
  if (workflowScheduler) {
    workflowScheduler.stop();
  }
  // Save all agent loop sessions on quit
  if (agentLoop) {
    await agentLoop.onAppQuit();
  }
  // Deactivate all agents
  if (agentManager) {
    await agentManager.onAppQuit();
  }
  // Stop all connectors
  if (connectorRuntime) {
    await connectorRuntime.stopAll();
  }
  // Cleanup resources
  if (portListenerManager) {
    await portListenerManager.stopAll();
  }
  if (mcpServer) {
    await mcpServer.stop();
  }
  if (db) {
    await db.close();
  }
});
