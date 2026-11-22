/** 会话身份：一个 Vue 组件（菜单）固定一条会话。与 Vue 无关，可单测。 */

export function rootKey(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  const clean = raw.replace(/\/+$/, '') || (raw.startsWith('/') ? '/' : '');
  const key = /^[a-z]:$/i.test(clean) ? `${clean}/` : clean;
  return /^[a-z]:(?:\/|$)/i.test(raw) || raw.startsWith('//') ? key.toLowerCase() : key;
}

/** 把前端目录前缀剥掉：frontend/src/views/A.vue -> src/views/A.vue */
export function componentRel(file, frontend = '') {
  let raw = String(file || '').replace(/\\/g, '/');
  const fe = String(frontend || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (fe && raw.startsWith(`${fe}/`)) raw = raw.slice(fe.length + 1);
  return raw;
}

export function componentSessionKey(rel) {
  const r = String(rel || '').replace(/\\/g, '/');
  if (`vue:${r}`.length <= 100) return `vue:${r}`;
  let h = 0;
  for (let i = 0; i < r.length; i++) h = (h * 31 + r.charCodeAt(i)) >>> 0;
  return `vue:h${h.toString(36)}`;
}

const basename = rel => String(rel || '').split('/').pop() || '';

function displayFile(rel, frontend) {
  const fe = String(frontend || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return fe ? `${fe}/${rel}` : rel;
}

function mergeTwo(a, b, rel, chatWeight) {
  const chatSrc = chatWeight(b) > chatWeight(a) ? b : a;
  const dataSrc = a.analyzed && a.data ? a : b.analyzed && b.data ? b : (a.id >= b.id ? a : b);
  const termSrc = (b.term?.length || 0) > (a.term?.length || 0) ? b : a;
  const hasData = !!(dataSrc.analyzed && dataSrc.data);
  return {
    ...dataSrc,
    id: a.id,
    name: basename(rel),
    file: a.file,
    projectRoot: a.projectRoot,
    claudeKey: chatSrc.claudeKey || dataSrc.claudeKey || componentSessionKey(rel),
    claudeId: chatSrc.claudeId || dataSrc.claudeId || null,
    claudeStatus: chatSrc.claudeStatus || dataSrc.claudeStatus || 'idle',
    claudeError: dataSrc.claudeError || chatSrc.claudeError || '',
    backend: dataSrc.backend || chatSrc.backend || '',
    term: termSrc.term || a.term || [],
    analyzed: hasData,
    data: hasData ? dataSrc.data : null,
    status: hasData ? 'done' : (dataSrc.status || 'idle')
  };
}

/**
 * 载入时归一：丢弃没有组件归属的旧版全局会话；同一项目内的同一组件只保留一份，
 * 合并时取最完整的分析结果、最长的对话历史和终端输出。
 */
export function canonicalizeSessions(list, { frontend = '', root = '', activeId = null, chatWeight = () => 0 } = {}) {
  const slots = new Map();
  const order = [];
  const remap = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;
    const rel = componentRel(raw.file, frontend);
    if (!rel) continue;
    const projectRoot = raw.projectRoot || root;
    const key = `${rootKey(projectRoot)}|${componentSessionKey(rel)}`;
    const session = {
      ...raw,
      name: basename(rel),
      file: displayFile(rel, frontend),
      projectRoot,
      claudeId: raw.claudeId || null,
      claudeStatus: raw.claudeStatus || 'idle',
      claudeError: raw.claudeError || '',
      claudeMessages: [],
      claudePermissions: [],
      term: raw.term || []
    };
    const seen = slots.get(key);
    if (!seen) {
      slots.set(key, { index: order.length, session });
      order.push(session);
      remap.set(session.id, session.id);
    } else {
      const merged = mergeTwo(seen.session, session, rel, chatWeight);
      seen.session = merged;
      order[seen.index] = merged;
      remap.set(session.id, merged.id);
    }
  }
  const valid = new Set(order.map(s => s.id));
  const target = activeId != null ? remap.get(activeId) ?? activeId : null;
  return { sessions: order, activeId: target != null && valid.has(target) ? target : order[0]?.id ?? null };
}
