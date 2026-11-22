import { reactive } from 'vue';

const record = () => Object.create(null);
const busyStatuses = new Set(['starting', 'running', 'permission']);
const restartMessage = 'Claude Code 接口尚未加载，请完全退出并重新启动 MaiLuo。';
const storageKey = 'mailuo.claude-session-drafts.v1';
const modelKey = 'mailuo.claude-model.v1';
export const CW = reactive({
  ready: false, loading: false, error: '', storageError: '', unavailable: false, model: '',
  models: [], sessions: [], draftsById: record(), permissionsBySession: record(),
  operationsById: record(), bindingErrors: record()
});
let bridge, initialization, unsubscribe, epoch = 0, clock = 0, saveTimer;
let modelsKey = '', modelsTask = null;
const snapshots = new Map(), permissionClocks = new Map(), bindings = new Map(), draftVersions = new Map();
const text = value => typeof value === 'string' ? value : '';
const errorText = (error, fallback) => text(error?.message) || text(error) || fallback;
export function claudeRootKey(value) {
  const raw = text(value).trim().replace(/\\/g, '/');
  const clean = raw.replace(/\/+$/, '') || (raw.startsWith('/') ? '/' : '');
  const key = /^[a-z]:$/i.test(clean) ? `${clean}/` : clean;
  return /^[a-z]:(?:\/|$)/i.test(raw) || raw.startsWith('//') ? key.toLowerCase() : key;
}
function operation(id) {
  return CW.operationsById[id] ||= { sending: false, stopping: false, error: '' };
}
function mergeSnapshot(raw, baseline, fromEvent = false) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.root !== 'string') return;
  const previous = CW.sessions.find(s => s.id === raw.id);
  if (previous && (claudeRootKey(previous.root) !== claudeRootKey(raw.root) ||
      (!fromEvent && (snapshots.get(raw.id) || 0) > baseline) ||
      (raw.revision || 0) < (previous.revision || 0))) return;
  const next = { ...raw, messages: (raw.messages || []).filter(m =>
    ['user', 'assistant', 'tool', 'system'].includes(m.role) && m.type !== 'thinking' && m.type !== 'redacted_thinking') };
  const index = CW.sessions.findIndex(s => s.id === next.id);
  if (index < 0) CW.sessions.push(next); else CW.sessions[index] = next;
  if (fromEvent) snapshots.set(next.id, baseline);
  if (!busyStatuses.has(next.status)) {
    operation(next.id).stopping = false;
    for (const [id, request] of Object.entries(CW.permissionsBySession[next.id] || {})) {
      if (request.receivedAt <= baseline) {
        permissionClocks.set(`${next.id}:${id}`, baseline);
        delete CW.permissionsBySession[next.id][id];
      }
    }
  }
}
function mergePermission(sessionId, request, baseline) {
  if (!request?.requestId) return;
  const key = `${sessionId}:${request.requestId}`;
  if ((permissionClocks.get(key) || 0) > baseline) return;
  permissionClocks.set(key, baseline);
  const requests = CW.permissionsBySession[sessionId] ||= record();
  const previous = requests[request.requestId];
  requests[request.requestId] = { ...request, receivedAt: baseline,
    submitting: previous?.submitting || false, error: previous?.error || '' };
}
function handleEvent(event) {
  if (event?.kind === 'storage-error') { CW.storageError = event.error; return; }
  if (!event || typeof event.sessionId !== 'string') return;
  const baseline = ++clock;
  if (event.kind === 'session' && event.session?.id === event.sessionId) mergeSnapshot(event.session, baseline, true);
  if (event.kind === 'permission') mergePermission(event.sessionId, event.request, baseline);
  if (event.kind === 'permission-resolved') {
    permissionClocks.set(`${event.sessionId}:${event.requestId}`, baseline);
    delete CW.permissionsBySession[event.sessionId]?.[event.requestId];
  }
}
function saveDrafts() {
  clearTimeout(saveTimer);
  try { window.localStorage.setItem(storageKey, JSON.stringify(CW.draftsById)); } catch {}
}
/** 模型随轮次下发（--model），空值跟随 CLI 默认；下一轮生效。 */
export function setClaudeModel(value) {
  const next = text(value).trim().slice(0, 100);
  if (/[\s"']/.test(next)) return;
  CW.model = next;
  try { window.localStorage.setItem(modelKey, next); } catch {}
}
/** 可选模型来自本机 Claude Code 的 modelPicker.options，不内置任何默认模型。 */
export function loadClaudeModels(root = '', force = false) {
  if (typeof bridge?.claudeModels !== 'function') return Promise.resolve(CW.models);
  const key = claudeRootKey(root);
  if (!force && modelsTask && modelsKey === key) return modelsTask;
  modelsKey = key;
  modelsTask = (async () => {
    try {
      const result = await bridge.claudeModels(key || undefined);
      if (Array.isArray(result?.models))
        CW.models = result.models.filter(m => m && typeof m.model === 'string' && !/[\s"']/.test(m.model));
    } catch { /* 清单读取失败不阻塞对话 */ }
    return CW.models;
  })();
  return modelsTask;
}
export function initClaudeWorkspace() {
  if (initialization) return initialization;
  const currentEpoch = ++epoch;
  bridge = window.api;
  if (!['claudeWorkspaceLoad', 'claudeWorkspaceCreate', 'claudeWorkspaceSend', 'claudeWorkspaceAnalyze',
    'claudeWorkspaceStop', 'claudeWorkspaceRespond', 'onClaudeWorkspaceEvent'].every(name => typeof bridge?.[name] === 'function')) {
    CW.unavailable = true; CW.error = restartMessage;
    return initialization = Promise.resolve(false);
  }
  CW.loading = true; CW.error = ''; CW.unavailable = false;
  try {
    const drafts = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
    for (const [id, draft] of Object.entries(drafts)) if (typeof draft === 'string') CW.draftsById[id] = draft;
    const savedModel = window.localStorage.getItem(modelKey);
    if (typeof savedModel === 'string' && !/[\s"']/.test(savedModel)) CW.model = savedModel.slice(0, 100);
  } catch {}
  window.addEventListener('beforeunload', disposeClaudeWorkspace);
  initialization = (async () => {
    try {
      const baseline = clock;
      unsubscribe = bridge.onClaudeWorkspaceEvent(event => { if (epoch === currentEpoch) handleEvent(event); });
      const data = await bridge.claudeWorkspaceLoad();
      if (epoch !== currentEpoch) return false;
      if (data?.version !== 1 || !Array.isArray(data.sessions)) throw new Error(data?.error || '无法读取会话记录');
      for (const s of data.sessions) mergeSnapshot(s, baseline);
      for (const pending of data.pendingRequests || []) {
        if (busyStatuses.has(CW.sessions.find(s => s.id === pending.sessionId)?.status))
          mergePermission(pending.sessionId, pending.request, baseline);
      }
      CW.ready = true;
      return true;
    } catch (error) {
      CW.error = errorText(error, '无法连接 Claude Code');
      try { unsubscribe?.(); } catch {}
      unsubscribe = undefined;
      return false;
    } finally { if (epoch === currentEpoch) CW.loading = false; }
  })();
  return initialization;
}
export function disposeClaudeWorkspace() {
  ++epoch;
  unsubscribe?.(); unsubscribe = undefined; initialization = undefined; bridge = undefined;
  modelsTask = null; modelsKey = '';
  CW.ready = false; CW.loading = false; CW.permissionsBySession = record();
  permissionClocks.clear();
  window.removeEventListener('beforeunload', disposeClaudeWorkspace);
  saveDrafts();
}
export function retryClaudeWorkspace() { disposeClaudeWorkspace(); return initClaudeWorkspace(); }

// The existing analysis tab is the only conversation identity. Never select by "latest in project".
export function claudeForAnalysis(analysisSession) {
  if (!analysisSession?.claudeKey) return null;
  const root = analysisSession.projectRoot || analysisSession.root;
  const chat = (analysisSession.claudeId && CW.sessions.find(s => s.id === analysisSession.claudeId && s.analysisKey === analysisSession.claudeKey)) ||
    CW.sessions.find(s => s.analysisKey === analysisSession.claudeKey &&
      claudeRootKey(s.root) === claudeRootKey(root)) || null;
  if (chat && claudeRootKey(chat.root) === claudeRootKey(root)) {
    analysisSession.claudeId = chat.id;
    analysisSession.claudeMessages = chat.messages || [];
    analysisSession.claudeStatus = chat.status || 'idle';
    analysisSession.claudeModel = chat.model || '';
    analysisSession.claudeError = chat.error || '';
  }
  return chat;
}
export async function ensureClaudeForAnalysis(analysisSession) {
  const root = analysisSession?.projectRoot || analysisSession?.root;
  if (!analysisSession?.claudeKey || !root) return null;
  const key = `${claudeRootKey(root)}:${analysisSession.claudeKey}`;
  if (bindings.has(key)) return bindings.get(key);
  const task = (async () => {
    try {
      if (!await initClaudeWorkspace()) throw new Error(CW.error);
      if (analysisSession.claudeId) {
        const existing = CW.sessions.find(s => s.id === analysisSession.claudeId && s.analysisKey === analysisSession.claudeKey);
        if (existing && claudeRootKey(existing.root) === claudeRootKey(root)) return claudeForAnalysis(analysisSession);
      }
      const existing = claudeForAnalysis(analysisSession);
      if (existing) return existing;
      const baseline = clock;
      const projectRoot = analysisSession.projectRoot || analysisSession.root;
      const response = await bridge.claudeWorkspaceCreate({ root: projectRoot,
        analysisKey: analysisSession.claudeKey, name: analysisSession.name });
      if (!response?.ok) throw new Error(response?.error || '无法连接当前会话');
      if (response.session?.analysisKey !== analysisSession.claudeKey ||
          claudeRootKey(response.session.root) !== claudeRootKey(projectRoot)) throw new Error('会话绑定不匹配');
      mergeSnapshot(response.session, baseline);
      CW.bindingErrors[analysisSession.claudeKey] = '';
      return claudeForAnalysis(analysisSession);
    } catch (error) {
      CW.bindingErrors[analysisSession.claudeKey] = errorText(error, '无法连接当前会话');
      return null;
    } finally { bindings.delete(key); }
  })();
  bindings.set(key, task);
  return task;
}
export function setClaudeDraft(id, value) {
  CW.draftsById[id] = text(value);
  draftVersions.set(id, (draftVersions.get(id) || 0) + 1);
  clearTimeout(saveTimer); saveTimer = setTimeout(saveDrafts, 250);
}
export const claudePermissions = id => Object.values(CW.permissionsBySession[id] || {});
export function claudeStatus(id) {
  return claudePermissions(id).length ? 'permission' : CW.sessions.find(s => s.id === id)?.status || 'idle';
}
export const isClaudeBusy = id => busyStatuses.has(claudeStatus(id)) || !!CW.operationsById[id]?.sending;
async function invoke(method, payload) {
  try {
    if (!CW.ready) throw new Error(CW.error || restartMessage);
    const response = await bridge[method](payload);
    return response?.ok ? response : { ok: false, error: response?.error || 'Claude Code 操作失败' };
  } catch (error) { return { ok: false, error: errorText(error, 'Claude Code 操作失败') }; }
}
export async function sendClaudeMessage({ id, text: message, contextFile }) {
  if (!message?.trim() || isClaudeBusy(id)) return { ok: false };
  const op = operation(id), version = draftVersions.get(id) || 0;
  op.sending = true; op.error = '';
  const result = await invoke('claudeWorkspaceSend', { id, text: message, contextFile, ...(CW.model ? { model: CW.model } : {}) });
  op.sending = false;
  if (!result.ok) op.error = result.error;
  else if ((draftVersions.get(id) || 0) === version && CW.draftsById[id] === message) setClaudeDraft(id, '');
  return result;
}
export async function analyzeClaudeSession(analysisSession) {
  const chat = await ensureClaudeForAnalysis(analysisSession);
  if (!chat) return { ok: false, error: CW.bindingErrors[analysisSession.claudeKey] || CW.error };
  if (isClaudeBusy(chat.id)) return { ok: false, error: '当前会话正在运行，请先等待或停止本次操作' };
  analysisSession.claudeId = chat.id;
  analysisSession.claudeMessages = chat.messages || [];
  analysisSession.claudeStatus = 'starting';
  analysisSession.claudeError = '';
  const result = await invoke('claudeWorkspaceAnalyze', { id: chat.id, analysisSessionId: analysisSession.id,
    entryRel: analysisSession.file, backendRel: analysisSession.backend || '', ...(CW.model ? { model: CW.model } : {}) });
  if (!result.ok) { analysisSession.claudeStatus = 'error'; analysisSession.claudeError = result.error || ''; }
  return result;
}
export async function stopClaudeSession(id) {
  const op = operation(id);
  if (op.stopping) return { ok: false };
  op.stopping = true; op.error = '';
  const result = await invoke('claudeWorkspaceStop', { id });
  if (!result.ok) { op.stopping = false; op.error = result.error; }
  return result;
}
export async function respondClaudePermission({ id, requestId, allow, answers }) {
  const request = CW.permissionsBySession[id]?.[requestId];
  if (!request || request.submitting) return { ok: false };
  request.submitting = true; request.error = '';
  const result = await invoke('claudeWorkspaceRespond', { id, requestId, allow: allow === true,
    ...(answers ? { answers: JSON.parse(JSON.stringify(answers)) } : {}) });
  if (result.ok) { permissionClocks.set(`${id}:${requestId}`, ++clock); delete CW.permissionsBySession[id]?.[requestId]; }
  else { request.submitting = false; request.error = result.error; }
  return result;
}
if (import.meta.hot) import.meta.hot.dispose(disposeClaudeWorkspace);
