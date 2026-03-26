import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import * as flashService from './flash/index.mjs';

/* 开发态加载 Vite，CSP 需含 unsafe-eval（HMR）；Electron 会刷 CSP 警告，与业务漏洞无直接关系 */
if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PORT = 8787;
const SERVER_BOOT_TIMEOUT_MS = 15_000;
const SERVER_SHUTDOWN_GRACE_MS = 2_500;

// 侧边栏宽度 + 顶部工具栏高度（与 src/styles/layout.css 保持一致）
const SIDEBAR_W = 260;
const TOPBAR_H = 48;
const DOCK_RESERVED_H = 170;

let mainWin = null;
let serverProcess = null;
// url -> WebContentsView 映射
const viewsMap = {};
let latestRendererBounds = null;
function normalizeRendererBounds(win, raw) {
  const [cw, ch] = win.getContentSize();
  const x = Math.max(0, Math.min(Math.round(raw?.x ?? 0), Math.max(0, cw - 10)));
  const y = Math.max(0, Math.min(Math.round(raw?.y ?? 0), Math.max(0, ch - 10)));
  const width = Math.max(100, Math.min(Math.round(raw?.width ?? 0), Math.max(100, cw - x)));
  const height = Math.max(120, Math.min(Math.round(raw?.height ?? 0), Math.max(120, ch - y)));
  return { x, y, width, height };
}

function getViewBounds(win) {
  if (latestRendererBounds) {
    return normalizeRendererBounds(win, latestRendererBounds);
  }
  return calcViewBounds(win);
}
/* ── 镜像下载（跨平台公共逻辑，不依赖平台适配层） ── */
function emitFlashProgress(payload) {
  mainWin?.webContents.send('rdk:flash:progress', payload);
}

function downloadFile(url, destPath) {
  const client = url.startsWith('https://') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(downloadFile(res.headers.location, destPath));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载失败: HTTP ${res.statusCode || 'unknown'}`));
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let done = 0;
      const writer = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        done += chunk.length;
        if (total > 0) {
          const percent = Math.min(98, Math.max(1, Math.round((done / total) * 96) + 1));
          emitFlashProgress({ stage: 'downloading', message: `下载 ${(done / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB`, percent });
        }
      });
      res.pipe(writer);
      writer.on('finish', () => {
        writer.close(() => resolve(destPath));
      });
      writer.on('error', reject);
    });
    req.on('error', reject);
  });
}

ipcMain.handle('rdk:flash:download-image', async (_event, payload) => {
  const url = String(payload?.url || '').trim();
  const destDir = String(payload?.destDir || path.join(os.homedir(), 'Downloads')).trim();
  if (!url) return { ok: false, error: '缺少下载地址 url' };
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const fileName = path.basename(new URL(url).pathname || `rdk-${Date.now()}.img`);
    const destPath = path.join(destDir, fileName);
    await downloadFile(url, destPath);
    emitFlashProgress({ stage: 'downloading', message: '下载完成', percent: 100 });
    return { ok: true, path: destPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '下载失败' };
  }
});

ipcMain.handle('rdk:flash:decompress-image', async (_event, payload) => {
  const filePath = String(payload?.filePath || '').trim();
  if (!filePath) return { ok: false, error: '缺少 filePath' };
  if (!filePath.toLowerCase().endsWith('.xz')) return { ok: true, outputPath: filePath };
  return flashService.decompressXz(filePath);
});

/* ── 判断是否打包模式 ── */
const isPacked = app.isPackaged;

/* ── 获取应用根目录（ASAR 内） ── */
function getAppRoot() {
  if (isPacked) {
    return app.getAppPath();
  }
  return path.join(__dirname, '..');
}

/* ── 启动内嵌 Express 服务器（仅生产模式） ── */
function stopEmbeddedServer() {
  const proc = serverProcess;
  if (!proc) return Promise.resolve();
  serverProcess = null;

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const forceTimer = setTimeout(() => {
      if (proc.killed) {
        finish();
        return;
      }
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore force-kill failures
      }
      finish();
    }, SERVER_SHUTDOWN_GRACE_MS);

    proc.once('exit', () => {
      clearTimeout(forceTimer);
      finish();
    });

    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(forceTimer);
      finish();
    }
  });
}

function startEmbeddedServer() {
  if (!isPacked) return Promise.resolve(SERVER_PORT);

  return new Promise((resolve, reject) => {
    // asar: false 时 app.getAppPath() 指向 resources/app/ (真实目录)
    // tsconfig.server.json 的 rootDir 是项目根，所以 server/index.ts 编译到 dist-server/server/index.js
    const serverPath = path.join(getAppRoot(), 'dist-server', 'server', 'index.js');
    const envDataDir = String(process.env.RDK_DATA_DIR || '').trim();
    const dataPath = envDataDir || path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(dataPath, { recursive: true });

    console.log('[server] starting embedded server:', serverPath);
    console.log('[server] data path:', dataPath);

    const child = spawn(process.execPath, [serverPath], {
      cwd: getAppRoot(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(SERVER_PORT),
        NODE_ENV: 'production',
        RDK_DATA_DIR: dataPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess = child;

    let settled = false;
    const stderrTail = [];
    const pushStderr = (chunk) => {
      stderrTail.push(chunk);
      const joined = stderrTail.join('');
      if (joined.length > 6000) {
        stderrTail.length = 0;
        stderrTail.push(joined.slice(-4000));
      }
    };

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(bootTimer);
      fn(value);
    };

    const bootTimer = setTimeout(() => {
      const hint = stderrTail.join('').trim();
      settle(
        reject,
        new Error(
          `内置服务启动超时（>${SERVER_BOOT_TIMEOUT_MS}ms）${hint ? `\n\n最近日志:\n${hint.slice(-2000)}` : ''}`,
        ),
      );
    }, SERVER_BOOT_TIMEOUT_MS);

    child.stdout?.on('data', (data) => {
      const msg = data.toString();
      console.log('[server]', msg.trim());
      if (msg.includes('running on')) {
        settle(resolve, SERVER_PORT);
      }
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      pushStderr(text);
      console.error('[server:err]', text.trim());
    });

    child.on('error', (err) => {
      console.error('[server] failed to start:', err);
      settle(reject, err);
    });

    child.on('exit', (code, signal) => {
      console.error('[server] exited:', { code, signal });
      if (!settled) {
        const tail = stderrTail.join('').trim();
        settle(
          reject,
          new Error(
            `内置服务启动失败，进程已退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`
            + (tail ? `\n\n最近 stderr:\n${tail.slice(-2500)}` : ''),
          ),
        );
      }
    });
  });
}

/* ── 等待服务器就绪 ── */
async function waitForServer(port, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        console.log(`[server] ready on port ${port}`);
        return true;
      }
    } catch {
      // 还没就绪
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn('[server] did not respond in time, continuing anyway');
  return false;
}

/* ── 获取渲染层 URL ── */
function getRendererUrl() {
  if (process.env.RDK_STUDIO_RENDERER_URL) {
    return process.env.RDK_STUDIO_RENDERER_URL;
  }
  if (isPacked) {
    return pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  }
  return 'http://localhost:5173';
}

function calcViewBounds(win) {
  const [w, h] = win.getContentSize();
  const width = Math.max(100, w - SIDEBAR_W);
  const height = Math.max(120, h - TOPBAR_H - DOCK_RESERVED_H);
  return {
    x: SIDEBAR_W,
    y: TOPBAR_H,
    width,
    height,
  };
}

async function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    title: 'RDK Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 外部链接用系统浏览器打开
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const target = getRendererUrl();

  let loadRetries = 0;
  mainWin.webContents.on('did-fail-load', (_ev, _code, desc, failUrl) => {
    if (loadRetries < 5 && failUrl === target) {
      loadRetries += 1;
      console.log('[main] load failed (' + desc + '), retry ' + loadRetries + '/5');
      setTimeout(() => {
        if (mainWin && !mainWin.isDestroyed()) mainWin.loadURL(target).catch(() => {});
      }, 1500);
    }
  });

  await mainWin.loadURL(target);

  // 窗口 resize 时同步所有 WebContentsView 的尺寸
  let resizeTimer = null;
  mainWin.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const bounds = getViewBounds(mainWin);
      for (const url in viewsMap) {
        const view = viewsMap[url];
        if (view && !view.webContents.isDestroyed()) {
          view.setBounds(bounds);
        }
      }
      resizeTimer = null;
    }, 16);
  });

  return mainWin;
}

// ── IPC: 打开嵌入页面 ──
ipcMain.on('rdk:open-url', (event, { url }) => {
  if (!mainWin) return;

  if (viewsMap[url]) {
    const existing = viewsMap[url];
    existing.setVisible(true);
    mainWin.contentView.removeChildView(existing);
    mainWin.contentView.addChildView(existing);
    existing.setBounds(getViewBounds(mainWin));
    return;
  }

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  view.webContents.session.setCertificateVerifyProc((_req, cb) => cb(0));

  const bounds = getViewBounds(mainWin);
  view.setBounds(bounds);
  mainWin.contentView.addChildView(view);

  console.log(`[rdk:open-url] loading ${url}, bounds:`, bounds);

  view.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    console.error(`[rdk:open-url] did-fail-load ${url}: ${errorCode} ${errorDescription}`);
    event.sender.send('rdk:url-load-failed', { url, errorCode, errorDescription });
  });

  view.webContents.on('did-finish-load', () => {
    console.log(`[rdk:open-url] did-finish-load ${url}`);
    event.sender.send('rdk:url-loaded', { url });
  });

  view.webContents.loadURL(url).catch(err => {
    console.error(`[rdk:open-url] failed to load ${url}:`, err.message);
  });

  view.webContents.setWindowOpenHandler((details) => {
    event.sender.send('rdk:sub-url-open', details.url);
    return { action: 'deny' };
  });

  viewsMap[url] = view;
});

// ── IPC: Tab 切换时同步 WebContentsView 可见性 ──
// 渲染层切换 tab 时发送当前活跃的 url（或 null 表示无嵌入视图）
ipcMain.on('rdk:set-active-url', (_event, { url }) => {
  for (const u in viewsMap) {
    const view = viewsMap[u];
    if (!view || view.webContents.isDestroyed()) continue;
    if (u === url) {
      view.setVisible(true);
      // 确保在最顶层
      mainWin?.contentView.removeChildView(view);
      mainWin?.contentView.addChildView(view);
      if (mainWin) view.setBounds(getViewBounds(mainWin));
    } else {
      view.setVisible(false);
    }
  }
});

// ── IPC: 渲染层上报 canvas-viewport 的真实像素边界（用于精确贴合 WebContentsView） ──
ipcMain.on('rdk:update-view-bounds', (_event, { bounds }) => {
  if (!mainWin || !bounds) return;
  latestRendererBounds = bounds;
  const nextBounds = getViewBounds(mainWin);
  for (const url in viewsMap) {
    const view = viewsMap[url];
    if (view && !view.webContents.isDestroyed()) {
      view.setBounds(nextBounds);
    }
  }
});

// ── IPC: 隐藏嵌入页面 ──
ipcMain.on('rdk:hide-url', (_event, { url }) => {
  if (viewsMap[url]) {
    viewsMap[url].setVisible(false);
  }
});

// ── IPC: 关闭并销毁嵌入页面 ──
ipcMain.on('rdk:close-url', (_event, { url }) => {
  if (!viewsMap[url]) return;
  const view = viewsMap[url];
  mainWin?.contentView.removeChildView(view);
  view.webContents.removeAllListeners();
  view.webContents.destroy();
  delete viewsMap[url];
});

ipcMain.handle('rdk:flash:get-capabilities', async () => {
  return flashService.getCapabilities();
});

ipcMain.handle('rdk:flash:list-drives', async () => {
  return flashService.listDrives();
});

ipcMain.handle('rdk:flash:pick-image', async () => {
  const isMac = process.platform === 'darwin';
  const filters = isMac
    ? [{ name: 'Image Files', extensions: ['img', 'bin', 'wic', 'xz', 'zip', 'dmg'] }]
    : [{ name: 'Image Files', extensions: ['img', 'bin', 'wic', 'wic.gz', 'img.xz', 'xz'] }];
  const result = await dialog.showOpenDialog(mainWin ?? undefined, {
    properties: ['openFile'],
    filters,
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('rdk:flash:write-local', async (_event, payload) => {
  const { imagePath, drivePath, verifyMode } = payload ?? {};
  if (!imagePath || !drivePath) return { ok: false, error: '缺少镜像路径或目标磁盘' };
  return flashService.writeImage(imagePath, drivePath, { verifyMode });
});

ipcMain.handle('rdk:flash:verify-local', async (_event, payload) => {
  const { imagePath, drivePath } = payload ?? {};
  if (!imagePath || !drivePath) return { ok: false, error: '缺少镜像路径或目标磁盘' };
  return flashService.verifyImage(imagePath, drivePath);
});

ipcMain.handle('rdk:flash:backup-local', async (_event, payload) => {
  const { drivePath, destPath } = payload ?? {};
  if (!drivePath) return { ok: false, error: '缺少目标磁盘路径 drivePath' };
  return flashService.backupDrive(drivePath, destPath);
});

ipcMain.handle('rdk:flash:cancel', async () => {
  return flashService.cancelActiveOp();
});

ipcMain.handle('rdk:flash:get-active-op', async () => {
  return flashService.getActiveOperation();
});

ipcMain.handle('rdk:flash:launch-xburn', async (_event, payload) => {
  let toolPath = payload?.exePath;
  if (!toolPath) {
    const isMac = process.platform === 'darwin';
    const filters = isMac
      ? [{ name: 'xburn', extensions: ['app', 'dmg'] }]
      : [{ name: 'xburn', extensions: ['exe'] }];
    const title = isMac ? '选择 xburn-gui.app' : '选择 xburn-gui.exe';
    const picked = await dialog.showOpenDialog(mainWin ?? undefined, {
      properties: ['openFile'],
      filters,
      title,
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };
    toolPath = picked.filePaths[0];
  }
  try {
    const result = await flashService.launchThirdPartyTool(toolPath);
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '启动 xburn 失败' };
  }
});

app.whenReady().then(async () => {
  // 初始化跨平台 flash service
  flashService.initFlashService({
    platform: process.platform,
    webContentsSend: (...args) => mainWin?.webContents.send(...args),
  });

  // 生产模式：先启动内嵌服务器
  if (isPacked) {
    try {
      await startEmbeddedServer();
      const ready = await waitForServer(SERVER_PORT);
      if (!ready) {
        throw new Error(`内置服务健康检查失败（端口 ${SERVER_PORT}）`);
      }
    } catch (err) {
      console.error('[main] server startup failed:', err);
      dialog.showErrorBox(
        'RDK Studio 启动失败',
        `内置服务未能正常启动，请检查端口 ${SERVER_PORT} 是否被占用，或查看日志后重试。\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      await stopEmbeddedServer();
      app.quit();
      return;
    }
  }

  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  await stopEmbeddedServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await stopEmbeddedServer();
});
