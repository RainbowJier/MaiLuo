<template>
  <div class="agent-terminal" :class="{ closed: !S.terminalOpen }" :style="{ width }">
    <div class="terminal-resize" title="拖动调整宽度" @mousedown="startResize"></div>
    <div class="terminal-header">
      <div class="terminal-session-name" :title="activeSession()?.file ? `${activeSession().file} · 本菜单专属的 Claude Code 原生会话` : '本菜单专属的 Claude Code 原生会话'">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M2.5 3.5h11v8h-6l-3 2v-2h-2v-8z"/>
        </svg>
        <span>{{ activeSession()?.name || '未选择组件' }}</span>
      </div>
      <div class="terminal-status">
        <span class="status-dot" :class="statusClass"></span>{{ statusText }}
      </div>
      <div class="terminal-actions">
        <button class="t-btn analyze" title="在当前会话中分析组件（结果回到链路图）" :disabled="S.analyzing" @click="runAnalysis">分析</button>
        <button class="t-btn" title="展开 / 还原" @click="toggleMax">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 3h3v3M6 13H3v-3M13 3l-4.5 4.5M3 13l4.5-4.5"/></svg>
        </button>
        <button class="t-btn" title="收起面板" @click="S.terminalOpen = false">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6l5 5 5-5"/></svg>
        </button>
      </div>
    </div>
    <ClaudeTerminal class="terminal-conversation" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { S, activeSession, startAnalysis } from '../store.js';
import ClaudeTerminal from './ClaudeTerminal.vue';

const width = ref('460px');
let prevW = '460px';

const statusText = computed(() => {
  if (S.analyzing) return '分析中';
  if (S.terminal.error) return '启动失败';
  if (S.terminal.alive) return 'Claude Code';
  return '未连接';
});
const statusClass = computed(() => S.analyzing ? 'running' : S.terminal.error ? 'error' : S.terminal.alive ? 'done' : '');
async function runAnalysis() { await startAnalysis(); }

function toggleMax() {
  if (width.value === '55vw') width.value = prevW;
  else { prevW = width.value; width.value = '55vw'; }
}
function startResize(ev) {
  ev.preventDefault();
  const startX = ev.clientX;
  const el = ev.currentTarget.parentElement;
  const startW = el.offsetWidth;
  const mv = e => {
    width.value = Math.min(window.innerWidth * 0.7, Math.max(300, startW - (e.clientX - startX))) + 'px';
  };
  const up = () => {
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}
</script>
