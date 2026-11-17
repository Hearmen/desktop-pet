const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gallery', {
  data: () => ipcRenderer.invoke('gallery:data'),
  pick: (character) => ipcRenderer.invoke('gallery:pick', { character }),
  save: (form, name, dataURL) => ipcRenderer.invoke('gallery:save', { form, name, dataURL }),
  remove: (form, name) => ipcRenderer.invoke('gallery:remove', { form, name }),
  rename: (form, from, to) => ipcRenderer.invoke('gallery:rename', { form, from, to }),
});
