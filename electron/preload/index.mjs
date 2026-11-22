import { contextBridge, ipcRenderer } from 'electron';

const api = {
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  detectProjects: (root) => ipcRenderer.invoke('project:detect', root),
  scanVue: (root, frontend) => ipcRenderer.invoke('project:scanVue', root, frontend),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  loadSessions: () => ipcRenderer.invoke('sessions:load'),
  saveSessions: (data) => ipcRenderer.invoke('sessions:save', data),
  loadLayouts: () => ipcRenderer.invoke('layouts:load'),
  saveLayouts: (data) => ipcRenderer.invoke('layouts:save', data),
  loadGroups: () => ipcRenderer.invoke('groups:load'),
  saveGroups: (data) => ipcRenderer.invoke('groups:save', data),
  claudeCheck: () => ipcRenderer.invoke('claude:check'),

  /* 原生 Claude Code 终端（PTY 宿主在主进程） */
  terminalStart: (p) => ipcRenderer.invoke('terminal:start', p),
  terminalWrite: (data) => ipcRenderer.invoke('terminal:write', { data }),
  terminalResize: (cols, rows) => ipcRenderer.invoke('terminal:resize', { cols, rows }),
  terminalStop: () => ipcRenderer.invoke('terminal:stop'),
  terminalAnalyze: (p) => ipcRenderer.invoke('terminal:analyze', p),
  onTerminalEvent: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('terminal:event', listener);
    return () => ipcRenderer.removeListener('terminal:event', listener);
  }
};

contextBridge.exposeInMainWorld('api', api);
