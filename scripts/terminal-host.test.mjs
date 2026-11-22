import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTerminalHost, claudeSessionFile, mungeProjectDir } from '../electron/main/terminal-host.mjs';

// 不调用真实 CLI 或付费模型：PTY 与会话日志均为本地夹具。
function fakePty() {
  const listeners = { data: [], exit: [] };
  const pty = {
    written: [], cols: 100, rows: 30,
    onData(cb) { listeners.data.push(cb); },
    onExit(cb) { listeners.exit.push(cb); },
    write(data) { pty.written.push(String(data)); for (const cb of listeners.data) cb('echo:' + String(data).slice(0, 8)); },
    resize() {},
    kill() { for (const cb of listeners.exit) cb({ exitCode: 0 }); }
  };
  return pty;
}

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'mailuo-term-'));
  const root = path.join(home, 'project');
  mkdirSync(root);
  mkdirSync(path.join(home, '.claude', 'projects', mungeProjectDir(root)), { recursive: true });
  return {
    home, root,
    configDir: path.join(home, '.claude'),
    env: { PATH: process.env.PATH, USERPROFILE: home },
    cleanup() { rmSync(home, { recursive: true, force: true }); }
  };
}

const UUID = '11111111-2222-3333-4444-555555555555';

test('munges cwd to the Claude projects directory name', () => {
  assert.equal(mungeProjectDir('D:\\Projects\\demo app'), 'D--Projects-demo-app');
  assert.equal(claudeSessionFile('D:/p', UUID, { env: {}, home: 'H' }),
    path.join('H', '.claude', 'projects', 'D--p', `${UUID}.jsonl`));
});

test('spawns the native CLI with a fixed session id and highest permission', async () => {
  const f = fixture();
  const events = [];
  let launch;
  const host = createTerminalHost({
    notify: e => events.push(e), env: f.env, home: f.home,
    spawnPty: (file, args, options) => { launch = { file, args, options }; return fakePty(); }
  });
  try {
    const result = await host.start({ root: f.root, sessionId: UUID, model: 'glm-test' });
    assert.equal(result.ok, true);
    assert.ok(launch.file.endsWith('claude.exe') || launch.file.endsWith('claude'), 'must resolve the native executable');
    assert.deepEqual(launch.args, ['--session-id', UUID, '--dangerously-skip-permissions', '--model', 'glm-test']);
    assert.equal(launch.options.cwd, f.root);
    assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, undefined, 'must not regress Electron to plain Node');
    assert.equal(host.write({ data: 'ls\r' }).ok, true);
    assert.ok(events.some(e => e.type === 'data'), 'pty output must be relayed');
    assert.deepEqual(host.start({ root: f.root, sessionId: 'nope' }), { ok: false, error: '会话 ID 无效' });
  } finally { host.dispose(); f.cleanup(); }
});

test('relaunching an existing session resumes it instead of reusing --session-id', async () => {
  const f = fixture();
  const launches = [];
  const host = createTerminalHost({
    notify: () => {}, env: f.env, home: f.home,
    spawnPty: (file, args) => { launches.push(args); return fakePty(); }
  });
  try {
    await host.start({ root: f.root, sessionId: UUID });
    assert.deepEqual(launches[0].slice(0, 2), ['--session-id', UUID], 'fresh session pins its id');
    // 模拟 CLI 已把会话落盘
    const file = claudeSessionFile(f.root, UUID, { env: f.env, home: f.home });
    appendFileSync(file, JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }) + '\n');
    await host.start({ root: f.root, sessionId: '99999999-8888-7777-6666-555555555555' }); // switch away
    await host.start({ root: f.root, sessionId: UUID }); // back → must resume
    assert.ok(launches.at(-1).includes('--resume'), 'existing session must resume, not collide on --session-id');
    assert.ok(!launches.at(-1).includes('--session-id'), 'no --session-id when the file exists');
    assert.ok(launches.at(-1).includes('--dangerously-skip-permissions'));
  } finally { host.dispose(); f.cleanup(); }
});

test('restarting the same session is idempotent; switching swaps the pty', async () => {
  const f = fixture();
  const ptys = [];
  const host = createTerminalHost({
    notify: () => {}, env: f.env, home: f.home,
    spawnPty: () => { const p = fakePty(); ptys.push(p); return p; }
  });
  try {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal((await host.start({ root: f.root, sessionId: UUID })).restarted, false, 'same session must reuse the pty');
    assert.equal(ptys.length, 1);
    await host.start({ root: f.root, sessionId: '99999999-8888-7777-6666-555555555555' });
    assert.equal(ptys.length, 2, 'switching sessions must spawn a fresh pty');
  } finally { host.dispose(); f.cleanup(); }
});

test('analysis injects a bracketed paste and extracts the contract from the session log', async () => {
  const f = fixture();
  try {
    const events = [];
    const file = claudeSessionFile(f.root, UUID, { env: f.env, home: f.home });
    writeFileSync(file, JSON.stringify({ type: 'user', message: { role: 'user', content: '历史消息' } }) + '\n');
    let clock = 1000;
    let pty;
    const host = createTerminalHost({
      notify: e => events.push(e), env: f.env, home: f.home, now: () => clock,
      spawnPty: () => { pty = fakePty(); return pty; }
    });
    try {
      await host.start({ root: f.root, sessionId: UUID });

      const analysis = host.analyze({ entryRel: 'src/views/Order.vue', backendRel: 'backend' });
      assert.equal(analysis.ok, true);
      const injected = pty.written.at(-1);
      assert.ok(injected.startsWith('\x1b[200~'), 'multi-line prompt must be bracketed so newlines do not submit early');
      assert.ok(injected.endsWith('\x1b[201~\r'));
      assert.ok(injected.includes('src/views/Order.vue'));
      assert.ok(injected.includes('最高权限'));
      assert.deepEqual(host.analyze({ entryRel: 'x' }), { ok: false, error: '当前会话已有分析在进行' });

      // 模拟 CLI 落盘：先流式块，再 end_turn 收尾
      clock += 500;
      appendFileSync(file, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '正在阅读项目…' }] } }) + '\n');
      appendFileSync(file, JSON.stringify({ type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn',
        content: [{ type: 'text', text: '```json\n' + JSON.stringify({ file: 'Order.vue', functions: [{ id: 'list', name: '查询', method: 'get', url: '/api/list', front: [], logic: [] }] }) + '\n```' }] } }) + '\n');
      // 事件泵：poll 每 300ms 真实轮询，tick 用注入时钟判定收尾
      for (let i = 0; i < 30 && !events.some(e => e.type === 'analysis'); i++) {
        clock += 400;
        host.tick();
        await new Promise(r => setTimeout(r, 60));
      }
      const done = events.find(e => e.type === 'analysis');
      assert.ok(done?.ok, 'analysis must complete with a contract');
      assert.equal(done.data.functions[0].name, '查询');
      assert.equal(done.data.functions[0].url, '/api/list');
    } finally { host.dispose(); }
  } finally { f.cleanup(); }
});

test('pty exit during analysis surfaces an error instead of hanging', async () => {
  const f = fixture();
  const events = [];
  let live;
  const host = createTerminalHost({
    notify: e => events.push(e), env: f.env, home: f.home, now: () => 1000,
    spawnPty: () => { live = fakePty(); return live; }
  });
  try {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    live.kill();
    const failed = events.find(e => e.type === 'analysis');
    assert.ok(!failed?.ok);
    assert.match(failed.error, /退出|结束/);
    assert.ok(events.some(e => e.type === 'exit'));
  } finally { host.dispose(); f.cleanup(); }
});
