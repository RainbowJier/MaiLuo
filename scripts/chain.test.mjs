import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAllGraph, buildFnGraph, chartOption, escapeHtml } from '../src/chain.js';

/** 功能名、URL、来源行号全部来自模型输出（也就是来自被分析项目的源码） */
const HOSTILE = {
  id: 'x', name: '<img src=x onerror=alert(1)>', method: 'get', url: '/api/<script>alert(1)</script>?a=<b>',
  desc: '', tag: ['success', 'ok'],
  front: [
    { t: 'vue', n: 'handle()', s: 'A.vue · <i>1</i>' },
    { t: 'api', n: 'api()', s: 'b.js · 2' },
    { t: 'http', n: 'GET /x', s: 'q' }
  ],
  params: { path: [{ name: '<b>id</b>' }], query: [], body: [] },
  logic: [{ t: 'check', n: '校验', where: 'A.b() · "<svg onload=alert(1)>"', branch: false, tx: null }],
  branchText: [], clsCount: 1
};
/** tooltip 里我们自己拼的骨架标签：节点名加粗、换行、灰色说明文字 */
const SKELETON = /<\/?(?:b|br|span)\b[^>]*>/g;
const hasForeignMarkup = html => /<[a-z!/]/i.test(html.replace(SKELETON, ''));

test('escapeHtml escapes markup and leaves plain text alone', () => {
  assert.equal(escapeHtml('Order.vue · 12'), 'Order.vue · 12');
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(escapeHtml(undefined), '');
});

// tooltip 由 ECharts 以 innerHTML 渲染，而渲染进程里的 window.api 能往一个免确认的 Claude 终端打字：
// 模型输出里混进 HTML，就等于被分析项目里的任意文本可以获得代码执行。
const checkGraph = graph => {
  const formatter = chartOption(graph.nodes, graph.links).tooltip.formatter;
  let sawEscapedName = false, sawLineBreak = false;
  for (const n of graph.nodes) {
    const html = formatter({ dataType: 'node', name: n.name, data: n });
    // 节点名必须原样转义后输出（既不能原样输出，也不能被丢掉）
    assert.equal(html, `<b>${escapeHtml(n.name)}</b>` + (n.tip ? `<br/><span style="color:#83827D">${n.tip}</span>` : ''));
    assert.ok(!hasForeignMarkup(n.tip || ''), `unescaped markup in tooltip: ${n.tip}`);
    if (/[<>]/.test(n.name)) sawEscapedName = true;
    if (n.tip.includes('<br>')) sawLineBreak = true;
  }
  const edge = formatter({ dataType: 'edge', data: { source: '<x>', target: '<y>', value: '<z>' } });
  assert.equal(edge, '&lt;x&gt; → &lt;y&gt;<br/><b>&lt;z&gt;</b>');
  return { sawEscapedName, sawLineBreak };
};

test('overview graph tooltips never contain model-provided markup', () => {
  const graph = buildAllGraph([HOSTILE], 900);
  assert.ok(graph.nodes.length >= 3);
  const { sawEscapedName, sawLineBreak } = checkGraph(graph);
  assert.ok(sawEscapedName, 'the http node name carries the hostile url');
  assert.ok(sawLineBreak, 'the <br> we compose ourselves stays a line break');
  assert.ok(graph.nodes.some(n => (n.tip || '').includes('&lt;script&gt;alert(1)&lt;/script&gt;')), 'hostile url is escaped');
  assert.ok(graph.nodes.some(n => (n.tip || '').includes('&lt;svg onload=alert(1)&gt;')), 'hostile source anchor is escaped');
});

test('single-function graph tooltips never contain model-provided markup', () => {
  const graph = buildFnGraph(HOSTILE);
  checkGraph(graph);
  assert.ok(graph.nodes.some(n => (n.tip || '').includes('A.vue · &lt;i&gt;1&lt;/i&gt;')), 'hostile source location is escaped');
});

test('graph builders still lay out nodes and links for normal data', () => {
  const fn = { ...HOSTILE, id: 'list', name: '查询', url: '/api/list', method: 'get',
    front: HOSTILE.front.map(s => ({ ...s, s: 'A.vue · 1' })), params: { path: [], query: [], body: [] },
    logic: [{ t: 'check', n: '校验权限', where: 'A.b() · 5', branch: true, tx: null }] };
  const all = buildAllGraph([fn, { ...fn, id: 'add', name: '新增', method: 'post', url: '/api/add', logic: [] }], 900);
  assert.equal(all.nodes.length, 1 + 2 + 1, 'entry + one http node per function + one logic node');
  assert.equal(all.links.length, 2 + 1);
  const single = buildFnGraph(fn);
  assert.equal(single.nodes.length, 3 + 1 + 1, 'front + logic + error node');
  assert.ok(single.nodes.some(n => n.name === '✗ 校验权限失败'));
});
