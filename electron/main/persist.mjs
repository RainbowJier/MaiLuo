import { app } from 'electron';
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

function fileOf(name) {
  return path.join(app.getPath('userData'), name);
}

/** 同一文件的写入串行执行：并发写各用各的临时文件，后发起的内容不会被先发起的覆盖回去。 */
const queues = new Map();
let seq = 0;

export async function readJson(name, fallback) {
  const f = fileOf(name);
  try {
    const txt = await readFile(f, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    // 文件存在但解析失败（写入途中被杀、磁盘满导致的半截 JSON）：先把残件另存一份。
    // 否则这里的 fallback 会被当成「没有数据」，下一次保存就把还能抢救的内容永久覆盖掉。
    if (e instanceof SyntaxError) {
      try { await copyFile(f, `${f}.corrupt-${Date.now()}`); } catch { /* best effort */ }
    }
    return fallback;
  }
}

export function writeJson(name, data) {
  const f = fileOf(name);
  const prev = queues.get(name) || Promise.resolve();
  const next = prev.then(() => writeAtomic(f, JSON.stringify(data)));
  queues.set(name, next.catch(() => {}));
  return next;
}

/** 先写临时文件再原子替换：进程被杀/断电不会在原文件里留下半截 JSON。 */
async function writeAtomic(f, content) {
  await mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${++seq}.tmp`;
  await writeFile(tmp, content, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try { await rename(tmp, f); return; }
    catch (e) {
      // Windows 上目标文件可能被杀软/索引器短暂占用（EPERM/EBUSY/EACCES），稍后重试
      const busy = e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES');
      if (busy && attempt < 4) { await new Promise(r => setTimeout(r, 50 * (attempt + 1))); continue; }
      // 实在替换不了也不能丢数据：退回直接写入原文件（失败则原样抛给调用方），并清掉临时文件
      try { await writeFile(f, content, 'utf8'); }
      finally { try { await unlink(tmp); } catch { /* tmp 已不存在 */ } }
      return;
    }
  }
}
