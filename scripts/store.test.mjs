import test from 'node:test';
import assert from 'node:assert/strict';

// store.js 在模块顶层读取 window.api：先装一层假的 IPC，再动态 import。
// 提示条的定时器长达数秒，unref 掉免得拖住测试进程退出（仅影响本测试进程）。
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
  const t = realSetTimeout(fn, ms, ...args);
  if (ms > 1000) t.unref?.();
  return t;
};

const calls = [];
let onEvent = null;
let saved = null;
const api = {
  getConfig: async () => ({ root: 'D:/p', frontend: 'frontend', backend: 'backend' }),
  loadSessions: async () => ({ sessions: [], activeId: null }),
  loadLayouts: async () => ({}),
  loadGroups: async () => ({}),
  claudeCheck: async () => ({ ok: true, version: '1.0 (Claude Code)' }),
  scanVue: async () => [
    { rel: 'src/views/A.vue', dir: 'src/views', name: 'A.vue' },
    { rel: 'src/views/B.vue', dir: 'src/views', name: 'B.vue' }
  ],
  detectProjects: async () => ({}),
  saveConfig: async () => true,
  saveSessions: async (data) => { saved = data; calls.push(['saveSessions']); return true; },
  saveLayouts: async () => true,
  saveGroups: async () => true,
  terminalStart: async (p) => { calls.push(['terminalStart', p]); return { ok: true, restarted: true }; },
  terminalWrite: async (data) => { calls.push(['terminalWrite', data]); return { ok: true }; },
  terminalResize: async () => ({ ok: true }),
  terminalStop: async () => ({ ok: true }),
  terminalAnalyze: async (p) => { calls.push(['terminalAnalyze', p]); return { ok: true }; },
  terminalCancel: async () => { calls.push(['terminalCancel']); return { ok: true }; },
  onTerminalEvent: (cb) => { onEvent = cb; return () => {}; }
};
globalThis.window = { api };

const { S, initApp, startAnalysis, cancelAnalysis, selectFile, activeSession } = await import('../src/store.js');

const last = name => calls.filter(c => c[0] === name).at(-1);
const sleep = ms => new Promise(r => realSetTimeout(r, ms));
const terminalReady = () => { S.terminal.alive = true; S.terminal.error = ''; };

test('the analysis prompt is injected only once this session terminal reported output', async () => {
  await initApp();
  assert.equal(typeof onEvent, 'function', 'initApp must subscribe to terminal events');
  selectFile('src/views/A.vue');
  const a = activeSession();
  S.terminal.alive = false;
  S.terminal.error = '';
  const running = startAnalysis();
  assert.equal(a.status, 'running');
  await sleep(200);
  assert.equal(last('terminalAnalyze'), undefined, 'must wait instead of pasting into a terminal that is not ready');
  terminalReady();
  await running;
  assert.equal(last('terminalAnalyze')[1].sessionId, a.claudeId, 'the host is told which session must own the terminal');
  assert.equal(last('terminalAnalyze')[1].entryRel, 'src/views/A.vue');
});

test('a terminal that fails to start marks only the initiating session as failed', async () => {
  const a = activeSession();
  a.status = 'idle';   // 上一条用例让宿主接受了分析；这里只关心终端起不来的分支
  calls.length = 0;
  S.terminal.alive = false;
  S.terminal.error = '未找到原生 Claude Code 程序';
  await startAnalysis();
  assert.equal(a.status, 'error');
  assert.match(a.claudeError, /未找到原生 Claude Code/);
  assert.equal(S.analyzing, false);
  assert.equal(last('terminalAnalyze'), undefined);
});

test('analysis results and failures are written back to the session that was analyzed, not to the active menu', async () => {
  const a = activeSession();
  terminalReady();
  await startAnalysis();
  assert.equal(a.status, 'running');
  assert.equal(S.analyzing, true);

  // 分析进行中切到另一个菜单：宿主会杀掉 PTY，并报告「发起分析的那个会话」被中止
  selectFile('src/views/B.vue');
  const b = activeSession();
  assert.notEqual(b.id, a.id);
  assert.equal(S.analyzing, false);
  onEvent({ type: 'analysis', sessionId: a.claudeId, error: '终端已切换或关闭，本次分析中止' });

  assert.equal(a.status, 'error');
  assert.match(a.claudeError, /中止/);
  assert.equal(b.status, 'idle', 'the newly selected menu must not inherit the failure');
  assert.equal(b.claudeError, '');

  // 切回原菜单：不能又变成「分析中」（那正是详情页卡死的来源）
  selectFile('src/views/A.vue');
  assert.equal(S.analyzing, false);
  assert.equal(a.status, 'error');

  // 迟到的成功结果仍然回到它自己的会话，哪怕用户已经切走
  await startAnalysis();
  selectFile('src/views/B.vue');
  onEvent({ type: 'analysis', sessionId: a.claudeId, ok: true, data: { file: 'A.vue', functions: [{ id: 'x' }] } });
  assert.equal(a.analyzed, true);
  assert.equal(a.data.functions[0].id, 'x');
  assert.equal(a.status, 'done');
  assert.equal(b.analyzed, false);
  assert.equal(b.status, 'idle');
});

test('cancel clears the running state, keeps an existing result, and lets the next analysis start', async () => {
  const s = activeSession();   // 上一条用例结尾停在菜单 B
  await startAnalysis();
  assert.equal(s.status, 'running');
  cancelAnalysis();
  assert.equal(s.status, 'idle');
  assert.equal(S.analyzing, false);
  assert.ok(last('terminalCancel'), 'the host must be told to drop the pending analysis');

  // 已有结果时取消：结果保留，状态回到 done
  s.analyzed = true; s.data = { functions: [{ id: 'keep' }] }; s.status = 'done';
  await startAnalysis();
  assert.equal(s.status, 'running');
  cancelAnalysis();
  assert.equal(s.status, 'done');
  assert.equal(s.data.functions[0].id, 'keep');
});

test('re-analysis keeps the previous result until a new one succeeds; failure does not wipe it', async () => {
  const s = activeSession();
  const oldData = { functions: [{ id: 'old' }] };
  s.analyzed = true; s.data = oldData; s.status = 'done';
  const shownBefore = s.data;   // 响应式代理：用「同一个对象」而不是与原始对象做引用比较
  const revBefore = S.dataRev;

  await startAnalysis();
  assert.equal(s.status, 'running');
  assert.equal(s.analyzed, true, 'the previous result stays visible while Claude works');
  assert.equal(s.data, shownBefore);

  onEvent({ type: 'analysis', sessionId: s.claudeId, error: '未能从回复中解析出链路 JSON' });
  assert.equal(s.status, 'error');
  assert.equal(S.analyzing, false);
  assert.equal(s.data, shownBefore, 'a failed re-run must not destroy the existing graph');
  assert.equal(s.analyzed, true);
  assert.equal(S.dataRev, revBefore, 'nothing changed: the graph must not be rebuilt');

  const newData = { functions: [{ id: 'new' }] };
  S.currentFn = 'old';
  await startAnalysis();
  onEvent({ type: 'analysis', sessionId: s.claudeId, ok: true, data: newData });
  assert.deepEqual(s.data, newData);
  assert.notEqual(s.data, shownBefore, 'the new result replaces the old object');
  assert.equal(s.status, 'done');
  assert.equal(S.currentFn, 'all', 'a new result resets the function tab');
  assert.equal(S.dataRev, revBefore + 1, 'a new result must rebuild the graph even if the function count is unchanged');
});

test('persisted sessions never carry a running status and keep the last successful result', async () => {
  const s = activeSession();
  s.analyzed = true; s.data = { functions: [{ id: 'x' }] }; s.status = 'done';
  await startAnalysis();
  assert.equal(s.status, 'running');
  await sleep(500);   // persistSessions 有 400ms 防抖
  const row = saved.sessions.find(x => x.id === s.id);
  assert.equal(row.status, 'done', 'a restart mid-analysis must not come back as "analyzing"');
  assert.deepEqual(row.data, { functions: [{ id: 'x' }] });
  assert.equal(row.claudeId, s.claudeId);
  cancelAnalysis();
});
