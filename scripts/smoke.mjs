/**
 * 端到端冒烟：真实调用本机 claude CLI 分析 samples/demo-app，
 * 验证 提示词 → stream-json 流 → JSON 契约解析 全链路。
 * 用法：npm run smoke
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeAnalysis, buildPrompt } from '../electron/main/analyzer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../samples/demo-app');
const ENTRY = 'frontend/src/views/OrderList.vue';
const BACKEND = 'backend';

console.log(`[smoke] cwd=${ROOT}`);
console.log(`[smoke] entry=${ENTRY}`);
const prompt = buildPrompt(ENTRY, BACKEND);
console.log(`[smoke] prompt ${prompt.length} chars, starting claude…\n`);

let lineCount = 0;
const t0 = Date.now();
const ctrl = runClaudeAnalysis({
  cwd: ROOT,
  prompt,
  onLine: (line) => {
    lineCount++;
    if (lineCount <= 40 || line.startsWith('✓') || line.startsWith('✗')) console.log('  ', line.slice(0, 110));
  },
  onStatus: (st) => console.log(`[status] ${st}`)
});

const r = await ctrl.promise;
console.log(`\n[smoke] finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${lineCount} lines`);

if (r.ok) {
  const { functions } = r.data;
  console.log(`[smoke] ✓ 解析成功：file=${r.data.file} functions=${functions.length}`);
  for (const f of functions) {
    console.log(`  - ${f.method.toUpperCase()} ${f.url} 「${f.name}」 front=${f.front.length} logic=${f.logic.length} ` +
      `params=${f.params.path.length + f.params.query.length + f.params.body.length}`);
    for (const l of f.logic) console.log(`      ${l.t.padEnd(5)} ${l.n}  ←  ${l.where}`);
  }
  process.exit(0);
} else {
  console.error('[smoke] ✗ 失败：', r.error);
  console.error('[smoke] raw tail:', r.raw.slice(-600));
  process.exit(1);
}
