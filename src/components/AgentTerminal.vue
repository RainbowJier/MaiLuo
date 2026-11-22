<template>
  <div class="agent-terminal" :class="{ closed: !S.terminalOpen }" :style="{ width }">
    <div class="terminal-resize" title="拖动调整宽度" @mousedown="startResize"></div>
    <div class="terminal-header">
      <div class="terminal-session-name" :title="activeSession()?.file ? `${activeSession().file} · 仅此菜单的独立会话` : '仅当前菜单的独立会话'">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M2.5 3.5h11v8h-6l-3 2v-2h-2v-8z"/>
        </svg>
        <span>{{ activeSession()?.name || '未选择组件' }}</span>
      </div>
      <div class="terminal-status">
        <span class="status-dot" :class="statusClass"></span>{{ statusText }}
      </div>
      <div class="terminal-actions">
        <button class="t-btn" title="展开 / 还原" @click="toggleMax">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 3h3v3M6 13H3v-3M13 3l-4.5 4.5M3 13l4.5-4.5"/></svg>
        </button>
        <button class="t-btn" title="收起面板" @click="S.terminalOpen = false">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6l5 5 5-5"/></svg>
        </button>
      </div>
    </div>
    <ClaudeConversation class="terminal-conversation" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { S, activeSession } from '../store.js';
import { CW } from '../claude-store.js';
import ClaudeConversation from './ClaudeConversation.vue';

const width = ref('420px');
let prevW = '420px';

const isActiveRunning = computed(() => ['running', 'parsing'].includes(activeSession()?.status));
const statusMap = { idle: '空闲', starting: '准备中', running: '运行中', parsing: '解析中', permission: '待确认', done: '已完成', interrupted: '已停止', error: '失败' };
const statusText = computed(() => {
  const s = activeSession();
  const st = s?.claudeStatus === 'running' && s.status === 'running' ? 'running' : s?.claudeStatus;
  const status = CW.sessions.find(x => x.id === s?.claudeId)?.status || st;
  return statusMap[status] || statusMap[s?.status] || '空闲';
});
const statusClass = computed(() => activeSession()?.claudeStatus === 'running' ? 'running' : activeSession()?.status || '');

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
    width.value = Math.min(window.innerWidth * 0.7, Math.max(260, startW - (e.clientX - startX))) + 'px';
  };
  const up = () => {
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}
</script>
