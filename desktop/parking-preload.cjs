const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('parking', Object.freeze({
  save: text => typeof text === 'string' && text.length <= 500 ? ipcRenderer.invoke('desktop:park-save', text) : Promise.resolve(false),
  close: () => ipcRenderer.send('desktop:park-close'),
}));
