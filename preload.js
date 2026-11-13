const { contextBridge, ipcRenderer } = require('electron');

const INBOUND = ['config', 'state', 'event', 'demo'];

contextBridge.exposeInMainWorld('pet', {
  ignore: (v) => ipcRenderer.send('pet:ignore', !!v),
  press: () => ipcRenderer.send('pet:press'),
  release: () => ipcRenderer.send('pet:release'),
  menu: () => ipcRenderer.send('pet:menu'),
  talking: (v) => ipcRenderer.send('pet:talking', !!v),
  ready: () => ipcRenderer.send('pet:ready'),
  on: (channel, fn) => {
    if (!INBOUND.includes(channel)) return;
    ipcRenderer.on('pet:' + channel, (_e, data) => fn(data));
  },
});
