import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPrompt, extractJson, normalizeContract } from './analyzer.mjs';

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
const textOfContent = content => Array.isArray(content)
  ? content.filter(b => b?.type === 'text').map(b => b.text || '').join('\n')
  : '';

/**
 * 原生终端宿主：PTY 里跑本机 claude TUI（交互全原生），会话 jsonl 作为
 * 机器可读侧信道，仅用于「开始分析」的结构化结果提取。
 * 同一时间只保留一个活动的 PTY；切换菜单 = 结束当前、按同一 sessionId 重启续聊。
 */
export function createTerminalHost({ notify, spawnPty, env = process.env, home = os.homedir(), now = Date.now, debug = () => {} }) {
  let term = null;   // { pty, root, sessionId, file, byteOffset, pending, lastChange, analysis, poll }
  const emit = event => notify(event);

  function fileSize(file) { try { return fs.statSync(file).size; } catch { return 0; } }

  function stop(sendExit = true) {
    if (!term) return;
    clearInterval(term.poll);
    const analysis = term.analysis;
    try { term.pty.kill(); } catch { /* already gone */ }
    term = null;
    if (analysis && !analysis.done) finishAnalysis(analysis, { error: '会话已结束' });
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
    const args = ['--session-id', sessionId, '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    const cleanEnv = { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    let pty;
    try {
      pty = spawnPty(resolveClaudeExecutable(env, process.platform), args,
        { name: 'xterm-256color', cols, rows, cwd: root, env: cleanEnv });
    } catch (e) {
      return { ok: false, error: e?.message || '无法启动原生终端' };
    }
    term = { pty, root, sessionId, file, byteOffset: fileSize(file), pending: '',
      lastChange: now(), analysis: null };
    pty.onData(chunk => emit({ type: 'data', chunk }));
    pty.onExit(({ exitCode } = {}) => {
      if (!term || term.pty !== pty) return;
      const analysis = term.analysis;
      clearInterval(term.poll);
      term = null;
      if (analysis && !analysis.done) finishAnalysis(analysis, { error: '会话已退出' });
      emit({ type: 'exit', exitCode });
    });
    term.poll = setInterval(pollSessionFile, 300);
    return { ok: true, restarted: true };
  }

  /** 轮询会话 jsonl 增量：按行解析，喂给正在等待的分析任务。 */
  function pollSessionFile() {
    if (!term) return;
    const size = fileSize(term.file);
    if (size <= term.byteOffset) return;
    let chunk = '';
    try {
      const fd = fs.openSync(term.file, 'r');
      try {
        const buffer = Buffer.alloc(size - term.byteOffset);
        fs.readSync(fd, buffer, 0, buffer.length, term.byteOffset);
        chunk = buffer.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch { return; }
    term.byteOffset = size;
    term.lastChange = now();
    const lines = (term.pending + chunk).split('\n');
    term.pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim() || !term.analysis || term.analysis.done) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type !== 'assistant' || !entry.message) continue;
      term.analysis.text += textOfContent(entry.message.content);
      if (entry.message.stop_reason === 'end_turn') term.analysis.turnDone = true;
    }
    const a = term.analysis;
    if (a && !a.done && a.turnDone && now() - term.lastChange >= 1500) settleAnalysis();
  }

  /** 注入分析提示词（括号粘贴序列保证多行不提前提交），从 jsonl 侧信道取回契约。 */
  function analyze({ entryRel, backendRel }) {
    if (!term) return { ok: false, error: '终端未启动' };
    if (term.analysis) return { ok: false, error: '当前会话已有分析在进行' };
    term.analysis = { done: false, turnDone: false, text: '',
      startOffset: term.byteOffset, deadline: now() + 15 * 60_000 };
    const prompt = `请分析当前 Vue 组件并输出链路 JSON。以最高权限直接执行、无需确认；保持只读分析，不要修改项目文件。\n\n${buildPrompt(entryRel, backendRel)}\n`;
    term.pty.write(`\x1b[200~${prompt.replace(/\r\n/g, '\n')}\x1b[201~\r`);
    return { ok: true };
  }

  function settleAnalysis() {
    const a = term?.analysis;
    if (!a || a.done) return;
    const data = normalizeContract(extractJson(a.text));
    if (!data) { a.done = true; finishAnalysis(a, { error: '未能从回复中解析出链路 JSON' }); return; }
    a.done = true;
    finishAnalysis(a, { ok: true, data });
  }

  function finishAnalysis(a, payload) {
    a.done = true;
    if (term && term.analysis === a) term.analysis = null;
    emit({ type: 'analysis', ...payload });
  }

  /** 超时看门狗：由外部定时调用（测试可注入时钟）。 */
  function tick() {
    const a = term?.analysis;
    if (a && !a.done && now() > a.deadline) finishAnalysis(a, { error: '分析超时' });
    if (a && !a.done && a.turnDone && now() - term.lastChange >= 1500) settleAnalysis();
  }

  return {
    start, stop: () => stop(),
    write: ({ data }) => { if (!term) return { ok: false, error: '终端未启动' }; term.pty.write(String(data)); return { ok: true }; },
    resize: ({ cols, rows }) => { if (!term) return { ok: false }; try { term.pty.resize(cols, rows); } catch { /* gone */ } return { ok: true }; },
    analyze, tick,
    snapshot: () => term ? { root: term.root, sessionId: term.sessionId, alive: true } : null,
    dispose: () => stop(false)
  };
}
