/**
 * Claude Code CLI 分析引擎
 * - 通过子进程调用本机 claude CLI（-p 非交互 + stream-json 流式输出）
 * - 仅授予只读工具（Read/Glob/Grep），保证不改项目文件
 * - 从最终 result 消息中提取 JSON 链路契约
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const IS_WIN = process.platform === 'win32';

/** 组装分析提示词（输出契约 = 功能级链路 JSON） */
export function buildPrompt(entryRel, backendRel) {
  return `你是代码链路分析专家。请静态阅读项目源码，分析前端组件中的每个接口功能的后端完整逻辑链路。

【目标组件】frontend 侧入口文件：${entryRel}
【后端代码位置】${backendRel || '（自动探测，含 Java/Spring 代码的目录）'}

【分析步骤】
1. 阅读 ${entryRel}，找出其中所有发起 HTTP 请求的业务功能（通常每个按钮/表单/初始化对应一个功能，如 查询/新增/修改/删除）
2. 对每个功能，追踪前端侧：模板中的事件绑定 → script 中的处理函数（handleXxx）→ API 封装函数（api/*.js 或 .ts）→ 实际的 HTTP method + url
3. 在后端代码中定位对应的 Controller 映射方法，然后通读其调用链到 SQL/外部调用为止
4. 后端不要按 Controller/Service/Repository 技术分层输出，而是拆解为业务逻辑点：每个逻辑点用一句中文短语描述它"做了什么"（如：校验订单参数、计算订单总金额、扣减库存、写入订单明细）
5. 每个逻辑点标注技术锚点：类名.方法名() · 行号
6. 识别：必填参数校验失败等异常分支（✗ 中断）、@Transactional 事务边界（tx: begin/in）、乐观锁等关键机制
7. 请求参数按来源分组：path / query / body，逐个给出 name/type/req/desc

【输出要求】
最后一条消息中只输出一个 \`\`\`json 代码块，结构如下（全部字段必填，无可填空数组/null）：
{
  "file": "组件文件名",
  "functions": [
    {
      "id": "唯一短id",
      "name": "功能中文名（如 新增订单）",
      "method": "get|post|put|delete",
      "url": "请求路径",
      "desc": "一句话功能描述",
      "tag": ["success|warning", "标签文字（如 链路完整 / 含分支·事务）"],
      "front": [
        {"t": "vue",  "n": "handleXxx()", "s": "文件 · 行号"},
        {"t": "api",  "n": "apiFn(args)", "s": "api/xxx.js · 行号"},
        {"t": "http", "n": "GET /api/xxx", "s": "参数来源摘要"}
      ],
      "params": {
        "path":  [{"name":"id","type":"long","req":true,"desc":"..."}],
        "query": [],
        "body":  []
      },
      "logic": [
        {"t": "check|logic|data", "n": "逻辑点中文短语", "where": "类.方法() · 行号", "branch": false, "tx": null}
      ],
      "branchText": ["✓ 校验通过 → 继续", "✗ 失败 → 异常 → 状态码"],
      "clsCount": 涉及类数量
    }
  ]
}
注意：front 固定三段 vue→api→http；logic 中 branch=true 表示该逻辑点有失败中断分支；tx 取值 "begin"（事务开始）或 "in"（事务内）或 null。`;
}

/** 一份契约至少要有 一个功能；空壳/残缺的对象不算，提取要继续往后找真正的契约。 */
const isContract = parsed => !!parsed && Array.isArray(parsed.functions) && parsed.functions.length > 0;

/** 从 claude 最终输出中提取 JSON 契约（容错：多个代码块从后往前试、裸 JSON 兜底） */
export function extractJson(text) {
  if (!text) return null;
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1]);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const parsed = tryParse(blocks[i]);
    if (isContract(parsed)) return parsed;
  }
  // 裸 JSON：从每个 '{' 起做花括号配对。模型在契约前面常有叙述文字，其中可能出现
  // 不成对的括号或孤立的引号（如 “参数 {id}”、"POST"），所以不能只从全文第一个 '{' 扫一次；
  // 每个候选起点各自重置字符串状态，叙述里的杂字符不会污染后面的真正契约。
  const budget = { left: 8_000_000 };   // 扫描字符预算：病态输入（大量不成对括号）不能拖垮主进程
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    const end = matchingBrace(text, start, budget);
    if (end < 0) { if (budget.left <= 0) break; continue; }
    const candidate = text.slice(start, end + 1);
    if (!candidate.includes('"functions"')) continue;
    const parsed = tryParse(candidate);
    if (isContract(parsed)) return parsed;
  }
  return null;
}
/** 返回与 text[start] 的 '{' 配对的 '}' 下标；字符串内的括号不算，找不到返回 -1。 */
function matchingBrace(text, start, budget) {
  let depth = 0, inStr = false;
  for (let i = start; i < text.length; i++) {
    if (--budget.left < 0) return -1;
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;            // 跳过转义字符
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}
function tryParse(s) {
  try { return JSON.parse(s); }
  catch {
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); }  // 容忍尾逗号
    catch { return null; }
  }
}

/** 模型输出里的元素可能是 null / 非对象：逐个兜底，不让一条脏数据抛异常打断整份契约。 */
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/**
 * 归一化契约数据（补默认值、校验结构），返回 null 表示无效。
 * 对任意形状的输入都不抛异常（这里跑在主进程的定时器里，抛出会触发 Electron 的错误弹窗）。
 */
export function normalizeContract(raw) {
  raw = obj(raw);
  if (!Array.isArray(raw.functions) || !raw.functions.length) return null;
  const usedIds = new Set();
  const functions = raw.functions.map((item, i) => {
    const f = obj(item);
    const base = String(f.id || `fn${i}`);
    // 功能 id 被 Vue 的 key 和图节点名引用，重复会让页签/节点互相覆盖
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}_${n}`;
    usedIds.add(id);
    return {
      id,
      name: String(f.name || `功能${i + 1}`),
      // 模型常把方法写成大写（"POST"）：不归一的话会被静默当成 get 显示
      method: ['get', 'post', 'put', 'delete'].includes(String(f.method || '').toLowerCase())
        ? String(f.method).toLowerCase() : 'get',
      url: String(f.url || '/'),
      desc: String(f.desc || ''),
      tag: Array.isArray(f.tag) && f.tag.length === 2 ? f.tag.map(String) : ['success', '链路完整'],
      front: (Array.isArray(f.front) ? f.front : []).slice(0, 3).map(item => {
        const s = obj(item);
        return { t: s.t || 'vue', n: String(s.n || ''), s: String(s.s || '') };
      }),
      params: {
        path:  arr(obj(f.params).path),
        query: arr(obj(f.params).query),
        body:  arr(obj(f.params).body),
      },
      logic: (Array.isArray(f.logic) ? f.logic : []).map(item => {
        const l = obj(item);
        return {
          t: ['check', 'logic', 'data'].includes(l.t) ? l.t : 'logic',
          n: String(l.n || ''), where: String(l.where || ''),
          branch: !!l.branch, tx: l.tx === 'begin' || l.tx === 'in' ? l.tx : null
        };
      }),
      branchText: Array.isArray(f.branchText) ? f.branchText.map(String) : [],
      clsCount: Number(f.clsCount) || 0,
    };
  });
  return { file: String(raw.file || ''), functions };
}
function arr(a) {
  return (Array.isArray(a) ? a : []).map(p => ({
    name: String(p?.name || ''), type: String(p?.type || ''),
    req: !!p?.req, desc: String(p?.desc || '')
  })).filter(p => p.name);
}

/**
 * 运行 claude CLI
 * @returns {{promise: Promise<{ok:boolean,data?:object,error?:string,raw:string}>, cancel: () => void, child: object}}
 */
export function runClaudeAnalysis({ cwd, prompt, onLine, onStatus }) {
  let settled = false;
  let child = null;

  const promise = new Promise((resolve) => {
    onStatus?.('running');
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--allowedTools', 'Read,Glob,Grep',
      '--max-turns', '60'
    ];
    try {
      child = spawn('claude', args, { cwd, shell: IS_WIN, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: `claude 启动失败: ${e.message}`, raw: '' });
      return;
    }

    let raw = '';
    let buf = '';

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: `无法启动 claude CLI（${e.message}）。请确认已安装并在 PATH 中。`, raw });
    });

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let evt = null;
        try { evt = JSON.parse(line); } catch { onLine?.(line); continue; }
        if (evt.type === 'assistant' && evt.message?.content) {
          for (const c of evt.message.content) {
            if (c.type === 'text' && c.text) {
              raw += c.text;
              for (const l of c.text.split('\n')) onLine?.(l);
            } else if (c.type === 'tool_use') {
              onLine?.(`  ⚙ ${c.name} ${summarizeInput(c.input)}`);
            }
          }
        } else if (evt.type === 'result') {
          raw += evt.result || '';
          if (evt.result) for (const l of String(evt.result).split('\n')) onLine?.(l);
          onStatus?.('parsing');
        }
      }
    });

    child.stderr?.on('data', (chunk) => {
      const s = chunk.toString('utf8').trim();
      if (s) onLine?.(`[stderr] ${s}`);
    });

    child.stdin.on('error', () => {});  // stdin 可能提前关闭
    child.stdin.end(prompt, 'utf8');

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      const contract = extractJson(raw);
      const data = contract ? normalizeContract(contract) : null;
      if (data) {
        onStatus?.('done');
        resolve({ ok: true, data, raw });
      } else {
        onStatus?.('error');
        resolve({ ok: false, error: '未能从 Claude 输出中解析出链路 JSON 契约（可重试，或查看终端原始输出排查）', raw });
      }
      void code;
    });
  });

  return {
    promise,
    cancel: () => { try { child?.kill(); } catch {} },
    get child() { return child; }
  };
}

function summarizeInput(input) {
  if (!input) return '';
  const p = input.file_path || input.path || input.pattern || '';
  return p ? String(p).split(/[\\/]/).slice(-2).join('/') : '';
}
