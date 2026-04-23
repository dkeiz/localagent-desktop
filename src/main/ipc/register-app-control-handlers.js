const { app, BrowserWindow } = require('electron');

function resolveOwnerWindow(event) {
  try {
    return BrowserWindow.fromWebContents(event.sender) || null;
  } catch (_) {
    return null;
  }
}

function registerAppControlHandlers(ipcMain) {
  ipcMain.handle('app:refresh-window', async (event) => {
    const ownerWindow = resolveOwnerWindow(event);
    if (!ownerWindow?.webContents?.reloadIgnoringCache) {
      return { success: false, error: 'No active window to refresh' };
    }

    setTimeout(() => {
      try {
        ownerWindow.webContents.reloadIgnoringCache();
      } catch (error) {
        console.error('[IPC] app:refresh-window reload failed:', error);
      }
    }, 25);

    return { success: true };
  });

  ipcMain.handle('app:restart', async () => {
    setTimeout(() => {
      try {
        app.relaunch();
        app.quit();
      } catch (error) {
        console.error('[IPC] app:restart relaunch failed:', error);
      }
    }, 25);

    return { success: true };
  });
}

module.exports = { registerAppControlHandlers };
