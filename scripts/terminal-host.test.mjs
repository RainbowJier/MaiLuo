import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTerminalHost, claudeSessionFile, mungeProjectDir } from '../electron/main/terminal-host.mjs';

// 不调用真实 CLI 或付费模型：PTY 与会话日志均为本地夹具。
// deferredKill 模拟真实 node-pty：kill() 之后退出事件是异步到达的。
function fakePty({ deferredKill = false } = {}) {
  const listeners = { data: [], exit: [] };
  const pty = {
    written: [], cols: 100, rows: 30,
    onData(cb) { listeners.data.push(cb); },
    onExit(cb) { listeners.exit.push(cb); },
    write(data) { pty.written.push(String(data)); pty.emit('echo:' + String(data).slice(0, 8)); },
    resize() {},
    kill() { if (!deferredKill) pty.exit(); },
    emit(data) { for (const cb of listeners.data) cb(data); },
    exit(exitCode = 0) { for (const cb of listeners.exit) cb({ exitCode }); }
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
    // 模拟从另一个 Claude Code 会话里启动 MaiLuo 时继承到的子会话标记
    env: { PATH: process.env.PATH, USERPROFILE: home, CLAUDE_CODE_CHILD_SESSION: '1', CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'parent-session', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', CLAUDE_PID: '4242' },
    cleanup() { rmSync(home, { recursive: true, force: true }); }
  };
}

/**
 * 带可注入时钟的宿主夹具。tick() 每次先读一遍会话日志，
 * 所以测试用 flush()/pump() 推进即可，不依赖真实的 300ms 轮询。
 */
async function withRig(options, body) {
  const f = fixture();
  let clock = 1_000_000;
  let pty = null;
  const events = [];
  const host = createTerminalHost({
    notify: e => events.push(e), env: f.env, home: f.home, now: () => clock,
    spawnPty: (file, args, opts) => (pty = options.spawn ? options.spawn(file, args, opts) : fakePty())
  });
  const ctx = {
    f, host, events,
    file: claudeSessionFile(f.root, UUID, { env: f.env, home: f.home }),
    pty: () => pty,
    /** 把已追加的日志读进来（时钟推进 1ms） */
    flush() { clock += 1; host.tick(); },
    pump(ms) { clock += ms; host.tick(); }
  };
  try { await body(ctx); } finally { host.dispose(); f.cleanup(); }
}

const UUID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

/* 会话日志夹具：结构与真实 Claude Code（2.1.332 实测）落盘一致 */
const userLine = content => JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
const assistantLine = (content, stop = 'end_turn') =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', stop_reason: stop, content } }) + '\n';
const textBlock = t => ({ type: 'text', text: t });
const CONTRACT = '{"file":"Order.vue","functions":[{"id":"list","name":"查询","method":"get","url":"/api/list"}]}';
const contractText = '```json\n' + CONTRACT + '\n```';
/** 从 PTY 收到的最后一次写入里取出注入的提示词原文（去掉括号粘贴序列） */
const promptOf = pty => pty.written.at(-1).replace(/^\x1b\[200~/, '').replace(/\x1b\[201~\r$/, '');
/**
 * 真实 CLI（2.1.332 实测）把粘贴进 TUI 的提示词记成
 *   "\n\n<pasted_content id=…>\n<原文>\n</pasted_content>\n"
 * 标记不在开头，所以宿主只能用 includes 找界碑。夹具按这个形状落盘。
 */
const pastedPrompt = (pty, id = '04e4') => `\n\n<pasted_content id="${id}">\n${promptOf(pty)}\n</pasted_content>\n`;
const analysisEvents = events => events.filter(e => e.type === 'analysis');

test('munges cwd to the Claude projects directory name', () => {
  assert.equal(mungeProjectDir('D:\\Projects\\demo app'), 'D--Projects-demo-app');
  assert.equal(claudeSessionFile('D:/p', UUID, { env: {}, home: 'H' }),
    path.join('H', '.claude', 'projects', 'D--p', `${UUID}.jsonl`));
});

test('spawns the native CLI with a fixed session id, highest permission, and no inherited session markers', async () => {
  let launch;
  await withRig({ spawn: (file, args, options) => { launch = { file, args, options }; return fakePty(); } },
    async ({ host, events, f }) => {
      const result = await host.start({ root: f.root, sessionId: UUID, model: 'glm-test' });
      assert.equal(result.ok, true);
      assert.ok(launch.file.endsWith('claude.exe') || launch.file.endsWith('claude'), 'must resolve the native executable');
      assert.deepEqual(launch.args, ['--session-id', UUID, '--dangerously-skip-permissions', '--model', 'glm-test']);
      assert.equal(launch.options.cwd, f.root);
      assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, undefined, 'must not regress Electron to plain Node');
      // 继承的子会话标记会让 claude 关闭 transcript 落盘（分析结果永远读不到）
      for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PID']) {
        assert.equal(launch.options.env[k], undefined, `${k} must not leak into the spawned claude`);
      }
      assert.equal(host.write({ data: 'ls\r' }).ok, true);
      assert.ok(events.some(e => e.type === 'data'), 'pty output must be relayed');
      assert.deepEqual(host.start({ root: f.root, sessionId: 'nope' }), { ok: false, error: '会话 ID 无效' });
    });
});

test('relaunching an existing session resumes it instead of reusing --session-id', async () => {
  const launches = [];
  await withRig({ spawn: (file, args) => { launches.push(args); return fakePty(); } },
    async ({ host, file, f }) => {
      await host.start({ root: f.root, sessionId: UUID });
      assert.deepEqual(launches[0].slice(0, 2), ['--session-id', UUID], 'fresh session pins its id');
      // 模拟 CLI 已把会话落盘
      appendFileSync(file, userLine('hi'));
      await host.start({ root: f.root, sessionId: OTHER }); // switch away
      await host.start({ root: f.root, sessionId: OTHER }); // same session again: idempotent
      assert.equal(launches.length, 2, 'same session must reuse the pty');
      await host.start({ root: f.root, sessionId: UUID }); // back → must resume
      assert.ok(launches.at(-1).includes('--resume'), 'existing session must resume, not collide on --session-id');
      assert.ok(!launches.at(-1).includes('--session-id'), 'no --session-id when the file exists');
      assert.ok(launches.at(-1).includes('--dangerously-skip-permissions'));
    });
});

test('restarting the same session is idempotent; switching swaps the pty', async () => {
  const ptys = [];
  await withRig({ spawn: () => { const p = fakePty(); ptys.push(p); return p; } }, async ({ host, f }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal((await host.start({ root: f.root, sessionId: UUID })).restarted, false, 'same session must reuse the pty');
    assert.equal(ptys.length, 1);
    await host.start({ root: f.root, sessionId: OTHER });
    assert.equal(ptys.length, 2, 'switching sessions must spawn a fresh pty');
  });
});

test('analysis injects a bracketed paste and extracts the contract from its own turn in the session log', async () => {
  await withRig({}, async ({ host, events, file, f, pty, flush, pump }) => {
    writeFileSync(file, userLine('历史消息'));
    await host.start({ root: f.root, sessionId: UUID });
    const analysis = host.analyze({ entryRel: 'src/views/Order.vue', backendRel: 'backend', sessionId: UUID });
    assert.equal(analysis.ok, true);
    const injected = pty().written.at(-1);
    assert.ok(injected.startsWith('\x1b[200~'), 'multi-line prompt must be bracketed so newlines do not submit early');
    assert.ok(injected.endsWith('\x1b[201~\r'));
    assert.ok(injected.includes('src/views/Order.vue'));
    assert.ok(injected.includes('最高权限'));
    assert.deepEqual(host.analyze({ entryRel: 'x' }), { ok: false, error: '当前会话已有分析在进行' });

    // 模拟 CLI 落盘：先写入用户提示词记录（本次分析的界碑），再流式块，最后 end_turn 收尾
    appendFileSync(file, userLine(pastedPrompt(pty())));
    appendFileSync(file, assistantLine([textBlock('正在阅读项目…')], 'tool_use'));
    flush();
    assert.equal(analysisEvents(events).length, 0, 'still streaming: must not settle');
    appendFileSync(file, assistantLine([{ type: 'thinking', thinking: '…' }]));   // 最终消息的 thinking 块
    flush();
    pump(2000);
    assert.equal(analysisEvents(events).length, 0, 'an end_turn line without text must not settle early');
    appendFileSync(file, assistantLine([textBlock(contractText)]));
    flush();
    pump(1600);
    const done = analysisEvents(events)[0];
    assert.ok(done?.ok, 'analysis must complete with a contract');
    assert.equal(done.sessionId, UUID, 'the result must name the session that was analyzed');
    assert.equal(done.data.functions[0].name, '查询');
    assert.equal(done.data.functions[0].url, '/api/list');
  });
});

test('an earlier turn still streaming when analysis starts does not end the analysis', async () => {
  await withRig({}, async ({ host, events, file, f, pty, flush, pump }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    // 点击分析时 TUI 正在输出上一轮：它的收尾（带 end_turn）在界碑之前落盘，不算数
    appendFileSync(file, assistantLine([textBlock('上一轮的输出')]));
    flush();
    for (let i = 0; i < 7; i++) pump(5000);
    assert.equal(analysisEvents(events).length, 0, 'the previous turn must not be mistaken for the analysis turn');
    // 之后才是本次分析的提示词与回复
    appendFileSync(file, userLine(pastedPrompt(pty())) + assistantLine([textBlock(contractText)]));
    flush();
    pump(1600);
    assert.equal(analysisEvents(events)[0]?.ok, true);
  });
});

test('only the user record of the pasted prompt is the turn boundary', async () => {
  await withRig({}, async ({ host, events, file, f, pty, flush, pump }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    const prompt = pastedPrompt(pty());
    // 真实日志里同一轮还会写出含相同文本的 last-prompt 记录。它没有 message 字段，
    // 但若哪天带上了（或匹配逻辑放宽到整个条目），一段无关输出就会被当成分析回复。
    appendFileSync(file, JSON.stringify({ type: 'last-prompt', message: { role: 'user', content: prompt }, lastPrompt: prompt, leafUuid: 'x' }) + '\n' +
      assistantLine([textBlock('与本次分析无关的输出')]));
    flush();
    pump(60_000);
    assert.equal(analysisEvents(events).length, 0, 'a last-prompt record must not start the analysis turn');
    appendFileSync(file, userLine(prompt) + assistantLine([textBlock(contractText)]));
    flush();
    pump(1600);
    assert.equal(analysisEvents(events)[0]?.ok, true, 'the marker sits mid-record inside <pasted_content>; includes() must find it');
  });
});

test('a turn that ends without any text fails only after the grace period', async () => {
  await withRig({}, async ({ host, events, file, f, pty, flush, pump }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    appendFileSync(file, userLine(pastedPrompt(pty())) + assistantLine([{ type: 'thinking', thinking: '…' }]));
    flush();
    pump(29_000);
    assert.equal(analysisEvents(events).length, 0, 'must wait for the text block instead of failing early');
    pump(1500);
    const failed = analysisEvents(events)[0];
    assert.ok(!failed?.ok);
    assert.match(failed.error, /解析/);
  });
});

test('a transcript that never grows after injection produces a hint, not a failure', async () => {
  await withRig({}, async ({ host, events, file, f, pty, flush, pump }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    pump(19_000);
    assert.equal(events.filter(e => e.type === 'hint').length, 0);
    pump(1500);
    const hint = events.find(e => e.type === 'hint');
    assert.ok(hint, 'a silent transcript must be reported');
    assert.equal(hint.sessionId, UUID);
    assert.equal(analysisEvents(events).length, 0, 'a hint must not abort the analysis');
    // 日志随后恢复写入：分析照常完成
    appendFileSync(file, userLine(pastedPrompt(pty())) + assistantLine([textBlock(contractText)]));
    flush();
    pump(1600);
    assert.equal(analysisEvents(events)[0]?.ok, true);
  });
});

test('cancel drops the pending analysis; the next analysis starts at once and ignores the cancelled turn', async () => {
  await withRig({}, async ({ host, events, file, f, pty, flush, pump }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    const cancelledPrompt = pastedPrompt(pty(), 'a1');
    appendFileSync(file, userLine(cancelledPrompt) + assistantLine([textBlock('写到一半的输出')], 'tool_use'));
    flush();
    assert.equal(host.cancel().ok, true);
    assert.equal(pty().written.at(-1), '\x1b', 'cancel must send Esc, the native interrupt key');
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true, 'a new analysis must not be rejected as "already in progress"');
    const nextPrompt = pastedPrompt(pty(), 'a2');
    assert.notEqual(nextPrompt, cancelledPrompt, 'each analysis gets its own marker');
    // 被取消那一轮迟到的收尾（可能带 end_turn）不能让新的分析提前结束
    appendFileSync(file, assistantLine([textBlock(contractText)]));
    flush();
    pump(2000);
    assert.equal(analysisEvents(events).length, 0);
    appendFileSync(file, userLine(nextPrompt) + assistantLine([textBlock(contractText)]));
    flush();
    pump(1600);
    assert.equal(analysisEvents(events)[0]?.ok, true);
  });
});

test('switching sessions mid-analysis reports the analyzed session by id and never relays stale pty output', async () => {
  const ptys = [];
  await withRig({ spawn: () => { const p = fakePty(); ptys.push(p); return p; } },
    async ({ host, events, file, f }) => {
      writeFileSync(file, userLine('历史消息'));
      await host.start({ root: f.root, sessionId: UUID });
      assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
      await host.start({ root: f.root, sessionId: OTHER });   // 用户切到另一个菜单：PTY 被替换，分析被打断
      const aborted = analysisEvents(events)[0];
      assert.ok(aborted && !aborted.ok);
      assert.equal(aborted.sessionId, UUID, 'the abort must be attributed to the session that was analyzing');
      assert.match(aborted.error, /中止/);
      const relayed = events.filter(e => e.type === 'data').length;
      ptys[0].emit('旧终端的尾包输出');            // 旧 PTY 被杀后仍可能吐出的数据
      assert.equal(events.filter(e => e.type === 'data').length, relayed, 'stale output must not reach the new terminal');
      host.write({ data: 'hi' });                  // 新 PTY 的输出照常转发
      assert.equal(events.filter(e => e.type === 'data').length, relayed + 1);
    });
});

test('a late exit from a replaced pty is ignored', async () => {
  const ptys = [];
  await withRig({ spawn: () => { const p = fakePty({ deferredKill: true }); ptys.push(p); return p; } },
    async ({ host, events, f }) => {
      await host.start({ root: f.root, sessionId: UUID });
      await host.start({ root: f.root, sessionId: OTHER });
      ptys[0].exit(1);       // 真实 node-pty 里 kill 之后的退出事件是异步到的
      assert.equal(events.filter(e => e.type === 'exit').length, 0, 'the new terminal must not be reported as exited');
      assert.equal(host.snapshot()?.sessionId, OTHER);
    });
});

test('analyze refuses when the terminal belongs to another session', async () => {
  await withRig({}, async ({ host, f }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.deepEqual(host.analyze({ entryRel: 'a.vue', sessionId: OTHER }),
      { ok: false, error: '终端会话与当前组件不一致，请重试' });
    assert.equal(host.analyze({ entryRel: 'a.vue', sessionId: UUID }).ok, true);
  });
});

test('pty exit during analysis surfaces an error instead of hanging', async () => {
  await withRig({}, async ({ host, events, f, pty }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    pty().kill();
    const failed = analysisEvents(events)[0];
    assert.ok(!failed?.ok);
    assert.match(failed.error, /退出|结束/);
    assert.ok(events.some(e => e.type === 'exit'));
  });
});

test('a rewritten (shrinking) session log aborts the analysis instead of re-reading history', async () => {
  await withRig({}, async ({ host, events, file, f, flush }) => {
    writeFileSync(file, userLine('历史消息'));
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    truncateSync(file, 10);           // 日志被重写变短，而不是追加
    flush();
    const failed = analysisEvents(events)[0];
    assert.ok(!failed?.ok);
    assert.match(failed.error, /重写/);
  });
});

test('a multi-byte character split across two reads is reassembled', async () => {
  await withRig({}, async ({ host, events, file, f, pty, flush, pump }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    const bytes = Buffer.from(userLine(pastedPrompt(pty())) + assistantLine([textBlock(contractText)]));
    const cutAt = bytes.indexOf(Buffer.from('【')) + 1;      // 切在「【」的三个字节中间
    assert.ok(cutAt > 0);
    appendFileSync(file, bytes.subarray(0, cutAt));
    flush();
    appendFileSync(file, bytes.subarray(cutAt));
    flush();
    pump(1600);
    const done = analysisEvents(events)[0];
    assert.ok(done?.ok);
    assert.equal(done.data.functions[0].name, '查询');
  });
});

test('malformed model output is normalized instead of throwing', async () => {
  await withRig({}, async ({ host, events, file, f, pty, flush, pump }) => {
    await host.start({ root: f.root, sessionId: UUID });
    assert.equal(host.analyze({ entryRel: 'a.vue' }).ok, true);
    const malformed = '{"functions":[{"id":"a","front":[null],"logic":[null],"params":null},{"id":"a","front":"x"},null]}';
    appendFileSync(file, userLine(pastedPrompt(pty())) + assistantLine([textBlock(malformed)]));
    flush();
    pump(1600);
    const done = analysisEvents(events)[0];
    assert.ok(done?.ok);
    assert.deepEqual(done.data.functions.map(x => x.id), ['a', 'a_2', 'fn2']);
    assert.deepEqual(done.data.functions[0].front, [{ t: 'vue', n: '', s: '' }]);
    assert.deepEqual(done.data.functions[0].logic, [{ t: 'logic', n: '', where: '', branch: false, tx: null }]);
  });
});
