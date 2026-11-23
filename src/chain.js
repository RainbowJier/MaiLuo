/** 链路图/链路条的纯数据构建（与 UI demo 同一套配色与布局算法） */

export const NODE_STYLE = {
  vue:  { bg: '#FFFFFF', border: '#D97757', bw: 2.5, label: '#C15F3C' },
  api:  { bg: '#C99B7A' },
  http: { bg: '#83827D' },
  check:{ bg: '#B08034' },
  logic:{ bg: '#D97757' },
  data: { bg: '#5A6E8C' },
  err:  { bg: '#B54A35', label: '#B54A35' },
};
/** HTTP 节点统一使用 GET 的绿色（不再按方法着色） */
export const METHOD_COLOR = { get: '#5F7D58', post: '#5F7D58', put: '#5F7D58', delete: '#5F7D58' };
export const BAR_LETTER = { vue: 'V', api: 'A', http: 'M' };
export const BAR_TITLE = { vue: 'Vue 事件函数', api: 'API 封装', http: 'HTTP 请求', check: '参数校验', logic: '业务逻辑', data: '数据读写' };

export const seq = fn => [...(fn.front || []), ...(fn.logic || [])];
/** 图节点标签截断（完整文案保留在 tooltip / 下方链路卡） */
export const cut = (s, n = 12) => {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n) + '…' : t;
};
export const stepLoc = s => s.s || s.where || '';
export const paramSummary = fn => {
  const p = fn.params || {}; const parts = [];
  if (p.path?.length)  parts.push('Path: '  + p.path.map(i => i.name).join(', '));
  if (p.query?.length) parts.push('Query: ' + p.query.map(i => i.name).join(', '));
  if (p.body?.length)  parts.push('Body: '  + p.body.map(i => i.name).join(', '));
  return parts.join(' · ');
};

export function baseNode(name, x, y, size, type, extra = {}) {
  const st = NODE_STYLE[type] || {};
  return {
    name, x, y, symbolSize: size, draggable: true,
    itemStyle: { color: extra.bg || st.bg, borderColor: st.border || extra.bg || st.bg, borderWidth: st.bw || 0 },
    label: {
      show: true, position: extra.pos || 'bottom', distance: 6,
      color: extra.labelColor || st.label || '#1F1E1D', fontSize: extra.fSize || 11,
      fontFamily: "'Cascadia Code', Consolas, monospace", fontWeight: 500,
      formatter: extra.short || name
    },
    tip: extra.tip || ''
  };
}
export function baseLink(s, t, label, opt = {}) {
  return {
    source: s, target: t, value: label,
    lineStyle: { color: opt.color || '#B3B0A6', width: opt.w || 1.8, curveness: opt.c || 0.08, type: opt.type || 'solid' },
    label: { show: opt.showLabel !== false, fontSize: 10, color: opt.labelColor || '#83827D', formatter: '{c}' }
  };
}
export function chartOption(nodes, links) {
  return {
    backgroundColor: '#FAF9F5',
    animationDuration: 800,
    animationEasing: 'cubicOut',
    tooltip: {
      trigger: 'item', backgroundColor: '#FFFFFF', borderColor: '#E3E0D6',
      textStyle: { color: '#1F1E1D', fontSize: 12 },
      extraCssText: 'box-shadow: 0 2px 8px rgba(60,50,30,0.1); border-radius: 8px; white-space: pre-wrap;',
      formatter: p => p.dataType === 'edge'
        ? `${p.data.source} → ${p.data.target}<br/><b>${p.data.value || ''}</b>`
        : `<b>${p.name}</b>` + (p.data.tip ? `<br/><span style="color:#83827D">${p.data.tip}</span>` : '')
    },
    series: [{
      type: 'graph', layout: 'none', roam: true,
      edgeSymbol: ['none', 'arrow'], edgeSymbolSize: [0, 7],
      emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
      data: nodes, links
    }]
  };
}

/** 全部功能：泳道总览 */
export function buildAllGraph(functions, width = 900) {
  const nodes = [], links = [];
  const entryName = 'entry.vue';
  const httpX = 280, startX = 460;
  // 按容器宽度收口逻辑点间距，避免最右一列贴边被裁
  const maxLogic = Math.max(1, ...functions.map(f => (f.logic || []).length));
  const gap = Math.max(96, Math.min(150, (width - startX - 80) / Math.max(1, maxLogic - 1)));
  const laneH = 120;
  nodes.push(baseNode(entryName, 80, (functions.length - 1) * laneH / 2 + 70, 50, 'vue'));
  functions.forEach((fn, li) => {
    const y = 70 + li * laneH;
    const tail = fn.url.split('/').filter(Boolean).pop() || '/';
    const httpName = `${fn.id}::${fn.method.toUpperCase()} ${tail}`;
    nodes.push(baseNode(httpName, httpX, y, 42, 'http', {
      bg: METHOD_COLOR[fn.method],
      short: `${fn.name}\n${fn.method.toUpperCase()} ${tail}`,
      tip: `${fn.url}<br>${paramSummary(fn)}`
    }));
    links.push(baseLink(entryName, httpName, fn.method.toUpperCase(), { showLabel: false }));
    let prev = httpName;
    (fn.logic || []).forEach((step, i) => {
      const name = `${fn.id}:${i}:${step.n}`;
      nodes.push(baseNode(name, startX + i * gap, y, 38, step.t, {
        short: cut(step.n, 11),
        tip: step.where,
        pos: i % 2 === 0 ? 'bottom' : 'top',   // 上下交错，避免相邻标签压字
        fSize: 10.5
      }));
      links.push(baseLink(prev, name, '', { showLabel: false }));
      prev = name;
    });
  });
  return { nodes, links };
}

/** 单功能：前端三段 + 逻辑点 水平链（标签上下交错） */
export function buildFnGraph(fn) {
  const nodes = [], links = [];
  const main = seq(fn);
  const N = main.length || 1;
  const startX = 80, gap = Math.min(150, 1150 / Math.max(1, N - 1));
  const yMid = 170;
  main.forEach((step, i) => {
    let bg;
    if (step.t === 'http') bg = METHOD_COLOR[fn.method];
    const name = `${i}. ${step.n}`;
    const pos = i % 2 === 0 ? 'bottom' : 'top';
    nodes.push(baseNode(name, startX + i * gap, yMid, step.t === 'vue' ? 48 : 40, step.t, {
      bg, tip: stepLoc(step), short: cut(step.n, 14), pos, fSize: 10.5
    }));
    if (i > 0) {
      const edgeLabel = i === 1 ? '调用' : (i === 2 ? fn.method.toUpperCase() : '');
      links.push(baseLink(`${i - 1}. ${main[i - 1].n}`, name, edgeLabel, { c: 0.05, showLabel: !!edgeLabel }));
    }
  });
  (fn.logic || []).forEach((step, i) => {
    if (!step.branch) return;
    const srcIdx = (fn.front || []).length + i;
    const srcName = `${srcIdx}. ${step.n}`;
    const errName = `✗ ${step.n}失败`;
    if (!nodes.find(n => n.name === errName)) {
      nodes.push(baseNode(errName, startX + srcIdx * gap, yMid + 150, 30, 'err', { short: '✗ 中断 →\n异常返回' }));
    }
    links.push(baseLink(srcName, errName, '✗ 失败', { c: 0.12, color: '#C96A54', type: 'dashed', labelColor: '#B54A35' }));
  });
  return { nodes, links };
}
