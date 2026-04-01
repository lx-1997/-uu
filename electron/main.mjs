import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, screen, Menu, session } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import * as flashService from './flash/index.mjs';
import { validateS100ImagePick } from './flash/xburn-s100.mjs';
import { registerSsoLoginIpc } from './sso-ipc.mjs';
import { listWindowsSerialPorts } from './list-windows-serial-ports.mjs';
import { registerSerialPortPickerHandlers } from './serial-port-picker.mjs';

/* 开发态加载 Vite，CSP 需含 unsafe-eval（HMR）；Electron 会刷 CSP 警告，与业务漏洞无直接关系 */
if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PORT = 8787;
const SERVER_BOOT_TIMEOUT_MS = 15_000;
const SERVER_SHUTDOWN_GRACE_MS = 2_500;

// 与 src/styles/tokens.css --rail-width（56）及 shell 网格一致；勿用旧版 260，否则回退 bounds 时左侧整段仍显示 React「前页」
const RAIL_W = 56;
const TOPBAR_H = 48;

/** S100 一键烧写（主要为 Windows）：缓存已解析的 xburn 路径；首次在无缓存时尝试 `where xburn` + 常见安装目录，失败再弹窗选 xburn-gui.exe。macOS 另有自动解析。 */
const S100_XBURN_GUI_CACHE_FILE = 's100-xburn-gui-path.txt';

function getS100XburnGuiCachePath() {
  return path.join(app.getPath('userData'), S100_XBURN_GUI_CACHE_FILE);
}

function readCachedS100XburnGuiPath() {
  try {
    const f = getS100XburnGuiCachePath();
    if (!fs.existsSync(f)) return '';
    const p = fs.readFileSync(f, 'utf8').trim();
    if (!p) return '';
    return fs.existsSync(p) ? p : '';
  } catch {
    return '';
  }
}

function writeCachedS100XburnGuiPath(p) {
  try {
    const s = typeof p === 'string' ? p.trim() : '';
    if (!s) return;
    fs.writeFileSync(getS100XburnGuiCachePath(), s, 'utf8');
  } catch {
    /* ignore */
  }
}

/** S100 一键烧写：选 xburn-gui（与「固件 zip/文件夹」无关，需在文案里写清楚） */
function buildS100XburnGuiOpenDialogOptions() {
  const isMac = process.platform === 'darwin';
  const filters = isMac
    ? [{ name: 'xburn-gui', extensions: ['app', 'dmg'] }]
    : [{ name: 'xburn', extensions: ['exe'] }];
  const title = isMac
    ? '选择 xburn 烧写程序（不是固件镜像）'
    : '选择 xburn-gui.exe（不是固件；须与同目录 xburn.exe 配套）';
  const message = isMac
    ? '固件已在应用内选好。此处请选官方工具包里的 xburn-gui.app 或 .dmg，用于调用命令行 xburn。'
    : '固件已在应用内选好。此处请选 xburn-gui.exe（与压缩包内 xburn.exe 同目录）。';
  return {
    properties: ['openFile'],
    filters,
    title,
    message,
  };
}

let mainWin = null;
/** 主窗口日志镜像（供独立「控制台日志」Electron 窗口；与渲染进程缓冲同步） */
let consoleLogMirror = [];
const CONSOLE_LOG_MIRROR_MAX = 2500;
let consoleLogWin = null;
/** 桌面悬浮球（仅桌面包；与主窗口独立） */
let floatingBallWin = null;
/** 主进程定时按全局光标移动悬浮窗（避免透明小窗在 setBounds 后指针落在窗外，renderer 收不到 pointermove） */
let floatingBallDragTimer = null;
let floatingBallLastCursor = null;
/** 用户选择「隐藏直到下次启动」后，本会话内不再创建悬浮球，直至设置重新启用或进程重启 */
let floatingBallSkipForSession = false;

/**
 * 再次双击图标/快捷方式时不启动第二进程，而是聚焦已有主窗口（与悬浮球并存；仅首实例继续执行后续逻辑）。
 * macOS 亦注册，避免从部分启动器重复拉起。
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    try {
      mainWin.moveTop();
    } catch {
      /* ignore */
    }
  }
});

function stopFloatingBallDragTracking() {
  if (floatingBallDragTimer != null) {
    clearInterval(floatingBallDragTimer);
    floatingBallDragTimer = null;
  }
  floatingBallLastCursor = null;
}

function getFloatingBallPrefsPath() {
  return path.join(app.getPath('userData'), 'floating-ball-prefs.json');
}

function readFloatingBallPrefs() {
  try {
    const p = getFloatingBallPrefsPath();
    if (!fs.existsSync(p)) return { enabled: true };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { enabled: raw.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

function writeFloatingBallPrefs(prefs) {
  try {
    fs.mkdirSync(path.dirname(getFloatingBallPrefsPath()), { recursive: true });
    fs.writeFileSync(getFloatingBallPrefsPath(), JSON.stringify(prefs, null, 2), 'utf8');
  } catch (err) {
    console.error('[floating-ball] write prefs failed:', err);
  }
}

/** 无配置文件时写入默认「开启」，与 readFloatingBallPrefs 语义一致，避免磁盘上长期无文件导致设置页与行为不一致 */
function ensureFloatingBallPrefsDefault() {
  try {
    const p = getFloatingBallPrefsPath();
    if (fs.existsSync(p)) return;
    writeFloatingBallPrefs({ enabled: true });
  } catch {
    /* ignore */
  }
}

registerSsoLoginIpc({ getMainWindow: () => mainWin });
let serverProcess = null;
// url -> WebContentsView 映射
const viewsMap = {};
/** studio_embedded_browser_capture：独立小悬浮窗 captureId -> BrowserWindow */
const captureFloatingWins = new Map();
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
/** 向主窗口发 IPC；窗口未就绪或已销毁时静默跳过，避免 send 抛错 → uncaught → console.error → write EPIPE */
function safeSendToMainRenderer(channel, ...payloadParts) {
  try {
    const win = mainWin;
    if (!win || win.isDestroyed()) return;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (payloadParts.length <= 1) {
      wc.send(channel, payloadParts[0]);
    } else {
      wc.send(channel, ...payloadParts);
    }
  } catch {
    /* ignore */
  }
}

/* ── 镜像下载（跨平台公共逻辑，不依赖平台适配层） ── */
function emitFlashProgress(payload) {
  safeSendToMainRenderer('rdk:flash:progress', payload);
}

function downloadFile(url, destPath) {
  const client = url.startsWith('https://') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(downloadFile(res.headers.location, destPath));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败: HTTP ${res.statusCode || 'unknown'}`));
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let done = 0;
      let lastPercent = -1;
      let lastEmitAt = 0;
      const writer = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        done += chunk.length;
        if (total > 0) {
          const percent = Math.min(98, Math.max(1, Math.round((done / total) * 96) + 1));
          const now = Date.now();
          const shouldEmit = percent >= lastPercent + 1 || now - lastEmitAt >= 250 || done >= total;
          if (shouldEmit) {
            lastPercent = percent;
            lastEmitAt = now;
            emitFlashProgress({ stage: 'downloading', message: `下载 ${(done / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB`, percent });
          }
        }
      });
      res.pipe(writer);
      writer.on('finish', () => {
        writer.close(async () => {
          try {
            if (Number.isFinite(total) && total > 0) {
              const st = await fs.promises.stat(destPath);
              if (st.size !== total) {
                await fs.promises.unlink(destPath).catch(() => {});
                reject(
                  new Error(
                    `下载不完整（预期 ${total} 字节，实际 ${st.size} 字节），已删除残留文件。请检查网络与磁盘空间后重试。`,
                  ),
                );
                return;
              }
            }
            resolve(destPath);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
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
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.xz')) return flashService.decompressXz(filePath);
  if (lower.endsWith('.gz') && !lower.endsWith('.tar.gz')) return flashService.decompressGz(filePath);
  return { ok: true, outputPath: filePath };
});

ipcMain.handle('rdk:serial:list-windows', async () => listWindowsSerialPorts());

/** 桌面端 file:// 下 Blob + <a download> 常无法弹出保存框，用系统另存为代替 */
ipcMain.handle('rdk:save-text-file', async (_event, payload) => {
  const defaultPath = String(payload?.defaultPath || 'export.json').trim() || 'export.json';
  const content = typeof payload?.content === 'string' ? payload.content : '';
  const title = String(payload?.title || '').trim() || '保存文件';
  const win = BrowserWindow.getFocusedWindow() ?? mainWin;
  try {
    const result = await dialog.showSaveDialog(win ?? undefined, {
      title,
      defaultPath,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    await fs.promises.writeFile(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/* ── 判断是否打包模式 ── */
const isPacked = app.isPackaged;

/**
 * 安装系统菜单栏。此前未调用 SetApplicationMenu 时，Electron 在部分平台/版本下不会注册
 * 「切换开发者工具」快捷键，开发态难以查看 Console / Network。
 * - 未打包：视图菜单含「切换开发者工具」（⌘⌥I / Ctrl+Shift+I）
 * - 已打包：同结构但不含开发者工具项
 * - Windows 主窗口 autoHideMenuBar：按 Alt 可临时显示菜单栏
 */
function installApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const includeDevTools = !isPacked;

  const viewItems = [
    { role: 'reload' },
    { role: 'forceReload' },
    ...(includeDevTools ? [{ role: 'toggleDevTools' }] : []),
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    ...(isMac ? [] : [{ type: 'separator' }, { role: 'togglefullscreen' }]),
  ];

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: isMac ? '文件' : 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: isMac ? '编辑' : 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    { label: isMac ? '视图' : 'View', submenu: viewItems },
    ...(isMac ? [{ role: 'windowMenu' }] : []),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('rdk:open-devtools', () => {
  if (!mainWin || mainWin.isDestroyed()) return { ok: false };
  mainWin.webContents.openDevTools();
  return { ok: true };
});

function createConsoleLogWindow() {
  if (consoleLogWin && !consoleLogWin.isDestroyed()) {
    consoleLogWin.show();
    consoleLogWin.focus();
    try {
      consoleLogWin.moveTop();
    } catch {
      /* noop */
    }
    return;
  }
  consoleLogWin = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 520,
    minHeight: 320,
    title: 'RDK Studio · 控制台日志',
    icon: resolveWindowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'console-log-preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const htmlPath = path.join(__dirname, 'console-log-view.html');
  consoleLogWin.loadFile(htmlPath).catch((err) => {
    console.error('[console-log] loadFile failed:', err);
  });
  consoleLogWin.on('closed', () => {
    consoleLogWin = null;
  });
}

ipcMain.handle('rdk:console-log-open-window', () => {
  try {
    createConsoleLogWindow();
    return { ok: true };
  } catch (e) {
    console.error('[console-log] open failed:', e);
    return { ok: false };
  }
});

ipcMain.handle('rdk:console-log-snapshot', (ev) => {
  if (!consoleLogWin || consoleLogWin.isDestroyed() || ev.sender !== consoleLogWin.webContents) {
    return { lines: [] };
  }
  return { lines: consoleLogMirror.slice() };
});

ipcMain.on('rdk:studio-log-mirror', (ev, line) => {
  if (!mainWin || mainWin.isDestroyed() || ev.sender !== mainWin.webContents) return;
  if (!line || typeof line !== 'object') return;
  consoleLogMirror.push(line);
  if (consoleLogMirror.length > CONSOLE_LOG_MIRROR_MAX) {
    consoleLogMirror = consoleLogMirror.slice(-CONSOLE_LOG_MIRROR_MAX);
  }
  if (consoleLogWin && !consoleLogWin.isDestroyed()) {
    try {
      consoleLogWin.webContents.send('rdk:console-log-append', line);
    } catch {
      /* noop */
    }
  }
});

ipcMain.on('rdk:studio-log-clear-mirror', (ev) => {
  if (!mainWin || mainWin.isDestroyed() || ev.sender !== mainWin.webContents) return;
  consoleLogMirror = [];
  if (consoleLogWin && !consoleLogWin.isDestroyed()) {
    try {
      consoleLogWin.webContents.send('rdk:console-log-clear');
    } catch {
      /* noop */
    }
  }
});

ipcMain.on('rdk:console-log-clear-request', (ev) => {
  if (!consoleLogWin || consoleLogWin.isDestroyed() || ev.sender !== consoleLogWin.webContents) return;
  consoleLogMirror = [];
  try {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('rdk:studio-log-clear-ui');
    }
  } catch {
    /* noop */
  }
  try {
    consoleLogWin.webContents.send('rdk:console-log-clear');
  } catch {
    /* noop */
  }
});

/* ── 获取应用根目录（ASAR 内） ── */
function getAppRoot() {
  if (isPacked) {
    return app.getAppPath();
  }
  return path.join(__dirname, '..');
}

/** 开发态 Windows/Linux 任务栏图标（与 build-resources / branding 一致） */
function resolveWindowIcon() {
  if (process.platform === 'darwin') return undefined;
  const root = path.join(__dirname, '..');
  const ico = path.join(root, 'build-resources', 'icon.ico');
  const png = path.join(root, 'build-resources', 'icon.png');
  const branding = path.join(root, 'public', 'branding', 'icon.png');
  if (fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  if (fs.existsSync(branding)) return branding;
  return undefined;
}

/** 悬浮球图标：优先 public/branding/floating-ball.png；mac 上 resolveWindowIcon 常为 undefined，再试 public/branding/icon.png */
function resolveFloatingBallIcon() {
  const root = path.join(__dirname, '..');
  const ball = path.join(root, 'public', 'branding', 'floating-ball.png');
  if (fs.existsSync(ball)) return ball;
  const fromMain = resolveWindowIcon();
  if (fromMain) return fromMain;
  const brandingIcon = path.join(root, 'public', 'branding', 'icon.png');
  if (fs.existsSync(brandingIcon)) return brandingIcon;
  return undefined;
}

/** 欢迎气泡阶段窗口更大；收起后与历史逻辑一致为 72×72 */
const FLOATING_BALL_COMPACT = 72;
const FLOATING_BALL_WELCOME_W = 176;
const FLOATING_BALL_WELCOME_H = 132;

function positionFloatingBallWindow(win) {
  try {
    const { width, height, x, y } = screen.getPrimaryDisplay().workArea;
    const [w, h] = win.getSize();
    const margin = 20;
    win.setPosition(Math.round(x + width - w - margin), Math.round(y + height - h - margin));
  } catch {
    /* ignore */
  }
}

/** 收起欢迎层时保持窗口右下角在屏幕上的位置不变（避免球突然跳位） */
function shrinkFloatingBallWindowToCompact() {
  if (!floatingBallWin || floatingBallWin.isDestroyed()) return;
  try {
    const b = floatingBallWin.getBounds();
    const right = b.x + b.width;
    const bottom = b.y + b.height;
    const nw = FLOATING_BALL_COMPACT;
    const nh = FLOATING_BALL_COMPACT;
    floatingBallWin.setBounds({
      x: Math.round(right - nw),
      y: Math.round(bottom - nh),
      width: nw,
      height: nh,
    });
  } catch {
    /* ignore */
  }
}

function createFloatingBallWindow() {
  const prefs = readFloatingBallPrefs();
  if (!prefs.enabled) return;
  if (floatingBallSkipForSession) return;

  if (floatingBallWin && !floatingBallWin.isDestroyed()) {
    floatingBallWin.show();
    return;
  }

  const iconPath = resolveFloatingBallIcon();
  if (!iconPath || !fs.existsSync(iconPath)) {
    console.warn('[floating-ball] 未找到图标（请将 PNG 置于 public/branding/floating-ball.png），已跳过悬浮球');
    return;
  }

  floatingBallWin = new BrowserWindow({
    width: FLOATING_BALL_WELCOME_W,
    height: FLOATING_BALL_WELCOME_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    focusable: true,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'floating-ball-preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const fileUrl = pathToFileURL(iconPath).href;
  floatingBallWin.loadFile(path.join(__dirname, 'floating-ball.html'), {
    query: { icon: fileUrl },
  }).catch((err) => {
    console.error('[floating-ball] load failed:', err);
  });

  floatingBallWin.once('ready-to-show', () => {
    positionFloatingBallWindow(floatingBallWin);
    try {
      floatingBallWin.setAlwaysOnTop(true, 'screen-saver');
    } catch {
      floatingBallWin.setAlwaysOnTop(true);
    }
    if (process.platform === 'darwin') {
      try {
        floatingBallWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } catch {
        /* ignore */
      }
    }
    floatingBallWin.show();
    try {
      floatingBallWin.setIgnoreMouseEvents(false);
    } catch {
      /* ignore */
    }
  });

  floatingBallWin.on('closed', () => {
    stopFloatingBallDragTracking();
    floatingBallWin = null;
  });
}

ipcMain.on('rdk:floating-ball:welcome-dismissed', () => {
  shrinkFloatingBallWindowToCompact();
});

ipcMain.on('rdk:floating-ball:move-by', (_e, payload) => {
  const dx = Number(payload?.dx ?? 0);
  const dy = Number(payload?.dy ?? 0);
  if (!floatingBallWin || floatingBallWin.isDestroyed()) return;
  if (!dx && !dy) return;
  const b = floatingBallWin.getBounds();
  floatingBallWin.setBounds({
    x: Math.round(b.x + dx),
    y: Math.round(b.y + dy),
    width: b.width,
    height: b.height,
  });
});

ipcMain.on('rdk:floating-ball:drag-start', () => {
  if (!floatingBallWin || floatingBallWin.isDestroyed()) return;
  stopFloatingBallDragTracking();
  floatingBallLastCursor = screen.getCursorScreenPoint();
  floatingBallDragTimer = setInterval(() => {
    if (!floatingBallWin || floatingBallWin.isDestroyed()) {
      stopFloatingBallDragTracking();
      return;
    }
    const cur = screen.getCursorScreenPoint();
    const dx = cur.x - floatingBallLastCursor.x;
    const dy = cur.y - floatingBallLastCursor.y;
    floatingBallLastCursor = cur;
    if (dx === 0 && dy === 0) return;
    const b = floatingBallWin.getBounds();
    floatingBallWin.setBounds({
      x: Math.round(b.x + dx),
      y: Math.round(b.y + dy),
      width: b.width,
      height: b.height,
    });
  }, 16);
});

ipcMain.on('rdk:floating-ball:drag-end', () => {
  stopFloatingBallDragTracking();
});

ipcMain.on('rdk:floating-ball:click', async () => {
  await focusMainWindow();
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('rdk:floating-ball:activate');
  }
});

ipcMain.on('rdk:floating-ball:context-menu', (_event, payload) => {
  if (!floatingBallWin || floatingBallWin.isDestroyed()) return;
  const x = Math.round(Number(payload?.clientX ?? 0));
  const y = Math.round(Number(payload?.clientY ?? 0));
  const template = [
    {
      label: '打开主窗口',
      click: () => {
        void focusMainWindow();
      },
    },
    {
      label: '展开 AI 对话',
      click: () => {
        void focusMainWindow();
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('rdk:floating-ball:activate');
        }
      },
    },
    { type: 'separator' },
    {
      label: '打开工作台',
      click: () => {
        void focusMainWindow();
        sendFloatingBallMenu({ action: 'navigate-tab', tab: 'dashboard' });
      },
    },
    {
      label: '打开终端',
      click: () => {
        void focusMainWindow();
        sendFloatingBallMenu({ action: 'navigate-tab', tab: 'terminal' });
      },
    },
    {
      label: '打开 OpenClaw',
      click: () => {
        void focusMainWindow();
        sendFloatingBallMenu({ action: 'navigate-tab', tab: 'openclaw' });
      },
    },
    {
      label: '打开远程桌面',
      click: () => {
        void focusMainWindow();
        sendFloatingBallMenu({ action: 'navigate-tab', tab: 'vnc' });
      },
    },
    { type: 'separator' },
    {
      label: '截图提问（展开 AI Dock）',
      click: () => {
        void focusMainWindow();
        sendFloatingBallMenu({ action: 'screenshot-ask' });
      },
    },
    { type: 'separator' },
    {
      label: '隐藏直到下次启动',
      click: () => {
        floatingBallSkipForSession = true;
        if (floatingBallWin && !floatingBallWin.isDestroyed()) {
          floatingBallWin.close();
        }
      },
    },
    {
      label: '停用桌面悬浮球',
      click: () => {
        writeFloatingBallPrefs({ enabled: false });
        floatingBallSkipForSession = false;
        if (floatingBallWin && !floatingBallWin.isDestroyed()) {
          floatingBallWin.close();
        }
      },
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: floatingBallWin, x, y });
});

ipcMain.handle('rdk:floating-ball:get-prefs', () => readFloatingBallPrefs());

ipcMain.handle('rdk:floating-ball:set-enabled', async (_e, payload) => {
  const enabled = Boolean(payload?.enabled);
  writeFloatingBallPrefs({ enabled });
  floatingBallSkipForSession = false;
  if (enabled) {
    createFloatingBallWindow();
  } else if (floatingBallWin && !floatingBallWin.isDestroyed()) {
    floatingBallWin.close();
  }
  return { ok: true };
});

/* ── 启动内嵌 Express 服务器（仅生产模式） ── */
/**
 * 辅助排查：谁在监听端口（常见于安装版 + npm run dev 同时开、或上一份 RDK Studio 未退出）。
 */
async function formatPortListenHint(port) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('cmd', ['/c', `netstat -ano | findstr ":${port}"`], {
        windowsHide: true,
      });
      const t = String(stdout || '').trim();
      return t || '';
    }
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      windowsHide: true,
    });
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

/** 桌面包专用：仅当 :port 上已是「带 RDK_PACKAGED_DESKTOP 的内置 API」时才返回 true，避免误用开发态 npm run dev。 */
async function probeReusablePackagedDesktopApi(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return !!(body && body.ok === true && body.rdkStudioApi === true && body.packagedDesktop === true);
  } catch {
    return false;
  }
}

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
    (async () => {
      if (await probeReusablePackagedDesktopApi(SERVER_PORT)) {
        console.log('[server] 端口', SERVER_PORT, '上已有可复用的内置 API，跳过再拉起子进程');
        resolve(SERVER_PORT);
        return;
      }

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
        RDK_PACKAGED_DESKTOP: '1',
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
    })().catch(reject);
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

/** 渲染进程未上报 .content-area 时的兜底（须与主界面网格一致：左侧 rail + 顶栏 + 下方主内容区） */
function calcViewBounds(win) {
  const [w, h] = win.getContentSize();
  const width = Math.max(100, w - RAIL_W);
  const height = Math.max(120, h - TOPBAR_H);
  return {
    x: RAIL_W,
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
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
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

  mainWin.on('closed', () => {
    mainWin = null;
  });

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

async function focusMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) {
    await createMainWindow();
  }
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }
}

function sendFloatingBallMenu(payload) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('rdk:floating-ball:menu', payload);
  }
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

/** 在 app.ready 后注册，避免个别环境下 IPC 未绑定；与悬浮窗抓取共用 */
function registerBrowserCaptureHandlers() {
  const CAPTURE_PAGE_TEXT_SCRIPT = [
    '(() => {',
    '  try {',
    '    function normalize(t) {',
    '      if (!t) return "";',
    '      return String(t)',
    '        .replace(/\\r\\n/g, "\\n")',
    '        .replace(/[^\\S\\n]+/g, " ")',
    '        .replace(/\\n{3,}/g, "\\n\\n")',
    '        .trim();',
    '    }',
    '    function blockText(el) {',
    '      if (!el || !el.innerText) return "";',
    '      return normalize(el.innerText);',
    '    }',
    '    var selectors = ["main","[role=\\"main\\"]","article",".markdown-body","#__next","[class*=\\"detail\\"]","[class*=\\"content\\"]","body"];',
    '    var best = "";',
    '    for (var i = 0; i < selectors.length; i++) {',
    '      var el = document.querySelector(selectors[i]);',
    '      var t = blockText(el);',
    '      if (t.length > best.length) best = t;',
    '    }',
    '    var rootT = normalize(document.documentElement ? document.documentElement.innerText : "");',
    '    if (rootT.length > best.length) best = rootT;',
    '    return best || blockText(document.body);',
    '  } catch (e) { return ""; }',
    '})()',
  ].join('\n');

  for (const name of ['rdk:capture-embedded-url', 'rdk:open-floating-capture', 'rdk:capture-floating-url', 'rdk:close-floating-capture']) {
    try {
      ipcMain.removeHandler(name);
    } catch {
      /* ignore */
    }
  }

  ipcMain.handle('rdk:capture-embedded-url', async (_event, { url }) => {
    const u = String(url || '').trim();
    if (!u) return { ok: false, error: '缺少 url' };
    const view = viewsMap[u];
    if (!view || view.webContents.isDestroyed()) {
      return { ok: false, error: '未找到该 URL 的内嵌视图：请先在本窗口打开该页面（嵌入区）' };
    }
    try {
      const text = await view.webContents.executeJavaScript(CAPTURE_PAGE_TEXT_SCRIPT, true);
      return { ok: true, text: String(text || '') };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('rdk:open-floating-capture', async (_event, { captureId, url }) => {
    const id = String(captureId || '').trim();
    const u = String(url || '').trim();
    if (!id || !u) return { ok: false, error: '缺少 captureId 或 url' };
    if (!mainWin) return { ok: false, error: '主窗口未就绪' };
    const prev = captureFloatingWins.get(id);
    if (prev && !prev.win.isDestroyed()) {
      try {
        prev.win.close();
      } catch {
        /* ignore */
      }
      captureFloatingWins.delete(id);
    }
    const FW = 540;
    const FH = 700;
    const win = new BrowserWindow({
      parent: mainWin,
      modal: false,
      width: FW,
      height: FH,
      minWidth: 360,
      minHeight: 420,
      show: true,
      title: 'RDK Studio · 页面抓取',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.webContents.session.setCertificateVerifyProc((_req, cb) => cb(0));
    const pb = mainWin.getBounds();
    const margin = 20;
    const x = Math.max(0, Math.round(pb.x + pb.width - FW - margin));
    const y = Math.max(0, Math.round(pb.y + pb.height - FH - margin));
    win.setPosition(x, y);
    captureFloatingWins.set(id, { win, url: u });
    win.on('closed', () => {
      captureFloatingWins.delete(id);
    });
    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });
    try {
      await win.loadURL(u);
      return { ok: true };
    } catch (err) {
      captureFloatingWins.delete(id);
      if (!win.isDestroyed()) win.close();
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('rdk:capture-floating-url', async (_event, { captureId }) => {
    const id = String(captureId || '').trim();
    if (!id) return { ok: false, error: '缺少 captureId' };
    const rec = captureFloatingWins.get(id);
    if (!rec || rec.win.isDestroyed()) {
      return { ok: false, error: '未找到抓取悬浮窗（可能已关闭）' };
    }
    try {
      const text = await rec.win.webContents.executeJavaScript(CAPTURE_PAGE_TEXT_SCRIPT, true);
      return { ok: true, text: String(text || '') };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('rdk:close-floating-capture', async (_event, { captureId }) => {
    const id = String(captureId || '').trim();
    if (!id) return { ok: false, error: '缺少 captureId' };
    const rec = captureFloatingWins.get(id);
    if (!rec || rec.win.isDestroyed()) {
      captureFloatingWins.delete(id);
      return { ok: true };
    }
    try {
      rec.win.close();
    } catch {
      /* ignore */
    }
    captureFloatingWins.delete(id);
    return { ok: true };
  });

  console.log('[main] browser capture IPC registered');
}

ipcMain.handle('rdk:flash:get-capabilities', async () => {
  return flashService.getCapabilities();
});

ipcMain.handle('rdk:flash:list-drives', async () => {
  return flashService.listDrives();
});

ipcMain.handle('rdk:flash:pick-image', async (_event, payload = {}) => {
  const isMac = process.platform === 'darwin';
  const win = mainWin ?? undefined;

  const pickFolder = payload?.mode === 'directory' || payload?.pickFolder === true;
  if (pickFolder) {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: typeof payload?.title === 'string' ? payload.title : '选择文件夹',
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  }

  /** S100：与参考 Studio 一致 — 可选 product.zip 或固件目录（mac 单对话框；Win 先目录、取消后再选 zip） */
  if (payload?.mode === 's100-unified') {
    const titleMain = typeof payload?.title === 'string' ? payload.title : '选择固件（product.zip 或已解压目录）';
    const titleDir = typeof payload?.titleDirectory === 'string'
      ? payload.titleDirectory
      : '选择已解压的固件文件夹';
    const filters = [
      { name: 'ZIP', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ];

    if (isMac) {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile', 'openDirectory'],
        title: titleMain,
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
      const picked = result.filePaths[0];
      const v = validateS100ImagePick(picked);
      if (!v.ok) return { ok: false, error: v.error };
      return { ok: true, path: picked };
    }

    const dirDlg = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: titleDir,
    });
    if (dirDlg.canceled || dirDlg.filePaths.length === 0) {
      const fileDlg = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters,
        title: titleMain,
      });
      if (fileDlg.canceled || fileDlg.filePaths.length === 0) return { ok: false, canceled: true };
      const picked = fileDlg.filePaths[0];
      const v = validateS100ImagePick(picked);
      if (!v.ok) return { ok: false, error: v.error };
      return { ok: true, path: picked };
    }
    const picked = dirDlg.filePaths[0];
    const v = validateS100ImagePick(picked);
    if (!v.ok) return { ok: false, error: v.error };
    return { ok: true, path: picked };
  }

  const rawExt = Array.isArray(payload?.extensions) ? payload.extensions : null;
  const normalized = rawExt?.length
    ? rawExt.map((e) => String(e).replace(/^\./, '').toLowerCase()).filter(Boolean)
    : null;

  let filters;
  if (Array.isArray(payload?.dialogFilters) && payload.dialogFilters.length > 0) {
    filters = payload.dialogFilters;
  } else if (normalized?.length) {
    const label = normalized.includes('zip') && normalized.length === 1 ? 'ZIP' : 'Images';
    filters = [{ name: label, extensions: normalized }];
    if (payload?.appendAllFilesFilter === true) {
      filters = [...filters, { name: 'All Files', extensions: ['*'] }];
    }
  } else {
    filters = isMac
      ? [{ name: 'Image Files', extensions: ['img', 'bin', 'wic', 'xz', 'zip', 'dmg'] }]
      : [{ name: 'Image Files', extensions: ['img', 'bin', 'wic', 'wic.gz', 'img.xz', 'xz', 'zip'] }];
  }

  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters,
    title: typeof payload?.title === 'string' ? payload.title : undefined,
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('rdk:flash:write-local', async (_event, payload) => {
  const { imagePath, drivePath, verifyMode, performanceProfile } = payload ?? {};
  if (!imagePath || !drivePath) return { ok: false, error: '缺少镜像路径或目标磁盘' };
  return flashService.writeImage(imagePath, drivePath, { verifyMode, performanceProfile });
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

ipcMain.handle('rdk:flash:get-s100-xburn-gui', async () => {
  if (process.platform === 'darwin') {
    const { resolveMacS100XburnCliPath } = await import('./flash/xburn-s100.mjs');
    const p = await resolveMacS100XburnCliPath('');
    return { ok: true, path: p || undefined };
  }
  const cached = readCachedS100XburnGuiPath();
  if (cached) return { ok: true, path: cached };
  const { tryResolveWindowsXburnForProbe } = await import('./flash/xburn-s100-env-probe.mjs');
  const auto = tryResolveWindowsXburnForProbe('');
  return { ok: true, path: auto || undefined };
});

ipcMain.handle('rdk:flash:pick-s100-xburn-gui', async () => {
  const picked = await dialog.showOpenDialog(mainWin ?? undefined, buildS100XburnGuiOpenDialogOptions());
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };
  const xburnGuiPath = picked.filePaths[0];
  writeCachedS100XburnGuiPath(xburnGuiPath);
  return { ok: true, path: xburnGuiPath };
});

ipcMain.handle('rdk:flash:check-s100-xburn-env', async (_event, payload) => {
  const isMac = process.platform === 'darwin';
  let xburnGuiPath = typeof payload?.xburnGuiPath === 'string' ? payload.xburnGuiPath.trim() : '';
  if (!xburnGuiPath && !isMac) {
    xburnGuiPath = readCachedS100XburnGuiPath();
  }
  const { checkS100XburnEnv } = await import('./flash/xburn-s100-env-probe.mjs');
  return checkS100XburnEnv({ xburnGuiPath });
});

ipcMain.handle('rdk:flash:s100-xburn', async (_event, payload) => {
  const stagingBase = app.getPath('userData');
  const isMac = process.platform === 'darwin';
  let xburnGuiPath = typeof payload?.xburnGuiPath === 'string' ? payload.xburnGuiPath.trim() : '';
  if (!xburnGuiPath && !isMac) {
    xburnGuiPath = readCachedS100XburnGuiPath();
  }
  if (!xburnGuiPath && !isMac) {
    const { tryResolveWindowsXburnForProbe } = await import('./flash/xburn-s100-env-probe.mjs');
    const auto = tryResolveWindowsXburnForProbe('');
    if (auto) xburnGuiPath = auto;
  }
  if (!xburnGuiPath && !isMac) {
    const picked = await dialog.showOpenDialog(mainWin ?? undefined, buildS100XburnGuiOpenDialogOptions());
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };
    xburnGuiPath = picked.filePaths[0];
  }
  if (xburnGuiPath) {
    writeCachedS100XburnGuiPath(xburnGuiPath);
  }
  const imagePath = typeof payload?.imagePath === 'string' ? payload.imagePath.trim() : '';
  if (!imagePath) {
    return { ok: false, error: '缺少镜像路径（请选择固件文件夹或 product.zip）', code: 'INVALID_PARAMS' };
  }
  return flashService.runS100XburnFlash({
    xburnGuiPath,
    imagePath,
    skipAdbReboot: !!payload?.skipAdbReboot,
    stagingBase,
  });
});

app.whenReady().then(async () => {
  installApplicationMenu();
  registerBrowserCaptureHandlers();

  /**
   * Web Serial：需在 Session 上放行 serial 权限与设备，否则 `requestPort()` 无弹窗（表现为「添加」无反应）。
   * 勿用 setPermissionRequestHandler 猜 `permission === 'serial'`（该 API 的请求类型不含 serial，会误拒其它权限）。
   * @see https://www.electronjs.org/docs/latest/tutorial/devices#web-serial-api
   */
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'serial') return true;
    // 与本应用其它能力兼容（麦克风、剪贴板等），避免仅放行 serial 时误拒其它 PermissionCheck
    if (permission === 'media') return true;
    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') return true;
    return false;
  });
  session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === 'serial');

  /** Web Serial：用主进程 portName（如 COM3）回填下拉标签，避免蓝牙等无 VID/PID 时仅显示 #n */
  registerSerialPortPickerHandlers();

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
      const listenHint = await formatPortListenHint(SERVER_PORT);
      const hintBlock = listenHint ? `\n\n当前端口占用情况（仅供参考）：\n${listenHint}` : '';
      dialog.showErrorBox(
        'RDK Studio 启动失败',
        `内置服务未能正常启动。常见原因：已打开另一份 RDK Studio、或本机正在跑「npm run dev」占用了 ${SERVER_PORT}。\n请先退出多余实例或关闭开发服务，也可设置环境变量 PORT 换端口（需与前端约定一致）。${hintBlock}\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      await stopEmbeddedServer();
      app.quit();
      return;
    }
  }

  await createMainWindow();
  ensureFloatingBallPrefsDefault();
  createFloatingBallWindow();

  flashService.initFlashService({
    platform: process.platform,
    webContentsSend: (...args) => safeSendToMainRenderer(...args),
  });

  app.on('activate', async () => {
    if (!mainWin || mainWin.isDestroyed()) {
      await createMainWindow();
    } else {
      mainWin.show();
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
  if (consoleLogWin && !consoleLogWin.isDestroyed()) {
    consoleLogWin.close();
    consoleLogWin = null;
  }
  if (floatingBallWin && !floatingBallWin.isDestroyed()) {
    floatingBallWin.close();
    floatingBallWin = null;
  }
  await stopEmbeddedServer();
});
