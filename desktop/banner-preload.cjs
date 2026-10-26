const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('banner', Object.freeze({
  open() { ipcRenderer.send('desktop:banner-open'); },
}));
