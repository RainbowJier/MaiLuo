import { app, BrowserWindow, ipcMain, dialog, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { readJson, writeJson } from './persist.mjs';
import { detectProjects, scanVueFiles } from './project.mjs';
import { createTerminalHost, resolveClaudeExecutable } from './terminal-host.mjs';
import nodePty from 'node-pty';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let win = null;

/* 调试日志：渲染进程 console / 预加载错误 / 加载失败 统一落到 .verify/renderer.log */
const LOG_FILE = path.join(app.getAppPath(), '.verify', 'renderer.log');
try { mkdirSync(path.dirname(LOG_FILE), { recursive: true }); writeFileSync(LOG_FILE, ''); } catch {}
function debugLog(line) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`); } catch {}
}

/* 品牌改名后 userData 目录随之变化（%APPDATA%\<appName>），首次启动时迁移旧配置 */
function migrateOldUserData() {
  try {
    const oldDir = path.join(app.getPath('appData'), 'spring-chain-view');
    const newDir = app.getPath('userData');
    if (path.resolve(oldDir) === path.resolve(newDir) || !existsSync(oldDir)) return;
    mkdirSync(newDir, { recursive: true });
    for (const f of ['config.json', 'sessions.json', 'layouts.json']) {
      const src = path.join(oldDir, f);
      const dst = path.join(newDir, f);
      if (existsSync(src) && !existsSync(dst)) copyFileSync(src, dst);
    }
    debugLog(`userData migrated: ${oldDir} -> ${newDir}`);
  } catch (e) {
    debugLog(`userData migrate failed: ${e.message}`);
  }
}
migrateOldUserData();

/** 开发期求值钩子：写入 .verify/eval.js 即在渲染进程执行，结果写入 .verify/eval.out */
let evalHarnessReady = false;
function setupDevEvalHarness() {
  if (app.isPackaged || evalHarnessReady) return;
  evalHarnessReady = true;
  const dir = path.join(app.getAppPath(), '.verify');
  const inFile = path.join(dir, 'eval.js');
  const outFile = path.join(dir, 'eval.out');
  let timer = null;
  try {
    watch(dir, (evt, fn) => {
      if (!win || win.isDestroyed()) return;
      if (fn === 'capture') {
        win.webContents.capturePage()
          .then((img) => writeFileSync(path.join(dir, 'page.png'), img.toPNG()))
          .catch((e) => debugLog(`capture failed: ${e.message}`));
        return;
      }
      if (fn !== 'eval.js') return;
      // fs.watch 会对一次写入触发多次事件，防抖后只执行一次
      clearTimeout(timer);
      timer = setTimeout(() => {
        let code;
        try { code = readFileSync(inFile, 'utf8'); } catch { return; }
        win.webContents.executeJavaScript(code, true).then(
          (v) => writeFileSync(outFile, JSON.stringify({ ok: true, value: v ?? null }, null, 2)),
          (e) => writeFileSync(outFile, JSON.stringify({ ok: false, error: String(e?.stack || e) }, null, 2))
        );
      }, 120);
    });
  } catch (e) {
    debugLog(`eval harness unavailable: ${e.message}`);
  }
}

function createWindow() {
  // 按主屏可用区域收口，避免高 DPI 缩放下窗口超出屏幕导致面板被裁
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(980, Math.min(1500, wa.width - 40));
  const height = Math.max(640, Math.min(950, wa.height - 60));

  win = new BrowserWindow({
    width,
    height,
    minWidth: 980,
    minHeight: 640,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#FAF9F5',
      symbolColor: '#1F1E1D',
      height: 32
    },
    backgroundColor: '#FAF9F5',
    title: 'MaiLuo',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false   // ESM preload 需要；渲染层仍受 contextIsolation 隔离
    }
  });
  const wc = win.webContents;
  wc.on('console-message', (_e, level, message, line, sourceId) =>
    debugLog(`console(${level}) ${message} @ ${sourceId}:${line}`));
  wc.on('preload-error', (_e, p, err) => debugLog(`preload-error ${p}: ${err?.stack || err}`));
  wc.on('did-fail-load', (_e, code, desc, url) => debugLog(`did-fail-load ${code} ${desc} ${url}`));
  wc.on('render-process-gone', (_e, d) => debugLog(`render-process-gone ${JSON.stringify(d)}`));
  wc.on('did-finish-load', () => debugLog(`did-finish-load ${wc.getURL()}`));

  // electron-vite v2 在 dev 模式注入 ELECTRON_RENDERER_URL
  const devUrl = process.env.ELECTRON_RENDERER_URL || process.env.EVITE_DEV_SERVER_URL;
  if (devUrl) {
    debugLog(`loadURL ${devUrl}`);
    win.loadURL(devUrl);
  } else {
    debugLog('loadFile ../renderer/index.html');
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  win.setMenu(null);
  setupDevEvalHarness();
}

/* 原生终端：PTY 里跑本机 claude TUI，会话 jsonl 用于分析结果提取。 */
const terminalHost = createTerminalHost({
  notify: (event) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send('terminal:event', event);
  },
  spawnPty: (file, args, options) => nodePty.spawn(file, args, options),
  debug: (line) => debugLog(line)
});
setInterval(() => terminalHost.tick(), 1000).unref();
for (const action of ['start', 'write', 'resize', 'stop', 'analyze', 'cancel']) {
  ipcMain.handle(`terminal:${action}`, async (event, data) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      throw new Error('不受信任的终端请求');
    try { return terminalHost[action](data || {}); }
    catch (e) { return { ok: false, error: e.message }; }
  });
}
let workspaceClosing = false;
app.on('before-quit', (event) => {
  if (workspaceClosing) return;
  event.preventDefault();
  workspaceClosing = true;
  terminalHost.dispose();
  app.quit();
});

/* ---------------- IPC ---------------- */

ipcMain.handle('dialog:selectFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('project:detect', async (_e, root) => detectProjects(root));
ipcMain.handle('project:scanVue', async (_e, root, frontend) => scanVueFiles(root, frontend));

ipcMain.handle('config:get', async () => {
  const c = await readJson('config.json', {});
  return { root: '', frontend: '', backend: '', ...c };
});
ipcMain.handle('config:save', async (_e, cfg) => { await writeJson('config.json', cfg); return true; });

ipcMain.handle('sessions:load', async () => readJson('sessions.json', { sessions: [], activeId: null }));
ipcMain.handle('sessions:save', async (_e, data) => { await writeJson('sessions.json', data); return true; });

ipcMain.handle('layouts:load', async () => readJson('layouts.json', {}));
ipcMain.handle('layouts:save', async (_e, data) => { await writeJson('layouts.json', data); return true; });

ipcMain.handle('groups:load', async () => readJson('groups.json', {}));
ipcMain.handle('groups:save', async (_e, data) => { await writeJson('groups.json', data); return true; });

ipcMain.handle('claude:check', async () => {
  // 与终端走同一个解析器（原生 claude.exe，不经 shell）：状态栏显示「已检测到」时，
  // 终端就一定能启动；只认 PATH 里的 .cmd 垫片会让两边结论不一致。
  const { execFile } = await import('node:child_process');
  try {
    const exe = resolveClaudeExecutable();
    const stdout = await new Promise((resolve, reject) =>
      execFile(exe, ['--version'], { windowsHide: true, timeout: 20000 }, (err, out) => err ? reject(err) : resolve(String(out))));
    return { ok: true, version: stdout.trim() };
  } catch {
    return { ok: false };
  }
});

/* 窗口控制 */
ipcMain.handle('window:minimize', () => { if (win && !win.isDestroyed()) win.minimize(); return true; });
ipcMain.handle('window:maximize', () => { if (win && !win.isDestroyed()) win.isMaximized() ? win.unmaximize() : win.maximize(); return true; });
ipcMain.handle('window:close', () => { if (win && !win.isDestroyed()) win.close(); return true; });
ipcMain.handle('window:isMaximized', () => win && !win.isDestroyed() ? win.isMaximized() : false);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
