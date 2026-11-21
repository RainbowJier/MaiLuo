import { reactive, computed } from 'vue';
import { seq } from './chain.js';

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
  const [cfg, ses, layouts, ck] = await Promise.all([
    api.getConfig(), api.loadSessions(), api.loadLayouts(), api.claudeCheck()
  ]);
  S.claudeOk = !!ck.ok;
  S.claudeVersion = ck.version || '';
  S.config = { ...S.config, ...cfg };
  S.layouts = layouts || {};
  if (ses?.sessions?.length) {
    S.sessions = ses.sessions.map(s => ({ ...s, term: s.term || [] }));
    S.sessionSeq = Math.max(0, ...S.sessions.map(s => s.id));
    S.activeId = ses.activeId ?? S.sessions[0].id;
    const a = activeSession();
    if (a?.file) S.selectedFile = toFrontendRel(a.file);
  } else {
    newSessionObj(true);
  }
  wireEvents();
  await refreshFiles();
  if (S.selectedFile && !S.files.find(f => f.rel === S.selectedFile)) S.selectedFile = null;
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
      status: s.analyzed ? 'done' : 'idle',
      term: (s.term || []).slice(-200),
      data: s.analyzed ? s.data : null
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

/* ---------------- 组件选择 ---------------- */
export function selectFile(rel) {
  if (S.analyzing) return;
  S.selectedFile = rel;
  const s = activeSession();
  if (s && !s.analyzed) { s.file = displayPath(rel); }
}

/* ---------------- 分析 ---------------- */
export async function startAnalysis() {
  const s = activeSession();
  if (!s || S.analyzing) return;
  if (!S.config.root) { S.configOpen = true; return; }
  if (!S.selectedFile) { showToast('请先从左侧选择一个 Vue 组件'); return; }
  S.analyzing = true;
  s.analyzed = false; s.data = null; s.status = 'running'; s.term = [];
  s.file = displayPath(S.selectedFile);
  S.terminalOpen = true;
  pushTerm(s, `$ claude analyze --project ${S.config.root} --entry ${s.file}`);
  const r = await api.analyze({
    sessionId: s.id,
    root: S.config.root,
    backendRel: S.config.backend,
    entryRel: s.file
  });
  if (!r.ok) {
    S.analyzing = false;
    s.status = 'error';
    pushTerm(s, `✗ ${r.error}`);
  }
}
export function cancelAnalysis() {
  const s = activeSession();
  if (s && S.analyzing) api.cancelAnalyze(s.id);
}

/* ---------------- 会话 ---------------- */
function newSessionObj(first = false) {
  S.sessionSeq += 1;
  const s = { id: S.sessionSeq, name: `会话 ${S.sessionSeq}`, file: '', analyzed: false, status: 'idle', term: [], data: null };
  S.sessions.push(s);
  S.activeId = s.id;
  if (!first) persistSessions();
  return s;
}
export function startNewSession() {
  if (S.analyzing) return;
  newSessionObj();
  S.selectedFile = null;
  S.terminalOpen = true;
  showToast('已新建会话');
}
export function switchSession(id) {
  if (S.analyzing || id === S.activeId) return;
  const s = S.sessions.find(x => x.id === id);
  if (!s) return;
  S.activeId = id;
  S.currentFn = 'all';
  S.selectedFile = s.analyzed || s.file ? toFrontendRel(s.file || '') : null;
  if (S.selectedFile && !S.files.find(f => f.rel === S.selectedFile)) S.selectedFile = null;
  persistSessions();
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
