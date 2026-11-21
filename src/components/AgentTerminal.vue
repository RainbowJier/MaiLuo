<template>
  <div class="agent-terminal" :class="{ closed: !S.terminalOpen }" :style="{ width }">
    <div class="terminal-resize" title="拖动调整宽度" @mousedown="startResize"></div>
    <div class="terminal-header">
      <div class="terminal-tabs">
        <div v-for="s in S.sessions" :key="s.id" class="terminal-tab"
             :class="{ active: s.id === S.activeId }" :title="s.file || s.name"
             @click="switchSession(s.id)">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M3 4.5L6.5 8 3 11.5M8 12h5"/>
          </svg>
          {{ s.name }}
          <span v-if="s.status === 'running' || s.status === 'parsing'" class="tab-run"></span>
        </div>
      </div>
      <div class="terminal-status">
        <span class="status-dot" :class="statusClass"></span>{{ statusText }}
      </div>
      <div class="terminal-actions">
        <button class="t-btn" title="新会话" @click="startNewSession">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>
        </button>
        <button class="t-btn" title="展开 / 还原" @click="toggleMax">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 3h3v3M6 13H3v-3M13 3l-4.5 4.5M3 13l4.5-4.5"/></svg>
        </button>
        <button class="t-btn" title="收起面板" @click="S.terminalOpen = false">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6l5 5 5-5"/></svg>
        </button>
      </div>
    </div>
    <div class="terminal" ref="termBody">
      <template v-if="lines.length">
        <div v-for="(l, i) in lines" :key="i" :class="'t-' + l.cls">{{ l.text }}</div>
        <div v-if="isActiveRunning"><span class="cursor"></span></div>
      </template>
      <template v-else>
        <div class="t-line t-dim">┌ Claude Code · 会话就绪</div>
        <div class="t-line t-dim">└ 等待任务 · 点击「开始分析」后，此处实时显示 Claude Code 的终端输出</div>
        <div class="t-cmd">$ <span class="cursor"></span></div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { S, activeSession, startNewSession, switchSession } from '../store.js';

const termBody = ref(null);
const width = ref('420px');
let prevW = '420px';

const lines = computed(() => activeSession()?.term || []);
const isActiveRunning = computed(() => ['running', 'parsing'].includes(activeSession()?.status));
const statusMap = { idle: '空闲', running: '运行中', parsing: '解析中', done: '已完成', error: '失败' };
const statusText = computed(() => statusMap[activeSession()?.status] || '空闲');
const statusClass = computed(() => activeSession()?.status || '');

watch(() => lines.value.length, async () => {
  await nextTick();
  if (termBody.value) termBody.value.scrollTop = termBody.value.scrollHeight;
});

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
