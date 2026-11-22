import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { buildPrompt, extractJson, normalizeContract } from './analyzer.mjs';

const BUSY = new Set(['starting', 'running', 'permission']);
const MAX_TEXT = 200_000;
const limitText = (value) => value.length <= MAX_TEXT ? value :
  value.slice(0, MAX_TEXT) + '\n…（内容过长，已截断显示）';
const textOf = (content) => typeof content === 'string' ? content :
  Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text || '').join('\n') : '';
const clone = (value) => JSON.parse(JSON.stringify(value));

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
        if (!statSync(file).isFile()) continue;
        accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return path.resolve(file);
      } catch { /* try the next PATH entry */ }
    }
  }
  throw new Error('未找到原生 Claude Code 程序。请安装本机 claude CLI，并重启 MaiLuo。');
}

/** One CLI turn; the CLI owns its conversation history and resumes via session ID.
 * Wire shapes follow the official Agent SDK subprocess transport / query protocol.
 */
export function createClaudeTurn({ root, resume, text, model, autoApprove, emit, spawnProcess = spawn, executable }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--include-partial-messages', '--verbose'];
  // 组件分析默认最高权限直接执行；普通对话经 stdio 授权卡片逐项确认。
  if (autoApprove) args.push('--dangerously-skip-permissions');
  else args.push('--permission-prompt-tool', 'stdio', '--permission-mode', 'manual');
  if (model) args.push('--model', model);
  if (resume) args.push('--resume', resume);
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnProcess(executable || resolveClaudeExecutable(env), args, {
    cwd: root, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  const controls = new Set();
  const decoder = new StringDecoder('utf8');
  const errDecoder = new StringDecoder('utf8');
  let buffer = '', stderr = '', initialized = false, finished = false, gotResult = false;
  let messageId = '', textSeen = false;
  const streamedTextMessages = new Set();
  const completedTextEvents = new Set();
  let finalTextSequence = 0;
  let shutdownTimer;
  const write = (msg) => {
    if (child.stdin.destroyed || child.stdin.writableEnded) throw new Error('Claude Code 连接已关闭');
    child.stdin.write(JSON.stringify(msg) + '\n');
  };
  const control = (request) => {
    const request_id = randomUUID();
    controls.add(request_id);
    write({ type: 'control_request', request_id, request });
    return request_id;
  };
  const finish = (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(startupTimer);
    clearTimeout(shutdownTimer);
    for (const requestId of pending.keys()) emit({ kind: 'permission-resolved', requestId });
    pending.clear();
    emit({ kind: 'end', error });
  };
  const killTree = () => {
    if (!child.pid || child.exitCode != null) return;
    if (process.platform === 'win32' && spawnProcess === spawn) {
      const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, shell: false, stdio: 'ignore' });
      killer.on('error', () => { try { child.kill(); } catch {} });
    } else { try { child.kill(); } catch {} }
  };
  const fail = (error) => { finish(error); killTree(); };
  const startupTimer = setTimeout(() => fail('Claude Code 启动超时，请检查本机 CLI 登录和配置。'), 25_000);
  startupTimer.unref?.();
  const handle = (e) => {
    if (finished) return;
    if (e.type === 'control_response') {
      if (!controls.delete(e.response?.request_id)) return;
      if (e.response?.subtype === 'error') return fail(e.response.error || 'Claude Code 初始化失败');
      if (!initialized) {
        initialized = true;
        clearTimeout(startupTimer);
        write({ type: 'user', uuid: randomUUID(), session_id: resume || '', parent_tool_use_id: null,
          message: { role: 'user', content: [{ type: 'text', text }] } });
        emit({ kind: 'status', status: 'running' });
      }
      return;
    }
    if (e.type === 'control_request') {
      const request = e.request || {};
      if (request.subtype === 'can_use_tool') {
        if (pending.has(e.request_id)) return;
        pending.set(e.request_id, request);
        emit({ kind: 'permission', request: {
          requestId: e.request_id, toolName: request.tool_name, input: request.input || {},
          toolUseId: request.tool_use_id, description: request.description || request.decision_reason || ''
        } });
      } else {
        write({ type: 'control_response', response: { subtype: 'error', request_id: e.request_id,
          error: `MaiLuo 暂不支持此交互：${request.subtype}` } });
      }
      return;
    }
    if (e.type === 'control_cancel_request') {
      pending.delete(e.request_id);
      emit({ kind: 'permission-resolved', requestId: e.request_id });
      return;
    }
    if (e.type === 'system' && e.subtype === 'init') {
      emit({ kind: 'init', cliSessionId: e.session_id, model: e.model || '' });
      return;
    }
    if (e.type === 'stream_event') {
      const ev = e.event || {};
      if (ev.type === 'message_start') messageId = ev.message?.id || randomUUID();
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
        textSeen = true;
        streamedTextMessages.add(messageId);
        emit({ kind: 'text', id: `${messageId}:${ev.index}`, text: ev.content_block.text || '', replace: true });
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        textSeen = true;
        streamedTextMessages.add(messageId);
        emit({ kind: 'text', id: `${messageId}:${ev.index}`, text: ev.delta.text || '', replace: false });
      }
      // Thinking blocks are intentionally not forwarded to the UI or stored.
      return;
    }
    if (e.type === 'assistant') {
      for (const [index, block] of (e.message?.content || []).entries()) {
        if (block.type === 'text') {
          textSeen = true;
          const id = e.message.id || messageId;
          // CLI assistant messages may carry one completed block, so their local
          // index is not the original SSE block index (thinking often comes first).
          if (streamedTextMessages.has(id)) continue;
          const eventKey = e.uuid ? `${e.uuid}:${index}` : null;
          if (eventKey && completedTextEvents.has(eventKey)) continue;
          if (eventKey) completedTextEvents.add(eventKey);
          emit({ kind: 'text', id: `${id}:final:${++finalTextSequence}`, text: block.text || '', replace: true });
        } else if (block.type === 'tool_use') {
          emit({ kind: 'tool', id: block.id, toolName: block.name, input: block.input || {} });
        }
      }
      return;
    }
    if (e.type === 'user') {
      for (const block of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (block.type === 'tool_result') emit({ kind: 'tool-result', id: block.tool_use_id,
          output: limitText(textOf(block.content)), isError: !!block.is_error });
      }
      return;
    }
    if (e.type === 'result') {
      gotResult = true;
      if (e.session_id) emit({ kind: 'init', cliSessionId: e.session_id });
      if (!textSeen && e.result) emit({ kind: 'text', id: randomUUID(), text: String(e.result), replace: true });
      const error = e.is_error || (e.subtype && e.subtype !== 'success') ?
        (e.errors?.join('\n') || e.result || `Claude Code 返回 ${e.subtype}`) : null;
      finish(error);
      child.stdin.end();
      shutdownTimer = setTimeout(killTree, 3_000);
      shutdownTimer.unref?.();
    }
  };
  const consume = (last = false) => {
    let index;
    while ((index = buffer.indexOf('\n')) >= 0 || (last && buffer.length)) {
      const line = (index >= 0 ? buffer.slice(0, index) : buffer).trim();
      buffer = index >= 0 ? buffer.slice(index + 1) : '';
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); }
      catch { continue; }
      try { handle(event); } catch (e) { fail(`Claude Code 协议错误：${e.message}`); }
    }
    if (buffer.length > 16_000_000) fail('Claude Code 输出过大，连接已关闭。');
  };
  child.stdout.on('data', (chunk) => { buffer += decoder.write(chunk); consume(); });
  child.stderr.on('data', (chunk) => { stderr = (stderr + errDecoder.write(chunk)).slice(-8_000); });
  child.stdin.on('error', e => { if (!finished) fail(`Claude Code 输入失败：${e.message}`); });
  child.on('error', e => fail(`Claude Code 无法启动：${e.message}`));
  child.on('close', code => {
    clearTimeout(shutdownTimer);
    buffer += decoder.end();
    consume(true);
    if (!gotResult && !finished) finish(`Claude Code 提前退出（${code ?? '未知'}）${stderr ? '：' + stderr.trim() : ''}`);
    emit({ kind: 'closed' });
  });
  control({ subtype: 'initialize', hooks: null });
  return {
    respond(requestId, allow, answers) {
      const req = pending.get(requestId);
      if (!req || finished) throw new Error('该权限请求已过期');
      const updatedInput = { ...(req.input || {}) };
      if (allow && req.tool_name === 'AskUserQuestion') {
        if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('请填写问题答案');
        updatedInput.answers = answers;
      }
      write({ type: 'control_response', response: { subtype: 'success', request_id: requestId,
        response: allow ? { behavior: 'allow', updatedInput } : { behavior: 'deny', message: '用户在 MaiLuo 中拒绝了此次操作。' } } });
      pending.delete(requestId);
      emit({ kind: 'permission-resolved', requestId });
      emit({ kind: 'status', status: pending.size ? 'permission' : 'running' });
    },
    stop() { clearTimeout(shutdownTimer); finish(null); killTree(); },
    get pending() { return [...pending.entries()].map(([requestId, req]) => ({ requestId,
      toolName: req.tool_name, input: req.input || {}, toolUseId: req.tool_use_id })); }
  };
}

/** Owns durable chat state. Renderer receives only sanitized UI events/snapshots. */
export function createClaudeWorkspace({ load, save, notify, makeTurn = createClaudeTurn }) {
  let state = { version: 1, sessions: [], activeByRoot: {} };
  const live = new Map();
  const turns = new Set();
  const timers = new Map();
  let saving = Promise.resolve(), persistTimer, disposed = false;
  const ready = Promise.resolve().then(load).then(data => {
    if (data?.version === 1 && Array.isArray(data.sessions)) state = data;
    else if (data) notify({ kind: 'storage-error', error: '检测到无法识别的 Claude Code 会话存档格式，已载入空白工作区。原文件未被修改。' });
    state.activeByRoot ||= {};
    for (const s of state.sessions) {
      s.messages ||= [];
      if (BUSY.has(s.status)) {
        s.status = 'interrupted';
        s.error = '上次对话因应用关闭而中断，可以继续发送消息。';
        for (const m of s.messages) if (m.status === 'running') m.status = 'error';
        if (s.analysis?.status === 'running') { s.analysis.status = 'interrupted'; s.analysis.error = '分析因应用关闭而中断'; }
      }
    }
  });
  const persist = (immediate = false) => {
    if (immediate) { clearTimeout(persistTimer); persistTimer = null; }
    else if (persistTimer) return;
    const flush = () => {
      persistTimer = null;
      const data = clone(state);
      saving = saving.catch(() => {}).then(() => save(data)).catch(error => {
        notify({ kind: 'storage-error', error: `对话保存失败：${error.message}` });
      });
      return saving;
    };
    if (immediate) return flush();
    persistTimer = setTimeout(flush, 300);
    persistTimer.unref?.();
  };
  const publish = (s, immediate = false) => {
    s.updatedAt = Date.now();
    s.revision = (s.revision || 0) + 1;
    if (!timers.has(s.id)) {
      const fire = () => { timers.delete(s.id); if (!disposed) notify({ sessionId: s.id, kind: 'session', session: clone(s) }); };
      if (immediate) fire();
      else timers.set(s.id, setTimeout(fire, 80));
    } else if (immediate) {
      clearTimeout(timers.get(s.id)); timers.delete(s.id);
      notify({ sessionId: s.id, kind: 'session', session: clone(s) });
    }
    persist();
  };
  const get = id => {
    const s = state.sessions.find(s => s.id === id);
    if (!s) throw new Error('对话不存在');
    return s;
  };
  const add = (s, role, text, extra = {}) => {
    const m = { id: randomUUID(), role, text, createdAt: Date.now(), ...extra };
    s.messages.push(m);
    return m;
  };
  const receive = (s, e) => {
    if (e.kind === 'closed') return;
    if (e.kind === 'init') {
      s.cliSessionId = e.cliSessionId || s.cliSessionId;
      if (e.model) s.model = e.model;
    } else if (e.kind === 'status') s.status = e.status;
    else if (e.kind === 'text') {
      let m = s.messages.find(m => m.id === e.id);
      if (!m) m = add(s, 'assistant', '', { id: e.id });
      m.text = limitText(e.replace ? e.text : m.text + e.text);
    } else if (e.kind === 'tool') {
      if (!s.messages.some(m => m.id === e.id)) add(s, 'tool', e.toolName, {
        id: e.id, toolName: e.toolName, input: e.input, status: 'running'
      });
    } else if (e.kind === 'tool-result') {
      const m = s.messages.find(m => m.id === e.id);
      if (m) { m.output = e.output; m.isError = e.isError; m.status = e.isError ? 'error' : 'done'; }
    } else if (e.kind === 'permission') {
      s.status = 'permission';
      notify({ sessionId: s.id, ...e });
    } else if (e.kind === 'permission-resolved') notify({ sessionId: s.id, ...e });
    else if (e.kind === 'end') {
      live.delete(s.id);
      if (s.analysis?.status === 'running') {
        const analysis = s.analysis;
        const output = s.messages.slice(analysis.messageStartIndex).filter(m => m.role === 'assistant').map(m => m.text).join('\n');
        const data = !e.error && s.status !== 'interrupted' ? normalizeContract(extractJson(output)) : null;
        analysis.status = s.status === 'interrupted' ? 'interrupted' : data ? 'done' : 'error';
        analysis.data = data;
        analysis.error = data ? '' : e.error || (s.status === 'interrupted' ? '分析已停止' : '未能从回复中解析出链路 JSON，可在当前会话继续交流或重新分析。');
        if (!data && !e.error && s.status !== 'interrupted') e = { ...e, error: analysis.error };
      }
      if (s.status !== 'interrupted') s.status = e.error ? 'error' : 'idle';
      s.error = e.error ? String(e.error) : '';
      if (e.error) add(s, 'system', s.error);
      for (const m of s.messages) if (m.status === 'running') m.status = e.error || s.status === 'interrupted' ? 'error' : 'done';
    }
    publish(s, e.kind === 'end' || e.kind.startsWith('permission'));
  };
  return {
    async snapshot() {
      await ready;
      return { ...clone(state), pendingRequests: [...live.entries()].flatMap(([sessionId, t]) =>
        t.pending.map(request => ({ sessionId, request }))) };
    },
    async create({ root, analysisKey, name } = {}) {
      await ready;
      if (typeof root !== 'string' || !path.isAbsolute(root) || !existsSync(root) || !statSync(root).isDirectory())
        throw new Error('请先配置有效的项目根路径');
      const normalizedRoot = path.resolve(root);
      if (analysisKey != null && (typeof analysisKey !== 'string' || !analysisKey || analysisKey.length > 100)) throw new Error('无效的分析会话标识');
        const existing = analysisKey && state.sessions.find(s => s.analysisKey === analysisKey &&
        (process.platform === 'win32' ? s.root.toLowerCase() === normalizedRoot.toLowerCase() : s.root === normalizedRoot));
      if (existing) return { ok: true, session: clone(existing) };
      const s = { id: randomUUID(), analysisKey: analysisKey || null, root: normalizedRoot, name: typeof name === 'string' ? name.slice(0, 80) : '新对话', cliSessionId: null,
        model: '', status: 'idle', messages: [], createdAt: Date.now(), updatedAt: Date.now(), revision: 0 };
      state.sessions.push(s); state.activeByRoot[s.root] = s.id;
      publish(s, true);
      return { ok: true, session: clone(s) };
    },
    async send({ id, text, contextFile, displayText, model, autoApprove = false } = {}) {
      await ready;
      const s = get(id);
      if (disposed || BUSY.has(s.status) || live.has(id)) throw new Error('当前对话正在运行');
      if (typeof text !== 'string' || !text.trim() || text.length > 100_000) throw new Error('请输入 1–100000 字的消息');
      if (model != null) {
        if (typeof model !== 'string' || !model.trim() || model.length > 100 || /[\s"']/.test(model)) throw new Error('无效的模型名称');
        model = model.trim();
      }
      if (!existsSync(s.root) || !statSync(s.root).isDirectory()) throw new Error('项目目录已不存在，请重新配置项目');
      let prompt = text.trim();
      if (contextFile && typeof contextFile === 'string') {
        const resolved = path.resolve(s.root, contextFile);
        const relative = path.relative(s.root, resolved);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('上下文文件必须位于项目目录内');
        prompt += `\n\n当前选中的项目文件：${relative}（按需阅读）`;
      }
      s.status = 'starting'; s.error = '';
      if (!s.analysisKey && !s.messages.some(m => m.role === 'user')) s.name = text.trim().slice(0, 30);
      add(s, 'user', displayText || text.trim());
      publish(s, true);
      try {
        let turn;
        turn = makeTurn({ root: s.root, resume: s.cliSessionId, text: prompt, model, autoApprove, emit: e => {
          if (e.kind === 'closed') { turns.delete(turn); return; }
          receive(s, e);
        } });
        live.set(id, turn); turns.add(turn);
      } catch (e) { receive(s, { kind: 'end', error: e.message }); return { ok: false, error: e.message }; }
      return { ok: true };
    },
    async analyze({ id, analysisSessionId, entryRel, backendRel } = {}) {
      await ready;
      const s = get(id);
      if (!Number.isSafeInteger(analysisSessionId) || analysisSessionId < 1) throw new Error('无效的分析会话');
      if (typeof entryRel !== 'string' || !entryRel.endsWith('.vue')) throw new Error('请选择 Vue 组件');
      const relative = path.relative(s.root, path.resolve(s.root, entryRel));
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('组件必须位于项目目录内');
      if (BUSY.has(s.status) || live.has(id)) throw new Error('当前会话正在运行');
      s.analysis = { runId: randomUUID(), sessionId: analysisSessionId, file: entryRel,
        status: 'running', data: null, error: '', messageStartIndex: s.messages.length };
      const prompt = `请分析当前 Vue 组件并输出链路 JSON。本任务以最高权限直接执行、无需等待确认；请保持只读分析，不要修改项目文件。\\n\\n${buildPrompt(entryRel, typeof backendRel === 'string' ? backendRel : '')}`;
      const result = await this.send({ id, text: prompt, displayText: `分析组件 ${entryRel}`, autoApprove: true });
      if (!result.ok && s.analysis.status === 'running') {
        s.analysis.status = 'error'; s.analysis.error = result.error;
        publish(s, true);
      }
      return result;
    },
    async respond({ id, requestId, allow, answers } = {}) {
      await ready;
      if (typeof allow !== 'boolean') throw new Error('无效的权限选择');
      const t = live.get(get(id).id);
      if (!t) throw new Error('对话已停止，该请求已过期');
      t.respond(requestId, allow, answers);
      return { ok: true };
    },
    async stop({ id } = {}) {
      await ready;
      const s = get(id), t = live.get(id);
      if (t) { s.status = 'interrupted'; t.stop(); live.delete(id); add(s, 'system', '已停止，可以继续发送消息。'); publish(s, true); }
      return { ok: true };
    },
    async dispose() {
      await ready;
      for (const [id, t] of live) { get(id).status = 'interrupted'; t.stop(); }
      disposed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const t of turns) t.stop();
      turns.clear();
      await persist(true);
    }
  };
}
