import { reactive, computed } from 'vue';
import { seq } from './chain.js';
import { canonicalizeSessions, componentRel, componentSessionKey } from './session-key.js';

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
  sessions: [],             // {id,name,file,projectRoot,claudeKey,claudeId,analyzed,status,data}
  activeId: null,
  sessionSeq: 0,
  analyzing: false,
  currentFn: 'all',
  terminalOpen: false,
  terminal: { alive: false, error: '' },   // 原生 Claude Code 终端（PTY）状态
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
export const setTerminalState = (state) => { Object.assign(S.terminal, state); };

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
      ...s, projectRoot: s.projectRoot || S.config.root,
      claudeKey: s.claudeKey || `analysis-${s.id}`,
      claudeId: s.claudeId || null, claudeError: ''
    }));
    S.sessionSeq = Math.max(0, ...S.sessions.map(s => s.id));
    S.activeId = ses.activeId ?? S.sessions[0].id;
  }
  wireEvents();
  await refreshFiles();
  // 一组件一会话：清掉旧版无组件归属的全局会话，合并同一组件的重复会话。
  const canonical = canonicalizeSessions(S.sessions, {
    frontend: S.config.frontend, root: S.config.root, activeId: S.activeId
  });
  S.sessions = canonical.sessions;
  S.activeId = canonical.activeId;
  S.sessionSeq = Math.max(0, ...S.sessions.map(s => s.id));
  if (!S.sessions.some(s => s.id === S.activeId)) S.activeId = S.sessions[0]?.id ?? null;
  const active = activeSession();
  S.selectedFile = active?.file ? toFrontendRel(active.file) : null;
  if (S.selectedFile && !S.files.find(f => f.rel === S.selectedFile)) S.selectedFile = null;
  // 启动即展示原生终端面板（当前菜单的会话自动恢复）
  S.terminalOpen = !!active?.file;
  if (S.sessions.length) persistSessions();
  S.ready = true;
}
function toFrontendRel(rootRel) {
  return componentRel(rootRel, S.config.frontend);
}

function wireEvents() {
  // 原生终端事件：data/exit 由终端组件消费，这里只处理分析结果回填。
  api.onTerminalEvent(event => {
    if (event?.type !== 'analysis') return;
    const s = activeSession();
    S.analyzing = false;
    if (!s) return;
    if (event.ok && event.data) {
      s.data = event.data; s.analyzed = true; s.status = 'done'; s.claudeError = '';
      S.currentFn = 'all';
      if (s.file) S.fileApiCount[toFrontendRel(s.file)] = event.data.functions.length;
      showToast(`✓ 分析完成：${event.data.functions.length} 个功能`);
    } else {
      s.status = 'error';
      s.claudeError = event.error || '分析失败';
      showToast('分析失败，详见终端面板');
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
      status: s.analyzed ? 'done' : 'idle', data: s.analyzed ? s.data : null
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
export function sessionForComponent(rel, projectRoot = S.config.root) {
  const target = componentSessionKey(rel);
  return S.sessions.find(s => (s.projectRoot || S.config.root) === projectRoot &&
    (s.file ? componentSessionKey(toFrontendRel(s.file)) === target : s.claudeKey === target)) || null;
}
export function selectFile(rel) {
  let s = sessionForComponent(rel);
  if (!s) s = createComponentSession(rel);
  S.selectedFile = rel;
  S.terminalOpen = true;
  if (S.activeId !== s.id) {
    S.activeId = s.id;
    S.currentFn = 'all';
    S.analyzing = s.status === 'running';
    persistSessions();
  }
}

/* ---------------- 分析：注入原生终端，从会话日志提取契约 ---------------- */
function ensureSessionUuid(s) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.claudeId || '')) {
    s.claudeId = crypto.randomUUID();
  }
  return s.claudeId;
}
async function waitForTerminal(timeout = 15000) {
  for (let i = 0; i < timeout / 100; i++) {
    if (S.terminal.alive) return true;
    if (S.terminal.error) return false;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}
export async function startAnalysis() {
  const current = activeSession();
  if (!current) return;
  if (!S.config.root) { S.configOpen = true; return; }
  const selected = S.selectedFile || (current.file ? toFrontendRel(current.file) : null);
  if (!selected) { showToast('请先从左侧选择一个 Vue 组件'); return; }
  // 一组件一会话：当前会话与所选组件不符时，切到（或新建）该组件的会话
  let s = current;
  if (!s.file || componentSessionKey(toFrontendRel(s.file)) !== componentSessionKey(selected)) {
    selectFile(selected);
    s = activeSession();
    if (!s) return;
  }
  if (s.status === 'running') { showToast('当前组件正在分析，可先切到其他菜单'); return; }
  if (s.projectRoot && s.projectRoot !== S.config.root) {
    showToast('当前会话属于另一个项目，请切换回原项目');
    return;
  }
  s.backend = S.config.backend;
  S.selectedFile = selected;
  s.analyzed = false; s.data = null; s.status = 'running'; s.claudeError = '';
  S.analyzing = true;
  S.terminalOpen = true;
  ensureSessionUuid(s);
  persistSessions();
  if (!await waitForTerminal()) {
    S.analyzing = false;
    s.status = 'error';
    s.claudeError = S.terminal.error || '原生 Claude Code 终端未能启动';
    persistSessions();
    showToast(s.claudeError);
    return;
  }
  const result = await api.terminalAnalyze({ entryRel: toFrontendRel(s.file), backendRel: s.backend || '' });
  if (!result?.ok) {
    S.analyzing = false;
    s.status = 'error'; s.claudeError = result?.error || '无法开始分析';
    persistSessions();
    showToast(s.claudeError);
  }
}
/** 原生中断：向 TUI 发送 Esc（Claude Code 原生的打断当前回复键）。 */
export function cancelAnalysis() {
  const s = activeSession();
  if (s?.status === 'running') {
    void api.terminalWrite('\x1b');
    S.analyzing = false;
    s.status = 'idle';
    persistSessions();
  }
}

/* ---------------- 会话：按组件创建，一组件一会话 ---------------- */
function createComponentSession(rel) {
  S.sessionSeq += 1;
  const s = { id: S.sessionSeq, name: fileName(rel), file: displayPath(rel), projectRoot: S.config.root,
    claudeKey: componentSessionKey(rel), claudeId: null, claudeError: '',
    analyzed: false, status: 'idle', data: null };
  S.sessions.push(s);
  persistSessions();
  return s;
}
export function switchSession(id) {
  if (id === S.activeId) return;
  const s = S.sessions.find(x => x.id === id);
  if (!s) return;
  S.activeId = id;
  S.currentFn = 'all';
  S.analyzing = s.status === 'running';
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
