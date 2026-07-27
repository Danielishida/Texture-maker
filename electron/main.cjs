// Electron shell for Texture Forge. Loads the built web app from dist/.
// Build the web app first (npm run build), then package with npm run package:win.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

/** Save into the user's Downloads folder, deduplicating filenames. */
function uniqueDownloadPath(filename) {
  const downloads = app.getPath('downloads');
  const base = filename.replace(/[/\\]/g, '_') || 'texture-forge-export';
  let target = path.join(downloads, base);
  let n = 1;
  while (fs.existsSync(target)) {
    const ext = path.extname(base);
    target = path.join(downloads, `${path.basename(base, ext)} (${n++})${ext}`);
  }
  return target;
}

ipcMain.handle('tf-save-file', async (_event, filename, data) => {
  const target = uniqueDownloadPath(String(filename));
  await fs.promises.writeFile(target, Buffer.from(data));
  return target;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#14151a',
    autoHideMenuBar: true,
    title: 'Texture Forge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // Any external link opens in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // Backstop for any download that still goes through Chromium's manager.
  win.webContents.session.on('will-download', (_event, item) => {
    item.setSavePath(uniqueDownloadPath(item.getFilename()));
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
