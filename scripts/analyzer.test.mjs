import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, extractJson, normalizeContract } from '../electron/main/analyzer.mjs';

const CONTRACT = { file: 'Order.vue', functions: [{ id: 'list', name: '查询', method: 'get', url: '/api/list', front: [], logic: [] }] };
const json = JSON.stringify(CONTRACT);

test('buildPrompt names the entry file, the backend root, and the read-only rule', () => {
  const prompt = buildPrompt('frontend/src/views/Order.vue', 'backend');
  assert.ok(prompt.includes('frontend/src/views/Order.vue'));
  assert.ok(prompt.includes('backend'));
  assert.match(prompt, /"functions"/);
});

test('extractJson reads a fenced json block', () => {
  assert.deepEqual(extractJson('分析完成：\n```json\n' + json + '\n```\n以上。'), CONTRACT);
  assert.deepEqual(extractJson('```\n' + json + '\n```'), CONTRACT, 'language tag is optional');
  assert.deepEqual(extractJson('```JSON\n' + json + '\n```'), CONTRACT, 'language tag is case-insensitive');
});

test('extractJson reads bare JSON that follows prose with stray braces and quotes', () => {
  // 模型常不按要求的代码块输出，而是直接贴 JSON；前面的叙述里出现孤立括号/引号很常见
  assert.deepEqual(extractJson('请求参数放在 body { year, statuses }，方法为 "POST"。\n' + json), CONTRACT);
  assert.deepEqual(extractJson('先看 {id} 对应的接口：\n' + json + '\n以上。'), CONTRACT);
  assert.deepEqual(extractJson('参数 { year 不填时取当前年度。\n' + json), CONTRACT, 'an unclosed brace in prose must not swallow the contract');
  assert.deepEqual(extractJson('示例 {"a":1} 不是契约。\n' + json), CONTRACT, 'an earlier small object is skipped');
  assert.deepEqual(extractJson(json), CONTRACT, 'no prose at all');
});

test('extractJson tolerates trailing commas and prefers the last valid block', () => {
  const sloppy = '{"file":"Order.vue","functions":[{"id":"list","front":[],"logic":[],},],}';
  assert.deepEqual(extractJson(sloppy), { file: 'Order.vue', functions: [{ id: 'list', front: [], logic: [] }] });
  const two = '```json\n{"hello":1}\n```\n说明\n```json\n' + json + '\n```';
  assert.deepEqual(extractJson(two), CONTRACT);
});

test('extractJson returns null when there is no contract', () => {
  assert.equal(extractJson(''), null);
  assert.equal(extractJson('没有 JSON 的回复'), null);
  assert.equal(extractJson('{"functions":[]}'), null, 'an empty contract is not a result');
  assert.equal(extractJson('{"functions":"x"}'), null);
  assert.deepEqual(extractJson('先给个空壳 {"functions":[]}，正式结果：\n' + json), CONTRACT,
    'an empty skeleton must not shadow the real contract');
  // 被截断的 JSON：不能把半截对象当成结果
  assert.equal(extractJson(json.slice(0, json.length - 12)), null);
});

test('extractJson stays fast on pathological unbalanced input', () => {
  const t0 = Date.now();
  assert.equal(extractJson('{'.repeat(300_000)), null);
  assert.equal(extractJson('{"a":'.repeat(100_000)), null);
  assert.deepEqual(extractJson('{x}'.repeat(100_000) + json), CONTRACT, 'bounded scanning still finds the contract after noise');
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 3000, `must not block the main process (took ${elapsed}ms)`);
});

test('normalizeContract fills defaults for a well-formed contract', () => {
  const data = normalizeContract(CONTRACT);
  assert.equal(data.file, 'Order.vue');
  assert.deepEqual(data.functions[0], {
    id: 'list', name: '查询', method: 'get', url: '/api/list', desc: '',
    tag: ['success', '链路完整'], front: [], params: { path: [], query: [], body: [] },
    logic: [], branchText: [], clsCount: 0
  });
});

test('normalizeContract never throws on null / non-object elements', () => {
  // 这里跑在主进程定时器里：抛异常会触发 Electron 的错误弹窗，并且每个 tick 弹一次
  const data = normalizeContract({ functions: [
    { id: 'a', front: [null, 'x', 3], logic: [null], params: null, tag: 'x', branchText: [null, 1] },
    null,
    { name: '新增', method: 'POST', url: '/a', clsCount: 'n' }
  ] });
  assert.equal(data.functions.length, 3);
  assert.deepEqual(data.functions[0].front, [
    { t: 'vue', n: '', s: '' }, { t: 'vue', n: '', s: '' }, { t: 'vue', n: '', s: '' }
  ]);
  assert.deepEqual(data.functions[0].logic, [{ t: 'logic', n: '', where: '', branch: false, tx: null }]);
  assert.deepEqual(data.functions[0].params, { path: [], query: [], body: [] });
  assert.deepEqual(data.functions[0].tag, ['success', '链路完整']);
  assert.deepEqual(data.functions[0].branchText, ['null', '1']);
  assert.equal(data.functions[1].id, 'fn1');
  assert.equal(data.functions[1].name, '功能2');
  assert.equal(data.functions[2].method, 'post', 'an upper-case verb must not silently become get');
  assert.equal(normalizeContract({ functions: [{ id: 'a', method: 'FETCH' }] }).functions[0].method, 'get');
  assert.equal(data.functions[2].clsCount, 0);
  assert.equal(normalizeContract(null), null);
  assert.equal(normalizeContract('text'), null);
  assert.equal(normalizeContract({ functions: [] }), null);
});

test('normalizeContract makes duplicate function ids unique', () => {
  // 功能 id 被 Vue 的 key 和图节点名引用：重复会让页签/节点互相覆盖
  const data = normalizeContract({ functions: [{ id: 'list' }, { id: 'list' }, { id: 'list_2' }, {}] });
  assert.deepEqual(data.functions.map(f => f.id), ['list', 'list_2', 'list_2_2', 'fn3']);
});
