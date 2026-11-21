#!/usr/bin/env node
/**
 * electron-vite 启动包装器
 * 问题：从某些 IDE / 终端会话继承 ELECTRON_RUN_AS_NODE=1 时，
 * electron 二进制会退化成纯 Node 运行，导致主进程 ESM 加载失败：
 *   TypeError: Cannot read properties of undefined (reading 'exports')
 * 这里在派生子进程前显式清掉该变量，保证 electron 以 GUI 模式启动。
 *
 * 用法：
 *   node scripts/dev.mjs            -> electron-vite dev
 *   node scripts/dev.mjs preview    -> electron-vite preview
 *   node scripts/dev.mjs build      -> electron-vite build
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const cli = path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
const args = process.argv.slice(2);
if (!args.length) args.push('dev');

const child = spawn(process.execPath, [cli, ...args], {
  cwd: root,
  env,
  stdio: 'inherit'
});

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (e) => {
  console.error('[dev] 启动 electron-vite 失败:', e.message);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { child.kill(sig); } catch {} });
}
