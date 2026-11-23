<template>
  <main class="detail-panel">
    <div class="detail-header">
      <div class="detail-title">
        <h1>{{ title }}</h1>
        <span class="detail-path">{{ subtitlePath }}</span>
      </div>
      <div class="detail-actions">
        <button class="btn-icon" :class="{ active: S.terminalOpen }" title="终端面板" @click="S.terminalOpen = !S.terminalOpen">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M5.5 8l2.5 2.5L5.5 13M10 13.5h4.5"/>
          </svg>
        </button>
        <button class="btn-icon" title="重置" :disabled="S.analyzing" @click="resetCurrent">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M16.5 8A6.5 6.5 0 1 0 17 12"/><path d="M17 4v4h-4"/>
          </svg>
        </button>
        <button class="btn-primary" :disabled="!canAnalyze" @click="startAnalysis">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M2.5 8s2.4-4.5 5.5-4.5S13.5 8 13.5 8s-2.4 4.5-5.5 4.5S2.5 8 2.5 8z"/><circle cx="8" cy="8" r="2"/>
          </svg>
          {{ analyzeLabel }}
        </button>
      </div>
    </div>

    <div class="detail-body">
      <!-- 待分析 / 分析中 -->
      <div v-if="!hasResult" class="pending-hero">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <path d="M4 6h16M4 12h10M4 18h13"/>
        </svg>
        <template v-if="S.analyzing">
          <span class="file-badge">{{ S.selectedFile || '…' }}</span>
          <p>Claude Code 正在阅读项目源码，实时输出见右侧终端面板</p>
          <button class="btn-ghost" @click="cancelAnalysis">取消分析</button>
        </template>
        <template v-else-if="S.selectedFile">
          <span class="file-badge">{{ fileName(S.selectedFile) }}</span>
          <p>由 Claude Code 静态阅读项目源码，按「业务功能」拆分链路</p>
          <p class="hint">前端：Vue 事件 → API 封装 → HTTP → 后端按逻辑点：校验 → 业务处理 → 数据读写</p>
          <button class="btn-primary" @click="startAnalysis">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M2.5 8s2.4-4.5 5.5-4.5S13.5 8 13.5 8s-2.4 4.5-5.5 4.5S2.5 8 2.5 8z"/><circle cx="8" cy="8" r="2"/>
            </svg>
            开始分析
          </button>
        </template>
        <template v-else>
          <p>{{ S.config.root ? '从左侧选择一个 Vue 组件开始分析' : '请先配置项目（点击左上角项目卡片）' }}</p>
        </template>
        <p v-if="sessionError" class="status-line" style="color:var(--red)">{{ sessionError }}</p>
        <p v-if="activeSession()?.claudeError" class="status-line" style="color:var(--red)">{{ activeSession().claudeError }}</p>
      </div>

      <!-- 结果 -->
      <template v-else>
        <div class="fn-tabs">
          <button class="fn-tab" :class="{ active: S.currentFn === 'all' }" @click="selectFn('all')">
            全部 <span class="cnt">{{ functions.length }}</span>
          </button>
          <button v-for="f in functions" :key="f.id" class="fn-tab"
                  :class="{ active: S.currentFn === f.id }" @click="selectFn(f.id)">
            <span class="m" :class="f.method">{{ f.method.toUpperCase() }}</span>{{ f.name }}
          </button>
        </div>

        <section class="result-section" style="position:relative">
          <div class="section-header">
            <h2>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
                <circle cx="4" cy="10" r="2.2"/><circle cx="10" cy="10" r="2.2"/><circle cx="16" cy="10" r="2.2"/>
                <path d="M6.2 10h1.6M12.2 10h1.6"/>
              </svg>
              链路可视化 <span class="sub">{{ graphSubtitle }}</span>
            </h2>
            <div class="section-actions">
              <button class="btn-icon-small" title="恢复默认布局" :disabled="!(S.layoutDirty || S.layoutHasSaved)" @click="$refs.graph.resetLayout()">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13.5 6.5A5.5 5.5 0 1 0 14 10"/><path d="M14 3.5v3h-3"/></svg>
              </button>
              <button class="btn-icon-small" title="保存当前布局" :disabled="!S.layoutDirty" @click="$refs.graph.saveLayout()">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 2.5h8l2.5 2.5v8.5H3z"/><path d="M5.5 2.5V6h5V2.5"/><path d="M5.5 13.5V9.5h5v4"/></svg>
              </button>
            </div>
          </div>
          <div class="graph-legend">
            <span class="legend-item"><span class="legend-dot" style="background:#fff;border:2px solid #D97757"></span>Vue 事件</span>
            <span class="legend-item"><span class="legend-dot" style="background:#C99B7A"></span>API 封装</span>
            <span class="legend-item"><span class="legend-dot" style="background:#5F7D58"></span>HTTP 请求</span>
            <span class="legend-item"><span class="legend-dot" style="background:#B08034"></span>参数校验</span>
            <span class="legend-item"><span class="legend-dot" style="background:#D97757"></span>业务逻辑</span>
            <span class="legend-item"><span class="legend-dot" style="background:#5A6E8C"></span>数据读写</span>
            <span class="legend-item"><span class="legend-dot" style="background:#B54A35"></span>异常分支</span>
          </div>
          <ChainGraph ref="graph" :key="graphKey" />
        </section>

        <section class="result-section">
          <div class="section-header">
            <h2>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
                <path d="M4 4h12v12H4z"/><path d="M4 8h12M8 8v8"/>
              </svg>
              功能链路 <span class="sub">每个功能一条完整链路 · 点击卡片头部可切换</span>
            </h2>
            <div class="stats">
              <span class="stat-item"><span class="stat-label">功能</span><span class="stat-value">{{ stats.fn }}</span></span>
              <span class="stat-item"><span class="stat-label">逻辑步骤</span><span class="stat-value">{{ stats.logic }}</span></span>
              <span class="stat-item"><span class="stat-label">涉及类</span><span class="stat-value">{{ stats.cls }}</span></span>
            </div>
          </div>
          <div class="chain-list">
            <ChainCard v-for="f in visibleFunctions" :key="f.id" :fn="f" />
          </div>
        </section>
      </template>
    </div>
  </main>
</template>

<script setup>
import { ref, computed } from 'vue';
import { S, stats, startAnalysis, cancelAnalysis, selectFn, currentFunctions, graphSubtitle, fileName, activeSession, showToast } from '../store.js';
import ChainGraph from './ChainGraph.vue';
import ChainCard from './ChainCard.vue';

const graph = ref(null);

const functions = computed(() => currentFunctions());
const hasResult = computed(() => !!activeSession()?.analyzed);
const title = computed(() => {
  if (S.analyzing) return fileName(S.selectedFile || '') || '分析中';
  if (hasResult.value) return activeSession().name;
  return S.selectedFile ? fileName(S.selectedFile) : '新会话';
});
const subtitlePath = computed(() => {
  if (hasResult.value) return activeSession().file;
  return S.selectedFile ? (S.config.frontend ? S.config.frontend + '/' : '') + S.selectedFile
    : (S.config.root ? '从左侧选择一个 Vue 组件开始分析' : '未配置项目');
});
const canAnalyze = computed(() => !S.analyzing && !!(S.selectedFile || activeSession()?.file) && !!S.config.root &&
  (!activeSession()?.projectRoot || activeSession().projectRoot === S.config.root));
const analyzeLabel = computed(() => S.analyzing ? '分析中…' : (hasResult.value ? '重新分析' : '开始分析'));
const sessionError = computed(() => activeSession()?.status === 'error' ? '上次分析失败，可重试（详见终端）' : '');
const visibleFunctions = computed(() =>
  S.currentFn === 'all' ? functions.value : functions.value.filter(f => f.id === S.currentFn));
const graphKey = computed(() => `${S.activeId}|${S.currentFn}|${functions.value.length}`);
function resetCurrent() {
  const s = activeSession();
  if (s) { s.analyzed = false; s.data = null; s.status = 'idle'; }
  S.currentFn = 'all';
  showToast('已重置当前会话');
}
</script>
