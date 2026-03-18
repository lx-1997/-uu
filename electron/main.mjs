import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, WebContentsView, ipcMain, shell } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getRendererUrl() {
  if (process.env.RDK_STUDIO_RENDERER_URL) {
    return process.env.RDK_STUDIO_RENDERER_URL;
  }
  if (!app.isPackaged) {
    return 'http://localhost:5173';
  }
  return `file://${path.join(__dirname, '../dist/index.html')}`;
}

// 侧边栏宽度 + 顶部工具栏高度（与 src/styles/layout.css 保持一致）
const SIDEBAR_W = 260;
const TOPBAR_H = 48;

let mainWin = null;
// url -> WebContentsView 映射
const viewsMap = {};

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
    // 已存在则显示
    viewsMap[url].setVisible(true);
    return;
  }

  const view = new WebContentsView();
  // 忽略证书错误（设备自签名证书）
  view.webContents.session.setCertificateVerifyProc((_req, cb) => cb(0));
  mainWin.contentView.addChildView(view);
  view.setBounds(calcViewBounds(mainWin));
  view.webContents.loadURL(url);

  // 子页面弹出的新窗口，通知渲染层处理
  view.webContents.setWindowOpenHandler((details) => {
    event.sender.send('rdk:sub-url-open', details.url);
    return { action: 'deny' };
  });

  viewsMap[url] = view;
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
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
