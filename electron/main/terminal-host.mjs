import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { buildPrompt, extractJson, normalizeContract } from './analyzer.mjs';
import { stripClaudeSessionMarkers } from './child-env.mjs';

/** Resolve the native CLI, never execute a .cmd wrapper through a shell. */
export function resolveClaudeExecutable(env = process.env, platform = process.platform) {
  const dirs = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  if (env.USERPROFILE) dirs.push(path.join(env.USERPROFILE, '.local', 'bin'));
  if (platform === 'win32') {
    const home = env.USERPROFILE || env.HOME;
    if (home) dirs.push(path.join(home, 'AppData', 'Local', 'Programs', 'Claude'));
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'Claude', 'bin'));
    if (env.ProgramFiles) dirs.push(path.join(env.ProgramFiles, 'Claude'));
  }
  for (const dir of dirs) {
    const candidates = platform === 'win32' ? [
      path.join(dir, 'claude.exe'),
      path.join(dir, 'claude', 'claude.exe'),
      path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    ] : [path.join(dir, 'claude')];
    for (const file of candidates) {
      try {
        if (!fs.statSync(file).isFile()) continue;
        fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return path.resolve(file);
      } catch { /* try the next PATH entry */ }
    }
  }
  throw new Error('未找到原生 Claude Code 程序。请安装本机 claude CLI，并重启 MaiLuo。');
}

/** Claude Code 把 cwd 映射成会话目录名：非字母数字字符全部替换为 '-'。 */
export function mungeProjectDir(root) {
  return String(root).replace(/[^a-zA-Z0-9]/g, '-');
}

/** 会话日志文件（原生 TUI 与 -p 共用的落盘位置）。 */
export function claudeSessionFile(root, sessionId, { env = process.env, home = os.homedir() } = {}) {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return path.join(configDir, 'projects', mungeProjectDir(root), `${sessionId}.jsonl`);
}

const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const blocksOf = content => (Array.isArray(content) ? content : []);
const textOfContent = content => blocksOf(content).filter(b => b?.type === 'text').map(b => b.text || '').join('\n');
/** 用户输入的原文：字符串 content，或 text 块；tool_result 不算用户输入。 */
const textOfUser = content => typeof content === 'string' ? content : textOfContent(content);

/** 注入提示词开头的标记前缀：会话日志里出现「本次标记」的那条 user 记录之后，才属于本次分析的那一轮。 */
const ANALYSIS_MARKER = '【MaiLuo-analysis';
const ANALYSIS_TIMEOUT_MS = 15 * 60_000;   // 整轮分析的硬上限
const SETTLE_IDLE_MS = 1500;               // 见到含文本的 end_turn 后，日志静默多久算本轮结束
const NO_TEXT_GRACE_MS = 30_000;           // 只见到不含文本的 end_turn 行时，再等多久才判定失败
const SILENT_HINT_MS = 20_000;             // 注入后日志多久仍零增长时提示用户

/**
 * 原生终端宿主：PTY 里跑本机 claude TUI（交互全原生），会话 jsonl 作为
 * 机器可读侧信道，仅用于「开始分析」的结构化结果提取。
 * 同一时间只保留一个活动的 PTY；切换菜单 = 结束当前、按同一 sessionId 重启续聊。
 */
export function createTerminalHost({ notify, spawnPty, env = process.env, home = os.homedir(), now = Date.now, debug = () => {} }) {
  let term = null;   // { pty, root, sessionId, file, byteOffset, pending, decoder, lastChange, analysis, poll }
  const emit = event => notify(event);

  function fileSize(file) { try { return fs.statSync(file).size; } catch { return 0; } }

  function stop(sendExit = true) {
    if (!term) return;
    clearInterval(term.poll);
    const analysis = term.analysis;
    try { term.pty.kill(); } catch { /* already gone */ }
    term = null;
    if (analysis && !analysis.done) finishAnalysis(analysis, { error: '终端已切换或关闭，本次分析中止' });
    if (sendExit) emit({ type: 'exit' });
  }

  function start({ root, sessionId, model, cols = 100, rows = 30 }) {
    debug(`terminal:start root=${JSON.stringify(root)} sessionId=${sessionId}`);
    if (!path.isAbsolute(String(root || '')) || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory())
      return { ok: false, error: `项目根目录无效：${JSON.stringify(root)}` };
    if (!isUuid(sessionId)) return { ok: false, error: '会话 ID 无效' };
    if (model && (String(model).length > 100 || /[\s"']/.test(model))) return { ok: false, error: '无效的模型' };
    if (term && term.root === root && term.sessionId === sessionId) return { ok: true, restarted: false };
    stop(false);
    const file = claudeSessionFile(root, sessionId, { env, home });
    // 会话已存在时必须用 --resume 续聊；再传 --session-id 会报 "already in use"
    const args = [fs.existsSync(file) ? '--resume' : '--session-id', sessionId, '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    // 子 claude 不能继承 ELECTRON_RUN_AS_NODE，也不能继承「另一个 Claude Code 会话」的子会话标记
    // （后者会让它关闭 transcript 落盘，见 child-env.mjs）。
    const cleanEnv = { ...stripClaudeSessionMarkers(env), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    let pty;
    try {
      pty = spawnPty(resolveClaudeExecutable(env, process.platform), args,
        { name: 'xterm-256color', cols, rows, cwd: root, env: cleanEnv });
    } catch (e) {
      return { ok: false, error: e?.message || '无法启动原生终端' };
    }
    term = { pty, root, sessionId, file, byteOffset: fileSize(file), pending: '', decoder: new StringDecoder('utf8'),
      lastChange: now(), analysis: null };
    // 切换会话后旧 PTY 可能还有尾包输出：不能转发给新会话的终端，也不能让它把新终端标成 alive
    pty.onData(chunk => { if (term && term.pty === pty) emit({ type: 'data', chunk }); });
    pty.onExit(({ exitCode } = {}) => {
      if (!term || term.pty !== pty) return;
      const analysis = term.analysis;
      clearInterval(term.poll);
      term = null;
      if (analysis && !analysis.done) finishAnalysis(analysis, { error: 'Claude Code 会话已退出，本次分析中止' });
      emit({ type: 'exit', exitCode });
    });
    term.poll = setInterval(pollSessionFile, 300);
    return { ok: true, restarted: true };
  }

  /** 喂一行会话日志给正在等待的分析任务。 */
  function feedLine(line) {
    const a = term?.analysis;
    if (!line.trim() || !a || a.done) return;
    let entry;
    try { entry = JSON.parse(line); } catch { return; }
    const message = entry.message;
    if (entry.type === 'user') {
      // 以本次注入的提示词为界：点击分析时若 TUI 正在输出上一轮，那一轮的收尾行不算数。
      // 注意两点（Claude Code 2.1.332 实测）：粘贴内容会被原样记进 user 记录，但外面裹了一层
      // "\n\n<pasted_content id=…>\n…\n</pasted_content>"，所以只能用 includes 而不能看开头；
      // 同一轮还会写出含相同文本的 last-prompt 记录（没有 message），不能当成界碑。
      if (!a.sawPrompt && textOfUser(message?.content).includes(a.marker)) a.sawPrompt = true;
      return;
    }
    if (entry.type !== 'assistant' || !message || !a.sawPrompt) return;
    const text = textOfContent(message.content);
    if (text) a.text += (a.text ? '\n' : '') + text;
    // tool_use 表示本轮还在继续；其余 stop_reason（end_turn / max_tokens …）都意味着消息已收尾
    const stopReason = message.stop_reason;
    if (stopReason && stopReason !== 'tool_use') {
      a.turnDone = true;
      if (text) a.turnHasText = true;
    }
  }

  /** 本轮是否已结束、可以收尾。 */
  function shouldSettle(a) {
    if (!a.turnDone) return false;
    const idle = now() - term.lastChange;
    // 最终消息可能被拆成多行落盘（thinking 块先于 text 块）。end_turn 行里还没有文本时
    // 不立刻判定失败，给正文留出到达时间；只有模型确实没给文字时才会在宽限期后失败。
    return a.turnHasText ? idle >= SETTLE_IDLE_MS : idle >= NO_TEXT_GRACE_MS;
  }

  /** 轮询会话 jsonl 增量：按行解析，喂给正在等待的分析任务。 */
  function pollSessionFile() {
    if (!term) return;
    const size = fileSize(term.file);
    if (size < term.byteOffset) {
      // 日志被重写变短（而不是追加）：已读偏移失效，重读旧内容只会污染本次分析
      const a = term.analysis;
      term.byteOffset = size; term.pending = ''; term.decoder = new StringDecoder('utf8');
      if (a && !a.done) finishAnalysis(a, { error: '会话日志被重写，本次分析中止，请重新分析' });
      return;
    }
    if (size <= term.byteOffset) return;
    let chunk = '', read = 0;
    try {
      const fd = fs.openSync(term.file, 'r');
      try {
        const buffer = Buffer.alloc(size - term.byteOffset);
        read = fs.readSync(fd, buffer, 0, buffer.length, term.byteOffset);
        // 中文等多字节字符可能被截在两次读取之间，交给 StringDecoder 拼接
        chunk = term.decoder.write(buffer.subarray(0, read));
      } finally { fs.closeSync(fd); }
    } catch { return; }
    term.byteOffset += read;
    term.lastChange = now();
    const lines = (term.pending + chunk).split('\n');
    term.pending = lines.pop() || '';
    for (const line of lines) feedLine(line);
    const a = term.analysis;
    if (a && !a.done && shouldSettle(a)) settleAnalysis();
  }

  /** 注入分析提示词（括号粘贴序列保证多行不提前提交），从 jsonl 侧信道取回契约。 */
  function analyze({ entryRel, backendRel, sessionId }) {
    if (!term) return { ok: false, error: '终端未启动' };
    if (sessionId && sessionId !== term.sessionId) return { ok: false, error: '终端会话与当前组件不一致，请重试' };
    if (term.analysis) return { ok: false, error: '当前会话已有分析在进行' };
    // 每次分析一个独立标记：上一次（被取消的）分析迟到的提示词记录不会被当成本次的
    const marker = `${ANALYSIS_MARKER}:${Math.random().toString(36).slice(2, 8)}】`;
    term.analysis = { sessionId: term.sessionId, done: false, sawPrompt: false, turnDone: false, turnHasText: false,
      marker, text: '', startOffset: term.byteOffset, startAt: now(), hinted: false, deadline: now() + ANALYSIS_TIMEOUT_MS };
    const prompt = `${marker}请分析当前 Vue 组件并输出链路 JSON。以最高权限直接执行、无需确认；保持只读分析，不要修改项目文件。\n\n${buildPrompt(entryRel, backendRel)}\n`;
    term.pty.write(`\x1b[200~${prompt.replace(/\r\n/g, '\n')}\x1b[201~\r`);
    return { ok: true };
  }

  /** 用户取消：向 TUI 发 Esc 打断本轮，并丢弃这次分析（不能再让宿主等它的 end_turn）。 */
  function cancel() {
    if (!term) return { ok: false, error: '终端未启动' };
    const a = term.analysis;
    if (a && !a.done) { a.done = true; term.analysis = null; }
    term.pty.write('\x1b');
    return { ok: true };
  }

  function settleAnalysis() {
    const a = term?.analysis;
    if (!a || a.done) return;
    let data = null;
    try { data = normalizeContract(extractJson(a.text)); }
    catch (e) { debug(`analysis normalize failed: ${e?.message}`); }
    if (!data) { finishAnalysis(a, { error: '未能从回复中解析出链路 JSON' }); return; }
    finishAnalysis(a, { ok: true, data });
  }

  function finishAnalysis(a, payload) {
    a.done = true;
    if (term && term.analysis === a) term.analysis = null;
    // 带上 sessionId：事件到达时用户可能已经切到别的菜单，结果必须回到发起分析的那个会话
    emit({ type: 'analysis', sessionId: a.sessionId, ...payload });
  }

  /** 看门狗：由外部定时调用（测试可注入时钟）。每次先主动读一次日志，再判断收尾/超时。 */
  function tick() {
    if (!term) return;
    pollSessionFile();
    const a = term?.analysis;
    if (!a || a.done) return;
    if (now() > a.deadline) { finishAnalysis(a, { error: '分析超时（15 分钟内未完成）' }); return; }
    if (!a.sawPrompt && !a.hinted && now() - a.startAt >= SILENT_HINT_MS && fileSize(term.file) <= a.startOffset) {
      // 注入后日志一个字节都没长：多半是 transcript 没落盘，或粘贴没被终端接收。不中止，只提示。
      a.hinted = true;
      emit({ type: 'hint', sessionId: a.sessionId,
        text: '分析指令已发出，但 20 秒内会话日志没有任何写入。若终端底部显示 “Transcript saving is off”，MaiLuo 读不到分析结果：请从普通终端（而非 Claude Code 会话内）启动 MaiLuo；也可取消后等终端就绪再试。' });
    }
    if (shouldSettle(a)) settleAnalysis();
  }

  return {
    start, stop: () => stop(),
    write: ({ data }) => { if (!term) return { ok: false, error: '终端未启动' }; term.pty.write(String(data)); return { ok: true }; },
    resize: ({ cols, rows }) => { if (!term) return { ok: false }; try { term.pty.resize(cols, rows); } catch { /* gone */ } return { ok: true }; },
    analyze, cancel, tick,
    snapshot: () => term ? { root: term.root, sessionId: term.sessionId, alive: true } : null,
    dispose: () => stop(false)
  };
}
