<template>
  <section class="cc-conversation" aria-label="当前会话的 Claude Code 对话">
    <div v-if="error" class="cc-banner" role="alert">{{ error }}<button v-if="CW.error" @click="retry">重新连接</button></div>
    <div v-if="session?.analysis?.error" class="cc-analysis-error" role="status">{{ session.analysis.error }}</div>
    <div ref="scrollEl" class="cc-messages" @scroll="onScroll">
      <div v-if="!session" class="cc-empty">
        <span v-if="!analysis">从左侧选择一个 Vue 组件；每个组件固定一个会话</span>
        <span v-else-if="CW.loading">正在连接当前会话…</span>
        <span v-else-if="analysis.claudeError">{{ analysis.claudeError }}</span>
        <span v-else>当前组件会话正在连接 Claude Code…</span>
        <button v-if="analysis?.claudeError" @click="retry">重试连接</button>
      </div>
      <div v-else-if="!messages.length && !session.analysis?.status" class="cc-empty">
        <strong>{{ session.name }} · Claude Code</strong>
        <span>此对话绑定到顶部当前会话，可在这里继续追问。</span>
        <button v-if="contextFile" class="cc-suggestion" :disabled="busy" @click="analyzeCurrent">分析当前组件 · {{ fileName }}</button>
      </div>
      <article v-for="message in messages" :key="message.id" class="cc-message" :class="`cc-${message.role}`">
        <template v-if="message.role === 'tool'">
          <details class="cc-tool">
            <summary><strong>{{ message.toolName }}</strong><span>{{ message.status === 'running' ? '执行中' : message.isError ? '出错' : '已完成' }}</span></summary>
            <div v-if="message.description">{{ message.description }}</div>
            <pre>{{ json(message.input) }}</pre>
            <pre v-if="message.output !== undefined">{{ message.output }}</pre>
          </details>
        </template>
        <template v-else>
          <header><strong>{{ message.role === 'user' ? '你' : message.role === 'assistant' ? 'Claude' : '系统' }}</strong><time v-if="message.createdAt">{{ formatTime(message.createdAt) }}</time></header>
          <div class="cc-text">{{ message.text }}</div>
        </template>
      </article>
      <section v-for="request in permissions" :key="request.requestId" class="cc-permission">
        <header><strong>{{ isQuestion(request) ? 'Claude 需要你的回答' : '允许这次操作？' }}</strong><span>{{ request.toolName }}</span></header>
        <p v-if="request.description">{{ request.description }}</p>
        <div v-if="isQuestion(request)" class="cc-question">
          <label v-for="(q, qi) in request.input.questions || []" :key="qi"><span>{{ q.question }}</span>
            <label v-for="(option, oi) in q.options || []" :key="oi" class="cc-option">
              <input :type="q.multiSelect ? 'checkbox' : 'radio'" :name="`${request.requestId}-${qi}`" :value="option.label" @change="choose(request, q.question, option.label, q.multiSelect, $event.target.checked)" />{{ option.label }}
              <small v-if="option.description">{{ option.description }}</small>
            </label>
            <input class="cc-other" :placeholder="q.options?.length ? '补充或其他答案' : '你的回答'" @input="setOther(request, q.question, $event.target.value)" />
          </label>
        </div>
        <details><summary>查看操作详情</summary><pre>{{ json(request.input) }}</pre></details>
        <p v-if="request.error" class="cc-error">{{ request.error }}</p>
        <footer><button :disabled="request.submitting" @click="respond(request, false)">拒绝</button><button :disabled="request.submitting" @click="respond(request, true)">{{ request.submitting ? '处理中…' : isQuestion(request) ? '提交回答' : '允许一次' }}</button></footer>
      </section>
    </div>
    <div v-if="!followTail" class="cc-jump" @click="scrollLatest">有新消息 · 回到最新 ↓</div>
    <form class="cc-composer" @submit.prevent="send">
      <div v-if="contextFile" class="cc-context">当前组件 · {{ contextFile }}</div>
      <textarea ref="inputEl" :value="draft" :disabled="!session || !CW.ready" rows="2" maxlength="100000" placeholder="在当前分析会话中向 Claude Code 提问…" @input="setDraft($event.target.value)" @keydown="keydown" @compositionstart="composing=true" @compositionend="composing=false" />
      <footer>
        <input class="cc-model-input" list="cc-model-list" :value="CW.model" title="模型（来自本机 Claude Code 配置，下一轮生效；留空跟随 CLI 默认）" placeholder="默认模型" spellcheck="false" autocomplete="off"
               @focus="refreshModels" @change="setModel($event.target.value)" @keydown.enter.stop.prevent="$event.target.blur()" />
        <datalist id="cc-model-list">
          <option v-for="m in modelOptions" :key="m.model" :value="m.model" :label="m.label"></option>
        </datalist>
        <span>Enter 发送 · Shift + Enter 换行<span v-if="busy"> · 可继续编写草稿</span><span v-if="session?.model"> · 当前 {{ session.model }}</span></span>
        <button v-if="busy" type="button" class="cc-stop" :disabled="stopping" @click="stop">■ {{ stopping ? '正在停止…' : '停止' }}</button><button v-else type="submit" :disabled="!canSend">发送 ↑</button>
      </footer>
      <p v-if="operationError" class="cc-error">{{ operationError }}</p>
    </form>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { S, activeSession, displayPath, fileName as getFileName, showToast, startAnalysis } from '../store.js';
import { CW, analyzeClaudeSession, claudeForAnalysis, claudePermissions, claudeStatus, ensureClaudeForAnalysis,
  initClaudeWorkspace, isClaudeBusy, loadClaudeModels, respondClaudePermission, retryClaudeWorkspace, sendClaudeMessage,
  setClaudeDraft, setClaudeModel, stopClaudeSession } from '../claude-store.js';
const scrollEl = ref(null), inputEl = ref(null);
const bridgeReady = ref(false), followTail = ref(true), composing = ref(false), answerValues = ref({});
let mounted = false;
const analysis = computed(() => activeSession());
const root = computed(() => analysis.value?.projectRoot || S.config.root || '');
const session = computed(() => analysis.value ? claudeForAnalysis(analysis.value) : null);
const messages = computed(() => (session.value?.messages || []).filter(m => m.role !== 'assistant' || m.text));
const permissions = computed(() => claudePermissions(session.value?.id));
const status = computed(() => claudeStatus(session.value?.id));
const busy = computed(() => !!session.value && isClaudeBusy(session.value.id));
const stopping = computed(() => !!CW.operationsById[session.value?.id]?.stopping);
const operationError = computed(() => CW.operationsById[session.value?.id]?.error || '');
const error = computed(() => CW.error || (analysis.value && CW.bindingErrors[analysis.value.claudeKey]) || '');
const draft = computed(() => CW.draftsById[session.value?.id] || '');
const modelOptions = computed(() => {
  const list = CW.models.map(m => ({ ...m }));
  const current = CW.model.trim();
  if (current && !list.some(m => m.model === current)) list.unshift({ model: current, label: `${current} · 当前输入`, description: '' });
  return list;
});
const contextFile = computed(() => analysis.value?.file || (S.selectedFile ? displayPath(S.selectedFile) : ''));
const fileName = computed(() => getFileName(contextFile.value));
const canSend = computed(() => bridgeReady.value && !!session.value && !!draft.value.trim() && !busy.value &&
  (session.value.root ? true : !!(analysis.value?.projectRoot || S.config.root)));
function json(value) { try { return JSON.stringify(value ?? {}, null, 2); } catch { return String(value); } }
function formatTime(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}); }
function isQuestion(request) { return request.toolName?.split('__').pop() === 'AskUserQuestion'; }
function answerKey(request, question) { return `${request.requestId}:${question}`; }
function choose(request, question, label, multiple, checked) {
  const key = answerKey(request, question), old = answerValues.value[key]?.selected || [];
  answerValues.value[key] = { ...(answerValues.value[key] || {}), selected: multiple ? checked ? [...new Set([...old,label])] : old.filter(x=>x!==label) : [label] };
}
function setOther(request, question, value) { const key=answerKey(request,question); answerValues.value[key]={...(answerValues.value[key]||{}),other:value}; }
function collectAnswers(request) {
  const out = {};
  for (const q of request.input.questions || []) {
    const a=answerValues.value[answerKey(request,q.question)]||{};
    out[q.question]=[...(a.selected||[]),a.other?.trim()].filter(Boolean).join(', ');
  }
  return out;
}
async function prepare() {
  const current=analysis.value, project=root.value;
  if (!current || !project || !bridgeReady.value) return;
  if (current.projectRoot && current.projectRoot !== project) { current.claudeError='当前会话属于另一个项目。请切回原项目，或新建一个会话。'; return; }
  current.projectRoot ||= project;
  current.claudeKey ||= `analysis-${current.id}`;
  current.backend=S.config.backend;
  current.claudeError='';
  void loadClaudeModels(project);
  const bound=await ensureClaudeForAnalysis(current);
  if (!bound && mounted) current.claudeError=CW.bindingErrors[current.claudeKey]||CW.error||'无法连接当前会话';
  else if (bound && mounted) {
    current.claudeId=bound.id; current.claudeMessages=bound.messages||[];
    current.claudePermissions=claudePermissions(bound.id); current.claudeStatus=bound.status||'idle';
  }
}
onMounted(async()=>{ mounted=true; await initClaudeWorkspace(); bridgeReady.value=CW.ready; if(bridgeReady.value) await prepare(); });
onBeforeUnmount(()=>{ mounted=false; bridgeReady.value=false; });
watch(()=>[S.activeId,S.config.root,analysis.value?.file],()=>void prepare());
watch(()=>[session.value?.revision,messages.value.length,permissions.value.length],async()=>{await nextTick();if(followTail.value&&scrollEl.value)scrollEl.value.scrollTop=scrollEl.value.scrollHeight;});
function setDraft(value){if(session.value)setClaudeDraft(session.value.id,value);}
function setModel(value){setClaudeModel(value);}
function refreshModels(){void loadClaudeModels(root.value,true);}
async function send(){if(!canSend.value)return;if(!session.value){await prepare();}if(!session.value)return;const id=session.value.id;const result=await sendClaudeMessage({id,text:draft.value,contextFile:contextFile.value});if(!result.ok&&result.error)showToast(result.error);}
async function runAnalysis(){ await startAnalysis(); }
async function suggestAnalysis(){ if(!contextFile.value)return; setDraft(`请解释当前组件 ${contextFile.value} 的功能和 API 调用流程。`); await nextTick();inputEl.value?.focus(); }
function stop(){if(session.value)void stopClaudeSession(session.value.id);}
async function respond(request,allow){if(!session.value)return;const answers=allow&&isQuestion(request)?collectAnswers(request):undefined;const result=await respondClaudePermission({id:session.value.id,requestId:request.requestId,allow,answers});if(!result.ok&&result.error)showToast(result.error);}
async function retry(){await retryClaudeWorkspace();bridgeReady.value=CW.ready;await prepare();}
function keydown(event){if(event.key==='Enter'&&!event.shiftKey&&!composing&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void send();}}
function onScroll(){const el=scrollEl.value;if(el)followTail.value=el.scrollHeight-el.scrollTop-el.clientHeight<48;}
function scrollLatest(){followTail.value=true;if(scrollEl.value)scrollEl.value.scrollTop=scrollEl.value.scrollHeight;}
async function analyzeCurrent(){if(!analysis.value)return;await startAnalysis();}
defineExpose({ runAnalysis, analyzeCurrent });
</script>

<style scoped>
.cc-conversation{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--terminal-bg);color:#e8e4d9;font:12px/1.65 'Cascadia Code',Consolas,'Courier New',monospace}.cc-messages{flex:1;min-height:0;overflow:auto;padding:14px 16px}.cc-message{margin:0 0 14px;white-space:pre-wrap;overflow-wrap:anywhere}.cc-message header,.cc-permission header{display:flex;justify-content:space-between;gap:8px;margin-bottom:5px;color:#d97757}.cc-message time,.cc-permission header span{color:#aaa69b;font-size:10px}.cc-user{color:#c9c5b8}.cc-assistant{color:#f5f2e9}.cc-system{color:#d9bd83}.cc-text{white-space:pre-wrap;overflow-wrap:anywhere}.cc-tool,.cc-permission{padding:9px 10px;margin:0 0 10px;border:1px solid #605b50;border-radius:7px;background:#302e2a}.cc-tool summary,.cc-permission details summary{display:flex;justify-content:space-between;cursor:pointer;color:#e1c281}.cc-tool pre,.cc-permission pre{max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:#ddd8ce}.cc-permission{border-color:#b08034}.cc-permission footer,.cc-composer footer{display:flex;justify-content:flex-end;gap:8px;align-items:center}.cc-permission button,.cc-composer button{padding:5px 10px;border:1px solid #777064;border-radius:6px;background:#393630;color:#eee;cursor:pointer}.cc-permission button:last-child,.cc-composer button[type=submit]{background:#d97757;border-color:#d97757;color:white}.cc-option{display:flex;gap:6px;margin:6px 0}.cc-option small{color:#aaa}.cc-other,.cc-composer textarea{box-sizing:border-box;width:100%;background:#242320;color:#f5f2e9;border:1px solid #625d52;border-radius:6px;padding:8px;font:inherit}.cc-error,.cc-analysis-error{color:#f29d84;white-space:pre-wrap}.cc-banner{padding:5px 9px;color:#f29d84;border-bottom:1px solid #635b4c}.cc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:120px;gap:8px;text-align:center;color:#aaa69b}.cc-suggestion,.cc-jump{cursor:pointer;color:#e0c78d}.cc-context{margin-bottom:5px;color:#9bb3db;font-size:10px}.cc-composer{flex-shrink:0;padding:8px 12px 10px;border-top:1px solid #514d44;background:#302e2a}.cc-composer textarea{resize:vertical;min-height:50px;max-height:180px}.cc-composer footer{margin-top:6px}.cc-composer footer>span{margin-right:auto;color:#aaa69b;font-size:10px}.cc-model-input{width:130px;flex-shrink:0;background:#242320;color:#9fc3e8;border:1px solid #625d52;border-radius:6px;padding:4px 8px;font:11px 'Cascadia Code',Consolas,monospace}.cc-composer button:disabled,.cc-permission button:disabled{opacity:.5;cursor:default}.cc-stop{color:#f29d84!important;border-color:#a85b48!important}.cc-jump{position:absolute;bottom:110px;left:50%;transform:translateX(-50%);padding:4px 10px;border-radius:14px;background:#393630;border:1px solid #625d52}.cc-conversation :focus-visible{outline:2px solid #d97757;outline-offset:2px}
</style>
