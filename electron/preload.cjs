// Sandboxed preload: exposes a minimal, typed save bridge to the web app.
// The app feature-detects window.textureForgeDesktop and falls back to
// browser <a download> behavior when absent.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('textureForgeDesktop', {
  saveFile: (filename, data) => ipcRenderer.invoke('tf-save-file', filename, data),
});
