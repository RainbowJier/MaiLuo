/**
 * node-pty 1.1.0 的 npm 包在 Windows 上有两处构建坑，安装后自动修补：
 * 1. gyp 显式要求 Spectre 缓解库（多数机器未装该 VS 组件）→ 改为 false。
 * 2. 修补后需为 Electron 重建原生模块：
 *    env -u NoDefaultCurrentDirectoryInExePath npx @electron/rebuild -f -w node-pty -v 33.4.11
 *    （NoDefaultCurrentDirectoryInExePath 会让 cmd 找不到当前目录下的 .bat）
 */
import fs from 'node:fs';
import path from 'node:path';

const files = [
  'node_modules/node-pty/binding.gyp',
  'node_modules/node-pty/deps/winpty/src/winpty.gyp'
];
let patched = 0;
for (const rel of files) {
  const file = path.resolve(process.cwd(), rel);
  try {
    const source = fs.readFileSync(file, 'utf8');
    const next = source.replaceAll("'SpectreMitigation': 'Spectre'", "'SpectreMitigation': 'false'");
    if (next !== source) {
      fs.writeFileSync(file, next);
      patched += 1;
      console.log(`[patch-node-pty] ${rel}: SpectreMitigation -> false`);
    }
  } catch { /* not installed yet; npm install 会先跑自己的构建 */ }
}
if (!patched) console.log('[patch-node-pty] nothing to patch');
