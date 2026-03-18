import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, WebContentsView, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 侧边栏宽度 + 顶部工具栏高度（与 src/styles/layout.css 保持一致）
const SIDEBAR_W = 260;
const TOPBAR_H = 48;

let mainWin = null;
let serverProcess = null;
// url -> WebContentsView 映射
const viewsMap = {};

/* ── 判断是否打包模式 ── */
const isPacked = app.isPackaged;

/* ── 获取资源根目录 ── */
function getResourcesPath() {
  if (isPacked) {
    return process.resourcesPath;
  }
  return path.join(__dirname, '..');
}

/* ── 启动内嵌 Express 服务器（仅生产模式） ── */
function startEmbeddedServer() {
  if (!isPacked) return Promise.resolve(8787);

  return new Promise((resolve, reject) => {
    const serverPath = path.join(getResourcesPath(), 'dist-server', 'index.js');
    const dataPath = path.join(getResourcesPath(), 'data');

    console.log('[server] starting embedded server:', serverPath);

    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        PORT: '8787',
        NODE_ENV: 'production',
        // 数据目录指向 resources/data
        RDK_DATA_DIR: dataPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout?.on('data', (data) => {
      const msg = data.toString();
      console.log('[server]', msg.trim());
      if (msg.includes('running on')) {
        resolve(8787);
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      console.error('[server:err]', data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      console.error('[server] failed to start:', err);
      reject(err);
    });

    // 5s 超时兜底
    setTimeout(() => resolve(8787), 5000);
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
    return `file://${path.join(__dirname, '../dist/index.html')}`;
  }
  return 'http://localhost:5173';
}

function calcViewBounds(win) {
  const [w, h] = win.getContentSize();
  return {
    x: SIDEBAR_W,
    y: TOPBAR_H,
    width: w - SIDEBAR_W,
    height: h - TOPBAR_H,
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
  await mainWin.loadURL(target);

  // 窗口 resize 时同步所有 WebContentsView 的尺寸
  let resizeTimer = null;
  mainWin.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const bounds = calcViewBounds(mainWin);
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
    existing.setBounds(calcViewBounds(mainWin));
    return;
  }

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  view.webContents.session.setCertificateVerifyProc((_req, cb) => cb(0));

  const bounds = calcViewBounds(mainWin);
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
      view.setBounds(calcViewBounds(mainWin));
    } else {
      view.setVisible(false);
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

app.whenReady().then(async () => {
  // 生产模式：先启动内嵌服务器
  if (isPacked) {
    try {
      await startEmbeddedServer();
      await waitForServer(8787);
    } catch (err) {
      console.error('[main] server startup failed:', err);
    }
  }

  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 关闭内嵌服务器
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
