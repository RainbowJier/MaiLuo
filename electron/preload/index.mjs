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
  claudeCheck: () => ipcRenderer.invoke('claude:check'),
  analyze: (p) => ipcRenderer.invoke('claude:analyze', p),
  cancelAnalyze: (sessionId) => ipcRenderer.invoke('claude:cancel', { sessionId }),

  onTermLine: (cb) => ipcRenderer.on('term:line', (_e, d) => cb(d)),
  onTermStatus: (cb) => ipcRenderer.on('term:status', (_e, d) => cb(d)),
  onAnalysisResult: (cb) => ipcRenderer.on('analysis:result', (_e, d) => cb(d))
};

contextBridge.exposeInMainWorld('api', api);
