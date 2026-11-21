/** 项目探测与 Vue 组件扫描（只读文件系统操作） */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.svn', 'target', 'out', '.idea', '.vscode', 'coverage']);

/** 探测前后端子目录：package.json → 前端候选；pom.xml/build.gradle → 后端候选 */
export async function detectProjects(root) {
  const result = { root, frontend: '', backend: '', candidates: [] };
  if (!root) return result;
  const dirs = ['', ...(await safeReaddir(root, { withFileTypes: true }))
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name))
    .map(d => d.name)];
  for (const d of dirs) {
    const full = path.join(root, d);
    const isFe = await exists(path.join(full, 'package.json'));
    const isBe = (await exists(path.join(full, 'pom.xml'))) || (await exists(path.join(full, 'build.gradle'))) || (await exists(path.join(full, 'build.gradle.kts')));
    if (isFe || isBe) result.candidates.push({ dir: d || '(根目录)', isFe, isBe });
  }
  // 自动取最佳猜测：优先子目录，其次根目录
  result.frontend = best(result.candidates.filter(c => c.isFe)) ?? '';
  result.backend = best(result.candidates.filter(c => c.isBe)) ?? '';
  return result;
}
function best(list) {
  if (!list.length) return '';
  const sub = list.find(c => c.dir !== '(根目录)');
  return sub ? sub.dir : list[0].dir;
}

/** 扫描前端目录下所有 .vue 文件（相对根路径），按目录分组 */
export async function scanVueFiles(root, frontendRel, limit = 800) {
  const feDir = path.resolve(root, frontendRel || '.');
  const out = [];
  await walk(feDir, feDir, out, 0, limit);
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}
async function walk(base, dir, out, depth, limit) {
  if (out.length >= limit || depth > 8) return;
  const entries = await safeReaddir(dir, { withFileTypes: true });
  // 目录优先排序，文件按名称
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : (a.isDirectory() ? -1 : 1)));
  for (const e of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.') || e.name.startsWith('__')) continue;
      await walk(base, full, out, depth + 1, limit);
    } else if (e.name.endsWith('.vue')) {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      const i = rel.lastIndexOf('/');
      out.push({ rel, dir: i >= 0 ? rel.slice(0, i) : '.', name: e.name });
    }
  }
}

/** 读取文件前 N 行文本（用于估算行数等，可选） */
export async function headFile(fullPath, lines = 5) {
  try {
    const txt = await readFile(fullPath, 'utf8');
    return txt.split('\n').slice(0, lines).join('\n');
  } catch { return ''; }
}

async function safeReaddir(p, opt) { try { return await readdir(p, opt); } catch { return []; } }
async function exists(p) { try { await stat(p); return true; } catch { return false; } }
