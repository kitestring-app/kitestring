const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('banner', Object.freeze({
  open(action = 'open') {
    if (['open', 'continue', 'stop', 'dismiss'].includes(action)) ipcRenderer.send('desktop:banner-open', action);
  },
}));
