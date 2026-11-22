import { reactive, computed } from 'vue';
import { seq } from './chain.js';
import { CW, analyzeClaudeSession, claudeForAnalysis, ensureClaudeForAnalysis, initClaudeWorkspace, isClaudeBusy, stopClaudeSession } from './claude-store.js';

const api = window.api;

/** 响应式 Proxy 不能过 IPC（structured clone 会抛 "An object could not be cloned"），统一转纯对象 */
const plain = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

export const S = reactive({
  ready: false,
  claudeOk: false,
  claudeVersion: '',
  config: { root: '', frontend: '', backend: '' },
  configOpen: false,
  files: [],                // [{rel, dir, name}]
  fileApiCount: {},         // rel -> n（分析完成后回写角标）
  selectedFile: null,       // rel（相对前端目录）
  sessions: [],             // {id,name,file,analyzed,status,term:[{cls,text}],data}
  activeId: null,
  sessionSeq: 0,
  analyzing: false,
  currentFn: 'all',
  terminalOpen: false,
  termHeight: '240px',
  layouts: {},              // "file|fn" -> {nodeName:{x,y}}
  groups: {},               // projectRoot -> [{id,name,files:[rel],children:[Group]}]
  layoutDirty: false,
  layoutHasSaved: false,
  toast: ''
});

export const activeSession = () => S.sessions.find(s => s.id === S.activeId);
export const currentData = () => activeSession()?.analyzed ? activeSession().data : null;
export const currentFunctions = () => currentData()?.functions || [];
export const displayPath = (rel) => rel ? `${S.config.frontend ? S.config.frontend + '/' : ''}${rel}` : '';
export const fileName = (rel) => rel?.split('/').pop() || '';

export const stats = computed(() => {
  const fns = currentFunctions();
  if (S.currentFn === 'all') {
    return {
      fn: fns.length,
      logic: fns.reduce((a, f) => a + (f.logic?.length || 0), 0),
      cls: new Set(fns.flatMap(f => (f.logic || []).map(l => (l.where || '').split('.')[0]).filter(Boolean))).size
    };
  }
  const f = fns.find(x => x.id === S.currentFn);
  if (!f) return { fn: 0, logic: 0, cls: 0 };
  return {
    fn: 1,
    logic: f.logic?.length || 0,
    cls: new Set((f.logic || []).map(l => (l.where || '').split('.')[0]).filter(Boolean)).size
  };
});

/* ---------------- term 行样式 ---------------- */
export function clsOf(line) {
  if (line.startsWith('$')) return 'cmd';
  if (line.startsWith('✓')) return 'ok';
  if (line.startsWith('[stderr]') || line.startsWith('✗')) return 'err';
  if (line.startsWith('┌') || line.startsWith('└')) return 'dim';
  if (line.startsWith('▸') || line.startsWith('⚙')) return 'info';
  return 'info';
}
function pushTerm(s, line) {
  if (!line) return;
  for (const l of String(line).split('\n')) {
    if (!l.trim()) continue;
    s.term.push({ cls: clsOf(l), text: l });
  }
  if (s.term.length > 800) s.term.splice(0, s.term.length - 800);
}

/* ---------------- 初始化 ---------------- */
export async function initApp() {
  const [cfg, ses, layouts, groups, ck] = await Promise.all([
    api.getConfig(), api.loadSessions(), api.loadLayouts(), api.loadGroups(), api.claudeCheck()
  ]);
  S.claudeOk = !!ck.ok;
  S.claudeVersion = ck.version || '';
  S.config = { ...S.config, ...cfg };
  S.layouts = layouts || {};
  S.groups = groups || {};
  if (ses?.sessions?.length) {
    S.sessions = ses.sessions.map(s => ({
      ...s, term: s.term || [], projectRoot: s.projectRoot || S.config.root,
      claudeKey: s.claudeKey || `analysis-${s.id}`,
      ...(s.claudeId ? {} : { claudeId: null }),
      claudeStatus: s.claudeStatus || 'idle', claudeError: s.claudeError || '',
      claudeMessages: [], claudePermissions: []
    }));
    S.sessionSeq = Math.max(0, ...S.sessions.map(s => s.id));
    S.activeId = ses.activeId ?? S.sessions[0].id;
    const a = activeSession();
    if (a?.file) S.selectedFile = toFrontendRel(a.file);
  }
  wireEvents();
  await refreshFiles();
  if (S.selectedFile && !S.files.find(f => f.rel === S.selectedFile)) S.selectedFile = null;
  if (await initClaudeWorkspace()) {
    for (const s of S.sessions) {
      if (!s.projectRoot || !s.claudeKey) continue;
      const bound = await ensureClaudeForAnalysis(s);
      if (bound) {
        s.claudeId = bound.id;
        s.claudeMessages = bound.messages || [];
        s.claudeStatus = bound.status || 'idle';
        s.claudeModel = bound.model || '';
      } else s.claudeError = CW.bindingErrors[s.claudeKey] || '';
    }
  }
  S.ready = true;
}
function toFrontendRel(rootRel) {
  const fe = S.config.frontend ? S.config.frontend.replace(/\/$/, '') + '/' : '';
  return rootRel.startsWith(fe) ? rootRel.slice(fe.length) : rootRel;
}

function wireEvents() {
  api.onTermLine(({ sessionId, line }) => {
    const s = S.sessions.find(x => x.id === sessionId);
    if (s) pushTerm(s, line);
  });
  api.onClaudeWorkspaceEvent(event => {
    const s = S.sessions.find(item => item.claudeId === event?.sessionId);
    if (!s) return;
    if (event.kind === 'session' && event.session?.id === s.claudeId) {
      const chat = event.session;
      s.claudeMessages = chat.messages || [];
      s.claudeStatus = chat.status || 'idle';
      s.claudeError = chat.error || '';
      s.claudeModel = chat.model || '';
      s.claudeRevision = chat.revision || 0;
      if (chat.analysis?.status === 'done' && chat.analysis.sessionId === s.id && chat.analysis.data) {
        s.data = chat.analysis.data;
        s.analyzed = true;
        s.status = 'done';
        S.fileApiCount[toFrontendRel(s.file)] = chat.analysis.data.functions.length;
      } else if (chat.analysis?.status === 'error') {
        s.status = 'error';
        s.claudeError = chat.analysis.error || s.claudeError;
      } else if (chat.analysis?.status === 'interrupted') {
        s.status = 'idle';
      }
      s.claudePermissions = Object.values(CW.permissionsBySession[s.claudeId] || {});
      if (chat.analysis?.status === 'running') s.status = 'running';
      else if (chat.status === 'running' || chat.status === 'starting' || chat.status === 'permission') s.status = 'idle';
      else if (chat.analysis?.status === 'done') S.analyzing = false;
      S.analyzing = !!(activeSession()?.claudeStatus === 'running' && activeSession()?.status === 'running');
      persistSessions();
    } else if (event.kind === 'permission') {
      s.claudePermissions = Object.values(CW.permissionsBySession[s.claudeId] || {});
    } else if (event.kind === 'permission-resolved') {
      s.claudePermissions = Object.values(CW.permissionsBySession[s.claudeId] || {});
    }
  });
  api.onTermStatus(({ sessionId, status }) => {
    const s = S.sessions.find(x => x.id === sessionId);
    if (s && ['running', 'parsing', 'done', 'error'].includes(status)) s.status = status;
  });
  api.onAnalysisResult(({ sessionId, ok, data, error }) => {
    const s = S.sessions.find(x => x.id === sessionId);
    S.analyzing = false;
    if (!s) return;
    if (ok && data) {
      s.data = data; s.analyzed = true; s.status = 'done';
      s.name = fileName(s.file) || s.name;
      S.currentFn = 'all';
      if (s.file) S.fileApiCount[toFrontendRel(s.file)] = data.functions.length;
      showToast(`✓ 分析完成：${data.functions.length} 个功能`);
    } else {
      s.status = 'error';
      pushTerm(s, `✗ ${error || '分析失败'}`);
      showToast('分析失败，详见终端');
    }
    persistSessions();
  });
}

let toastT = null;
export function showToast(msg) {
  S.toast = msg;
  clearTimeout(toastT);
  toastT = setTimeout(() => S.toast = '', 2600);
}

let persistT = null;
export function persistSessions() {
  clearTimeout(persistT);
  persistT = setTimeout(() => {
    const sessions = S.sessions.map(s => ({
      id: s.id, name: s.name, file: s.file, analyzed: s.analyzed,
      projectRoot: s.projectRoot || S.config.root, claudeKey: s.claudeKey || `analysis-${s.id}`,
      claudeId: s.claudeId || null, backend: s.backend || '',
      claudeStatus: s.claudeStatus || 'idle', claudeError: s.claudeError || '',
      status: s.analyzed ? 'done' : 'idle', term: (s.term || []).slice(-200), data: s.analyzed ? s.data : null
    }));
    api.saveSessions(plain({ sessions, activeId: S.activeId })).catch(() => {});
  }, 400);
}

/* ---------------- 文件与配置 ---------------- */
export async function refreshFiles() {
  if (!S.config.root) { S.files = []; return; }
  S.files = await api.scanVue(S.config.root, S.config.frontend);
}
export async function saveConfigFlow(cfg) {
  S.config = { ...S.config, ...cfg };
  await api.saveConfig(plain(S.config));
  const det = await api.detectProjects(S.config.root);
  if (!S.config.frontend && det.frontend) S.config.frontend = det.frontend;
  if (!S.config.backend && det.backend) S.config.backend = det.backend;
  await api.saveConfig(plain(S.config));
  await refreshFiles();
  S.configOpen = false;
  showToast('配置已保存');
}

/* ---------------- 组件选择：一个组件一个会话 ---------------- */
export function selectFile(rel) {
  if (S.analyzing) return;
  const display = displayPath(rel);
  let s = S.sessions.find(x => x.file === display && (x.projectRoot || S.config.root) === S.config.root);
  if (!s) s = createComponentSession(rel);
  S.selectedFile = rel;
  S.terminalOpen = true;
  if (S.activeId !== s.id) { S.activeId = s.id; S.currentFn = 'all'; persistSessions(); }
}

/* ---------------- 分析 ---------------- */
export async function startAnalysis() {
  const s = activeSession();
  if (!s || S.analyzing) return;
  if (!S.config.root) { S.configOpen = true; return; }
  const selected = S.selectedFile || (s.file ? toFrontendRel(s.file) : null);
  if (!selected) { showToast('请先从左侧选择一个 Vue 组件'); return; }
  // 一组件一会话：当前会话与所选组件不符时，切到（或新建）该组件的会话
  if (!s.file || s.file !== displayPath(selected)) {
    selectFile(selected);
    s = activeSession();
    if (!s) return;
  }
  if (s.projectRoot && s.projectRoot !== S.config.root) {
    showToast('当前会话属于另一个项目，请切换回原项目');
    return;
  }
  s.backend = S.config.backend;
  S.selectedFile = selected;
  s.analyzed = false; s.data = null; s.status = 'running'; s.claudeStatus = 'starting'; s.claudeError = '';
  S.analyzing = true;
  S.terminalOpen = true;
  persistSessions();
  const result = await analyzeClaudeSession(s);
  if (!result.ok) {
    S.analyzing = false;
    s.status = 'error'; s.claudeStatus = 'error'; s.claudeError = result.error || '无法开始分析';
    pushTerm(s, `✗ ${s.claudeError}`);
    persistSessions();
    showToast(s.claudeError);
  }
}
export function cancelAnalysis() {
  const s = activeSession();
  if (s?.claudeId && S.analyzing) void stopClaudeSession(s.claudeId);
}

/* ---------------- 会话：按组件创建，一组件一会话 ---------------- */
function componentSessionKey(rel) {
  const r = String(rel).replace(/\\/g, '/');
  if (`vue:${r}`.length <= 100) return `vue:${r}`;
  let h = 0;
  for (let i = 0; i < r.length; i++) h = (h * 31 + r.charCodeAt(i)) >>> 0;
  return `vue:h${h.toString(36)}`;
}
function createComponentSession(rel) {
  S.sessionSeq += 1;
  const s = { id: S.sessionSeq, name: fileName(rel), file: displayPath(rel), projectRoot: S.config.root,
    claudeKey: componentSessionKey(rel), claudeId: null, claudeStatus: 'idle', claudeError: '',
    analyzed: false, status: 'idle', term: [], data: null };
  S.sessions.push(s);
  if (S.config.root) ensureClaudeForAnalysis(s).then(chat => {
    if (!chat) { s.claudeError = CW.bindingErrors[s.claudeKey] || '无法连接当前会话'; return; }
    s.claudeId = chat.id; s.claudeMessages = chat.messages || []; s.claudeStatus = chat.status || 'idle';
    persistSessions();
  });
  return s;
}
export function switchSession(id) {
  if (id === S.activeId) return;
  const s = S.sessions.find(x => x.id === id);
  if (!s) return;
  S.activeId = id;
  S.currentFn = 'all';
  S.analyzing = s.claudeStatus === 'running' && !s.analyzed;
  S.config.backend = s.backend || S.config.backend;
  S.selectedFile = s.analyzed || s.file ? toFrontendRel(s.file || '') : null;
  if (S.selectedFile && !S.files.find(f => f.rel === S.selectedFile)) S.selectedFile = null;
  persistSessions();
}

/* ---------------- 组件分组 ---------------- */
let groupsT = null;
function persistGroups() {
  clearTimeout(groupsT);
  groupsT = setTimeout(() => api.saveGroups(plain(S.groups)).catch(() => {}), 400);
}
function groupsList() {
  if (!S.config.root) return null;
  if (!Array.isArray(S.groups[S.config.root])) S.groups[S.config.root] = [];
  return S.groups[S.config.root];
}
export function groupsForRoot() {
  return S.config.root && Array.isArray(S.groups[S.config.root]) ? S.groups[S.config.root] : [];
}
function findGroupNode(list, id) {
  for (const g of list) {
    if (g.id === id) return g;
    const hit = findGroupNode(g.children || [], id);
    if (hit) return hit;
  }
  return null;
}
function ensureNode(g) {
  if (!Array.isArray(g.files)) g.files = [];
  if (!Array.isArray(g.children)) g.children = [];
  return g;
}
export function addGroup(parentId = null, name = '新建分组') {
  const list = groupsList();
  if (!list) return null;
  const node = ensureNode({
    id: `g${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name, files: [], children: []
  });
  const parent = parentId ? findGroupNode(list, parentId) : null;
  (parent ? ensureNode(parent).children : list).push(node);
  persistGroups();
  return node.id;
}
export function renameGroup(id, name) {
  const g = findGroupNode(groupsList() || [], id);
  const trimmed = String(name || '').trim();
  if (!g || !trimmed) return;
  g.name = trimmed;
  persistGroups();
}
export function deleteGroup(id) {
  const list = groupsList();
  if (!list) return;
  const i = list.findIndex(g => g.id === id);
  if (i >= 0) { list.splice(i, 1); persistGroups(); return; }
  const walk = (nodes) => {
    for (const g of nodes) {
      const j = (g.children || []).findIndex(c => c.id === id);
      if (j >= 0) { g.children.splice(j, 1); return true; }
      if (walk(g.children || [])) return true;
    }
    return false;
  };
  if (walk(list)) persistGroups();
}
export function addFileToGroup(id, rel) {
  const g = findGroupNode(groupsList() || [], id);
  if (!g) return;
  ensureNode(g);
  if (!g.files.includes(rel)) g.files.push(rel);
  persistGroups();
}
export function removeFileFromGroup(id, rel) {
  const g = findGroupNode(groupsList() || [], id);
  if (!g) return;
  g.files = (g.files || []).filter(r => r !== rel);
  persistGroups();
}
/** 弹窗确认：整体重设分组内组件（勾选集合） */
export function setGroupFiles(id, rels) {
  const g = findGroupNode(groupsList() || [], id);
  if (!g) return;
  ensureNode(g);
  g.files = [...rels];
  persistGroups();
}

/* ---------------- 布局 ---------------- */
export function layoutKey() {
  const s = activeSession();
  return `${s?.file || 'none'}|${S.currentFn}`;
}
export function loadLayout() { return S.layouts[layoutKey()] || null; }
export function saveLayout(map) {
  S.layouts[layoutKey()] = map;
  api.saveLayouts(plain(S.layouts)).catch(() => {});
  S.layoutDirty = false;
  S.layoutHasSaved = true;
  showToast('布局已保存');
}
export function clearLayout() {
  delete S.layouts[layoutKey()];
  api.saveLayouts(plain(S.layouts)).catch(() => {});
  S.layoutDirty = false;
  S.layoutHasSaved = false;
  showToast('已恢复默认布局');
}

/* ---------------- 页签 ---------------- */
export function selectFn(id) {
  S.currentFn = id;
  S.layoutDirty = false;
  S.layoutHasSaved = !!S.layouts[layoutKey()];
}
export const graphSubtitle = computed(() => {
  if (S.currentFn === 'all') return '全部功能';
  const f = currentFunctions().find(x => x.id === S.currentFn);
  return f ? `${f.name} · ${f.method.toUpperCase()} ${f.url}` : '';
});
export { seq };
