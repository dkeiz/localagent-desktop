const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('./database');
const AIService = require('./ai-service');
const MCPServer = require('./mcp-server');
const ollamaService = require('./ollama-service');

let mainWindow;
let db;
let aiService;
let mcpServer;

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
    
    // Create MCP server first, then pass it to AI service
    mcpServer = new MCPServer(db);
    aiService = new AIService(db, mcpServer);
    mcpServer.setAIService(aiService);
    await mcpServer.loadCustomTools();
    
    createWindow();
    
    // Setup IPC handlers
    require('./ipc-handlers')(ipcMain, db, aiService, mcpServer, mainWindow, ollamaService);

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
  // Cleanup resources
  if (mcpServer) {
    await mcpServer.stop();
  }
  if (db) {
    await db.close();
  }
});
