<template>
  <div class="ct-wrap" @click="focusTerminal">
    <div ref="hostEl" class="ct-host"></div>
    <div v-if="error" class="ct-banner" role="alert">{{ error }}</div>
    <div v-else-if="!alive" class="ct-overlay">
      <span>会话已结束</span>
      <button @click.stop="restart">重新打开</button>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { S, activeSession, setTerminalState } from '../store.js';

const hostEl = ref(null);
const alive = ref(false);
const error = ref('');
let term = null, fit = null, unsubscribe = null, observer = null, fitTimer = null, starting = false;

const session = () => activeSession();

function ensureUuid(s) {
  if (!s.claudeId || !/^[0-9a-f-]{36}$/i.test(s.claudeId)) {
    s.claudeId = crypto.randomUUID();
  }
  return s.claudeId;
}

async function start(s = session()) {
  if (!term || !s || !s.projectRoot || starting) return;
  starting = true;
  error.value = '';
  try {
    const result = await window.api.terminalStart({
      root: s.projectRoot, sessionId: ensureUuid(s), cols: term.cols, rows: term.rows
    });
    if (!result?.ok) {
      alive.value = false;
      error.value = result?.error || '无法启动原生 Claude Code 终端';
      setTerminalState({ alive: false, error: error.value });
      return;
    }
    alive.value = true;
  } finally { starting = false; }
}

function restart() {
  alive.value = false;
  void window.api.terminalStop().finally(() => start());
}

function focusTerminal() { try { term?.focus(); } catch { /* disposed */ } }

/**
 * 容器显示前的隐藏态会让 fit 静默失效（测量为 0），而面板显示的瞬间
 * ResizeObserver 只触发一次，可能早于 xterm 字宽测量完成；之后容器尺寸
 * 不再变化就没有人重试，终端会一直卡在默认 80×24。双 rAF + 延迟兜底。
 */
function refit() {
  requestAnimationFrame(() => requestAnimationFrame(() => { try { fit.fit(); } catch { /* disposed */ } }));
  setTimeout(() => { try { fit?.fit(); } catch { /* disposed */ } }, 400);
}

function handleEvent(event) {
  if (!event) return;
  if (event.type === 'data' && term) {
    alive.value = true;
    setTerminalState({ alive: true, error: '' });
    term.write(event.chunk);
  } else if (event.type === 'exit') {
    alive.value = false;
    setTerminalState({ alive: false, error: '' });
  }
}

onMounted(() => {
  term = new Terminal({
    convertEol: false, cursorBlink: true, scrollback: 5000, fontSize: 12, lineHeight: 1.15,
    fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
    theme: {
      background: '#26251f', foreground: '#e8e4d9', cursor: '#d97757', cursorAccent: '#26251f',
      selectionBackground: '#d9775766', black: '#26251f', red: '#c96a5a', green: '#7d9b76',
      yellow: '#d9bd83', blue: '#7f93b3', magenta: '#b08bb3', cyan: '#6fa3a8', white: '#e8e4d9',
      scrollbarSliderBackground: '#4a463daa', scrollbarSliderHoverBackground: '#57534acc',
      scrollbarSliderActiveBackground: '#615c50dd'
    }
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(hostEl.value);
  term.onData(data => { void window.api.terminalWrite(data); });
  term.onResize(({ cols, rows }) => { void window.api.terminalResize(cols, rows); });
  unsubscribe = window.api.onTerminalEvent(handleEvent);
  observer = new ResizeObserver(refit);
  observer.observe(hostEl.value);
  // 字体加载会改变字宽度量，容器尺寸不变时 ResizeObserver 不会触发，需显式重排
  document.fonts?.ready?.then(refit);
  // IME 组合等场景容器尺寸会经历异常变化且结束后不再触发任何事件，
  // 画布可能停在旧列数；每 2s 校对一次期望行列数，不一致就重排
  fitTimer = setInterval(() => {
    if (!term || !alive.value) return;
    const dims = fit.proposeDimensions();
    if (dims && (dims.cols !== term.cols || dims.rows !== term.rows)) refit();
  }, 2000);
  setTerminalState({ alive: false, error: '' });
  void start();
});

watch(() => [S.activeId, session()?.claudeId, session()?.projectRoot], () => {
  alive.value = false;
  void start();
});
watch(alive, v => { if (v) refit(); });

onBeforeUnmount(() => {
  unsubscribe?.();
  observer?.disconnect();
  clearInterval(fitTimer);
  try { term?.dispose(); } catch { /* already gone */ }
  term = null;
});
</script>

<style scoped>
.ct-wrap { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex; background: #26251f; }
.ct-host { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
/* xterm.css 给视口硬编码了纯黑底色；主题内联色未生效时四周就会露黑边，这里按终端主题钉死 */
.ct-wrap :deep(.xterm) { padding: 0; background: #26251f; }
.ct-wrap :deep(.xterm-viewport) { background-color: #26251f !important; scrollbar-color: #4a463daa transparent; }
.ct-banner { position: absolute; inset: auto 10px 10px 10px; padding: 8px 10px; color: #f29d84; background: #3a2a24; border: 1px solid #6b4a3f; border-radius: 7px; font-size: 12px; }
.ct-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; background: rgba(38, 37, 31, 0.82); color: #aaa69b; font-size: 12px; }
.ct-overlay button { padding: 6px 14px; border: 1px solid #777064; border-radius: 6px; background: #393630; color: #eee; cursor: pointer; }
.ct-overlay button:hover { background: #d97757; border-color: #d97757; color: #fff; }
</style>
