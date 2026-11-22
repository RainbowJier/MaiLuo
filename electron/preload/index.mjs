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
  claudeModels: (root) => ipcRenderer.invoke('claude:models', { root }),
  analyze: (p) => ipcRenderer.invoke('claude:analyze', p),
  cancelAnalyze: (sessionId) => ipcRenderer.invoke('claude:cancel', { sessionId }),

  claudeWorkspaceLoad: () => ipcRenderer.invoke('claude-workspace:load'),
  claudeWorkspaceCreate: (data) => ipcRenderer.invoke('claude-workspace:create', data),
  claudeWorkspaceSend: (data) => ipcRenderer.invoke('claude-workspace:send', data),
  claudeWorkspaceAnalyze: (data) => ipcRenderer.invoke('claude-workspace:analyze', data),
  claudeWorkspaceStop: (data) => ipcRenderer.invoke('claude-workspace:stop', data),
  claudeWorkspaceRespond: (data) => ipcRenderer.invoke('claude-workspace:respond', data),
  onClaudeWorkspaceEvent: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('claude-workspace:event', listener);
    return () => ipcRenderer.removeListener('claude-workspace:event', listener);
  },

  onTermLine: (cb) => ipcRenderer.on('term:line', (_e, d) => cb(d)),
  onTermStatus: (cb) => ipcRenderer.on('term:status', (_e, d) => cb(d)),
  onAnalysisResult: (cb) => ipcRenderer.on('analysis:result', (_e, d) => cb(d))
};

contextBridge.exposeInMainWorld('api', api);
