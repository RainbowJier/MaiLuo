<template>
  <div ref="area"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts';
import { S, currentFunctions, loadLayout, saveLayout, clearLayout } from '../store.js';
import { buildAllGraph, buildFnGraph, chartOption } from '../chain.js';

const area = ref(null);
let chart = null;
let dragInfo = null;
const emit = defineEmits([]);

function render() {
  if (!area.value) return;
  if (chart) { try { chart.dispose(); } catch {} chart = null; }
  const wrap = document.createElement('div');
  wrap.className = 'graph-container';
  wrap.style.height = (S.currentFn === 'all' ? Math.max(320, 70 + currentFunctions().length * 120) : 320) + 'px';
  area.value.innerHTML = '';
  area.value.appendChild(wrap);
  chart = echarts.init(wrap);

  const availW = wrap.clientWidth || 900;
  const g = S.currentFn === 'all'
    ? buildAllGraph(currentFunctions(), availW)
    : buildFnGraph(currentFunctions().find(f => f.id === S.currentFn) || currentFunctions()[0]);
  const saved = loadLayout();
  if (saved) g.nodes.forEach(n => { const p = saved[n.name]; if (p) { n.x = p.x; n.y = p.y; } });
  S.layoutDirty = false;
  S.layoutHasSaved = !!saved;
  chart.setOption(chartOption(g.nodes, g.links), true);
  chart.resize();
  attachDrag();
}

/* ---- 节点拖拽（layout:'none' 原生不支持，自实现） ---- */
function hitNode(cx, cy) {
  if (!chart) return null;
  const r = chart.getDom().getBoundingClientRect();
  const x = cx - r.left, y = cy - r.top;
  let best = null, bd = Infinity;
  chart.getOption().series[0].data.forEach((n, i) => {
    if (n.x == null) return;
    const p = chart.convertToPixel({ seriesIndex: 0 }, [n.x, n.y]);
    if (!p) return;
    const rad = (n.symbolSize || 40) / 2 + 4;
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d < rad * rad && d < bd) { bd = d; best = i; }
  });
  return best;
}
function onDown(ev) {
  if (!chart || dragInfo) return;
  const di = hitNode(ev.clientX, ev.clientY);
  if (di == null) return;
  ev.stopPropagation();
  const n = chart.getOption().series[0].data[di];
  const r = chart.getDom().getBoundingClientRect();
  dragInfo = { di, sx: ev.clientX - r.left, sy: ev.clientY - r.top, ox: n.x, oy: n.y };
  chart.getDom().style.cursor = 'grabbing';
}
function onMove(ev) {
  if (!dragInfo || !chart) return;
  const r = chart.getDom().getBoundingClientRect();
  const p0 = chart.convertFromPixel({ seriesIndex: 0 }, [dragInfo.sx, dragInfo.sy]);
  const p1 = chart.convertFromPixel({ seriesIndex: 0 }, [ev.clientX - r.left, ev.clientY - r.top]);
  if (!p0 || !p1) return;
  const data = chart.getOption().series[0].data.map((n, i) =>
    i === dragInfo.di ? { ...n, x: dragInfo.ox + p1[0] - p0[0], y: dragInfo.oy + p1[1] - p0[1] } : n);
  chart.setOption({ series: [{ data }] });
}
function onUp() {
  if (dragInfo && chart) { chart.getDom().style.cursor = ''; S.layoutDirty = true; }
  dragInfo = null;
}
function attachDrag() {
  const dom = chart.getDom();
  ['mousedown', 'pointerdown'].forEach(t => dom.addEventListener(t, onDown, true));
}

defineExpose({
  saveLayout: () => {
    if (!chart) return;
    const map = {};
    chart.getOption().series[0].data.forEach(n => { if (n.x != null) map[n.name] = { x: n.x, y: n.y }; });
    saveLayout(map);
    render();
  },
  resetLayout: () => { clearLayout(); render(); }
});

onMounted(() => {
  render();
  ['mousemove', 'pointermove'].forEach(t => window.addEventListener(t, onMove));
  ['mouseup', 'pointerup'].forEach(t => window.addEventListener(t, onUp));
  ro = new ResizeObserver(() => chart?.resize());
  ro.observe(area.value);
});
let ro = null;
onBeforeUnmount(() => {
  ['mousemove', 'pointermove'].forEach(t => window.removeEventListener(t, onMove));
  ['mouseup', 'pointerup'].forEach(t => window.removeEventListener(t, onUp));
  ro?.disconnect();
  if (chart) { try { chart.dispose(); } catch {} chart = null; }
});
</script>
