import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveClaudeExecutable, createClaudeTurn, createClaudeWorkspace } from '../electron/main/claude-workspace.mjs';

function fakeProcess() {
  const child = new EventEmitter();
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 123, exitCode: null });
  child.commands = [];
  child.stdin.on('data', data => { for (const line of String(data).trim().split('\n')) child.commands.push(JSON.parse(line)); });
  child.kill = () => { child.killed = true; child.exitCode = 0; queueMicrotask(() => child.emit('close', 0)); };
  return child;
}
const emitLine = (child, value) => child.stdout.write(JSON.stringify(value) + '\n');

// No real CLI or paid model calls are used in these tests.
test('relative PATH resolves to an absolute validated executable', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mailuo-cli-'));
  try {
    mkdirSync(path.join(dir, 'bin'));
    const file = path.join(dir, 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
    writeFileSync(file, 'fixture');
    if (process.platform !== 'win32') chmodSync(file, 0o700);
    const result = resolveClaudeExecutable({ PATH: path.relative(process.cwd(), path.dirname(file)) });
    assert.equal(result, path.resolve(file));
    assert.ok(path.isAbsolute(result));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('initializes stdio, keeps Chinese text intact, and deduplicates partial/final text IDs', () => {
  const child = fakeProcess(), events = [];
  let launch;
  const turn = createClaudeTurn({ root: process.cwd(), text: '解释组件', model: 'glm-test', executable: 'claude-test',
    emit: e => events.push(e), spawnProcess: (...args) => { launch = args; return child; } });
  assert.equal(launch[2].shell, false);
  assert.ok(!launch[1].includes('--dangerously-skip-permissions'));
  assert.ok(launch[1].includes('--permission-prompt-tool'), 'chat turns must ask via stdio permission cards');
  assert.deepEqual(launch[1].slice(launch[1].indexOf('--model'), launch[1].indexOf('--model') + 2), ['--model', 'glm-test'],
    'requested model must be forwarded to the CLI');
  assert.ok(!launch[1].includes('--tools'), 'analysis must keep the same installed native Claude Code tool configuration');
  assert.equal(child.commands[0].request.subtype, 'initialize');
  assert.equal(child.commands.length, 1);
  emitLine(child, { type: 'control_response', response: { subtype: 'success', request_id: child.commands[0].request_id, response: {} } });
  assert.equal(child.commands[1].message.content[0].text, '解释组件');
  emitLine(child, { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
  emitLine(child, { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'private' } } });
  emitLine(child, { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } });
  const bytes = Buffer.from(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '你好' } } }) + '\n');
  const split = bytes.indexOf(Buffer.from('你')) + 1;
  child.stdout.write(bytes.subarray(0, split)); child.stdout.write(bytes.subarray(split));
  emitLine(child, { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'private' }] } });
  emitLine(child, { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: '你好' }] } });
  assert.equal(events.filter(e => e.kind === 'text').at(-1).id, 'm1:1');
  assert.equal(events.filter(e => e.kind === 'text').length, 2);
  assert.equal(events.filter(e => e.kind === 'text').at(-1).text, '你好');
  assert.ok(!JSON.stringify(events).includes('private'));
  turn.stop();
});

test('analysis turns run with highest permission and never prompt', () => {
  const child = fakeProcess();
  let launch;
  createClaudeTurn({ root: process.cwd(), text: '分析组件', autoApprove: true, executable: 'claude-test',
    emit: () => {}, spawnProcess: (...args) => { launch = args; return child; } });
  assert.ok(launch[1].includes('--dangerously-skip-permissions'), 'analysis must bypass permission prompts');
  assert.ok(!launch[1].includes('--permission-prompt-tool'), 'analysis must not register a prompt tool');
  assert.ok(!launch[1].includes('--permission-mode'), 'analysis must not fall back to manual mode');
  child.kill();
});

test('approvals round-trip exact input; denial and repeated/stale requests are handled', () => {
  const child = fakeProcess(), events = [];
  const turn = createClaudeTurn({ root: process.cwd(), text: 'task', executable: 'test', emit: e => events.push(e), spawnProcess: () => child });
  const request = { type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'dir' } } };
  emitLine(child, request); emitLine(child, request);
  assert.equal(events.filter(e => e.kind === 'permission').length, 1);
  turn.respond('p1', false);
  assert.equal(child.commands.at(-1).response.response.behavior, 'deny');
  assert.throws(() => turn.respond('p1', true), /过期/);
  emitLine(child, { ...request, request_id: 'p2' });
  turn.respond('p2', true);
  assert.deepEqual(child.commands.at(-1).response.response.updatedInput, { command: 'dir' });
  emitLine(child, { ...request, request_id: 'p3', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: '选择？' }] } } });
  turn.respond('p3', true, { '选择？': 'A' });
  assert.deepEqual(child.commands.at(-1).response.response.updatedInput.answers, { '选择？': 'A' });
  turn.stop();
  assert.equal(child.killed, true);
});

test('final buffered result is parsed, and unexpected exits become visible errors', () => {
  const child = fakeProcess(), events = [];
  createClaudeTurn({ root: process.cwd(), text: 'task', executable: 'test', emit: e => events.push(e), spawnProcess: () => child });
  child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: '完成' }));
  child.emit('close', 0);
  assert.equal(events.find(e => e.kind === 'text').text, '完成');
  assert.equal(events.filter(e => e.kind === 'end').length, 1);
  const crashed = fakeProcess(), failures = [];
  createClaudeTurn({ root: process.cwd(), text: 'task', executable: 'test', emit: e => failures.push(e), spawnProcess: () => crashed });
  crashed.emit('close', 7);
  assert.match(failures.find(e => e.kind === 'end').error, /7/);
});

test('project sessions resume native IDs; stopped requests expire, data survives reload', async () => {
  let disk, spec, stopped = false;
  const workspace = createClaudeWorkspace({ load: () => null, save: data => { disk = data; }, notify: () => {},
    makeTurn: options => { spec = options; return { pending: [], respond() {}, stop() { stopped = true; options.emit({ kind: 'end' }); } }; } });
  const { session } = await workspace.create({ root: process.cwd(), analysisKey: 'analysis-1' });
  assert.equal((await workspace.create({ root: process.cwd(), analysisKey: 'analysis-1' })).session.id, session.id);
  await workspace.analyze({ id: session.id, analysisSessionId: 1, entryRel: 'src/views/App.vue' });
  assert.equal(spec.autoApprove, true, 'analysis must request highest permission');
  assert.ok(spec.text.includes('最高权限'));
  assert.ok(spec.text.includes('最后一条消息中只输出一个'));
  spec.emit({ kind: 'init', cliSessionId: 'native-id', model: 'local-model' });
  spec.emit({ kind: 'text', id: 'analysis-answer', text: JSON.stringify({ file: 'App.vue', functions: [{ id: 'list', name: '查询', method: 'get', url: '/api/list', front: [], logic: [] }] }), replace: true });
  spec.emit({ kind: 'end' });
  const analyzed = (await workspace.snapshot()).sessions[0];
  assert.equal(analyzed.analysis.status, 'done');
  assert.equal(analyzed.analysis.sessionId, 1);
  assert.equal(analyzed.analysis.data.functions[0].name, '查询');
  await workspace.send({ id: session.id, text: '第一轮', model: 'm-x' });
  assert.notEqual(spec.autoApprove, true, 'chat turns must keep per-action confirmation');
  assert.equal(spec.model, 'm-x', 'send must forward the requested model');
  await assert.rejects(workspace.send({ id: session.id, text: '重复请求' }), /正在运行/);
  spec.emit({ kind: 'text', id: 'answer', text: '第一', replace: true });
  spec.emit({ kind: 'text', id: 'answer', text: '轮', replace: false });
  spec.emit({ kind: 'text', id: 'answer', text: '第一轮', replace: true });
  spec.emit({ kind: 'end' });
  const first = (await workspace.snapshot()).sessions[0];
  assert.equal(first.messages.filter(m => m.role === 'assistant' && m.id === 'answer').length, 1);
  assert.equal(first.messages.find(m => m.id === 'answer').text, '第一轮');
  await workspace.send({ id: session.id, text: '第二轮', contextFile: '..notes.vue' });
  assert.equal(spec.resume, 'native-id');
  assert.ok(spec.text.includes('..notes.vue'));
  await workspace.stop({ id: session.id });
  assert.equal(stopped, true);
  assert.equal((await workspace.snapshot()).sessions[0].status, 'interrupted');
  await assert.rejects(workspace.respond({ id: session.id, requestId: 'old', allow: true }), /已停止/);
  await assert.rejects(workspace.send({ id: session.id, text: 'x', contextFile: '../outside' }), /目录内/);
  await assert.rejects(workspace.send({ id: session.id, text: 'x', model: 'has space' }), /无效的模型/);
  await workspace.dispose();
  const restored = createClaudeWorkspace({ load: () => disk, save: () => {}, notify: () => {} });
  assert.equal((await restored.snapshot()).sessions[0].cliSessionId, 'native-id');
  await restored.dispose();
});
