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
const ollamaService = require('./ollama-service');

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

    // Create Capability Manager for tool permissions
    capabilityManager = new CapabilityManager(db);

    // Create MCP server first, then pass it to AI service
    mcpServer = new MCPServer(db, capabilityManager);
    aiService = new AIService(db, mcpServer);
    mcpServer.setAIService(aiService);
    await mcpServer.loadCustomTools();

    // Create chain controller for multi-tool execution
    chainController = new ToolChainController(aiService, mcpServer, db);

    // Create workflow manager for learning tool chains
    workflowManager = new WorkflowManager(db, mcpServer);

    // Create embedding service and vector store for semantic search
    embeddingService = new EmbeddingService();
    vectorStore = new VectorStore(db, embeddingService);

    // Create Port Listener Manager for external triggers
    portListenerManager = new PortListenerManager(aiService);

    // Create Agent Memory manager
    agentMemory = new AgentMemory();

    // Create Prompt File Manager for file-based prompts/rules
    promptFileManager = new PromptFileManager(db);
    await promptFileManager.initialize();
    // Load system prompt from file into ai-service
    const systemPrompt = await promptFileManager.loadSystemPrompt();
    await aiService.setSystemPrompt(systemPrompt);

    // Create Agent Loop for autonomous behaviors
    agentLoop = new AgentLoop(aiService, agentMemory, db);
    mcpServer.setAgentLoop(agentLoop);

    // Create Connector Runtime for dynamic external service connectors
    connectorRuntime = new ConnectorRuntime(aiService, db);
    mcpServer.setConnectorRuntime(connectorRuntime);

    createWindow();

    // Setup IPC handlers (pass all services)
    require('./ipc-handlers')(ipcMain, db, aiService, mcpServer, mainWindow, ollamaService, chainController, workflowManager, vectorStore, capabilityManager, portListenerManager, agentMemory, promptFileManager, agentLoop, connectorRuntime);

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
  // Save all agent loop sessions on quit
  if (agentLoop) {
    await agentLoop.onAppQuit();
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
