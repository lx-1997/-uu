import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 侧边栏宽度 + 顶部工具栏高度（与 src/styles/layout.css 保持一致）
const SIDEBAR_W = 260;
const TOPBAR_H = 48;
const DOCK_RESERVED_H = 170;

let mainWin = null;
let serverProcess = null;
// url -> WebContentsView 映射
const viewsMap = {};
let latestRendererBounds = null;
let activeFlashOp = null;

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
function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error((stderr || stdout || `powershell exit ${code}`).trim()));
    });
  });
}

async function listWindowsFlashDrives() {
  const script = `$drives = Get-CimInstance Win32_DiskDrive | Select-Object Index,Model,Size,InterfaceType,DeviceID,MediaType; $drives | ConvertTo-Json -Depth 3`;
  const output = await runPowerShell(script);
  if (!output) return [];
  const parsed = JSON.parse(output);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map((item) => ({
    id: String(item.Index),
    path: item.DeviceID,
    label: item.Model || `PhysicalDrive${item.Index}`,
    size: item.Size || '',
    sizeBytes: Number(item.Size || 0),
    bus: item.InterfaceType || '',
    mediaType: item.MediaType || '',
    removable: /removable|external/i.test(String(item.MediaType || '')) || ['USB', 'SD'].includes(String(item.InterfaceType || '').toUpperCase()),
  }));
}

function emitFlashProgress(payload) {
  mainWin?.webContents.send('rdk:flash:progress', payload);
}

function buildDefaultBackupPath(drivePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const diskName = String(drivePath).replace(/[\\/.]/g, '_');
  return path.join(os.homedir(), 'Downloads', `rdk-backup-${diskName}-${stamp}.img`);
}

async function isWindowsAdmin() {
  try {
    const out = await runPowerShell('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)');
    return String(out).trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

function readChunk(fd, position, size) {
  const buf = Buffer.allocUnsafe(size);
  const read = fs.readSync(fd, buf, 0, size, position);
  return buf.subarray(0, read);
}

function verifyImageSample(imageFd, targetFd, totalBytes) {
  const sampleSize = Math.min(1024 * 1024, totalBytes);
  if (sampleSize <= 0) return { ok: false, detail: '镜像为空，无法校验' };
  const imageHead = readChunk(imageFd, 0, sampleSize);
  const targetHead = readChunk(targetFd, 0, sampleSize);
  if (!imageHead.equals(targetHead)) return { ok: false, detail: '头部样本校验失败' };
  const tailPos = Math.max(0, totalBytes - sampleSize);
  const imageTail = readChunk(imageFd, tailPos, sampleSize);
  const targetTail = readChunk(targetFd, tailPos, sampleSize);
  if (!imageTail.equals(targetTail)) return { ok: false, detail: '尾部样本校验失败' };
  return { ok: true, detail: `样本校验通过（${sampleSize}B 头尾抽样）` };
}

async function writeImageToDriveWindows(imagePath, drivePath, options = {}) {
  const verifyMode = options.verifyMode || 'sample';
  const driveMeta = await listWindowsFlashDrives().then((list) => list.find((d) => d.path === drivePath) || null);
  if (!driveMeta) throw new Error('未找到目标磁盘，请刷新后重试');
  if (!driveMeta.removable) throw new Error('安全策略阻止：目标磁盘不是可移动介质');

  const admin = await isWindowsAdmin();
  if (!admin) throw new Error('请以管理员权限启动桌面端后重试烧录');

  const stat = fs.statSync(imagePath);
  const total = stat.size;
  if (Number.isFinite(driveMeta.sizeBytes) && driveMeta.sizeBytes > 0 && total > driveMeta.sizeBytes) {
    throw new Error(`镜像体积超出目标盘容量：image=${total}B, drive=${driveMeta.sizeBytes}B`);
  }
  emitFlashProgress({ stage: 'prepare', message: '开始打开镜像文件', percent: 2 });

  activeFlashOp = { id: crypto.randomUUID(), cancelled: false };
  const imageFd = fs.openSync(imagePath, 'r');
  const targetFd = fs.openSync(drivePath, 'r+');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let readBytes = 0;
  let offset = 0;
  let verify = { ok: true, detail: '跳过校验' };

  try {
    emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘，请勿拔出介质', percent: 3 });
    while ((readBytes = fs.readSync(imageFd, buffer, 0, buffer.length, offset)) > 0) {
      if (activeFlashOp?.cancelled) {
        throw new Error('用户取消写盘');
      }
      fs.writeSync(targetFd, buffer, 0, readBytes, offset);
      offset += readBytes;
      const percent = Math.min(98, Math.max(3, Math.round((offset / total) * 96) + 2));
      emitFlashProgress({ stage: 'flashing', message: `已写入 ${(offset / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`, percent });
    }
    fs.fsyncSync(targetFd);
    if (verifyMode === 'sample') {
      emitFlashProgress({ stage: 'verifying', message: '正在执行写后抽样校验', percent: 99 });
      verify = verifyImageSample(imageFd, targetFd, total);
      if (!verify.ok) throw new Error(verify.detail);
    }
    emitFlashProgress({ stage: 'done', message: '镜像写入完成', percent: 100 });
    return {
      output: `镜像已写入 ${drivePath}`,
      verify,
    };
  } finally {
    fs.closeSync(imageFd);
    fs.closeSync(targetFd);
    activeFlashOp = null;
  }
}

async function backupDriveToImageWindows(drivePath, destPath) {
  const driveMeta = await listWindowsFlashDrives().then((list) => list.find((d) => d.path === drivePath) || null);
  if (!driveMeta) throw new Error('未找到目标磁盘，请刷新后重试');
  if (!driveMeta.removable) throw new Error('安全策略阻止：仅允许备份可移动介质');
  if (!driveMeta.sizeBytes || driveMeta.sizeBytes <= 0) throw new Error('无法获取磁盘容量，不能执行备份');

  const admin = await isWindowsAdmin();
  if (!admin) throw new Error('请以管理员权限启动桌面端后重试备份');

  const outputPath = destPath?.trim() || buildDefaultBackupPath(drivePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  activeFlashOp = { id: crypto.randomUUID(), cancelled: false };
  const sourceFd = fs.openSync(drivePath, 'r');
  const targetFd = fs.openSync(outputPath, 'w');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let offset = 0;
  try {
    emitFlashProgress({ stage: 'backup', message: '开始备份磁盘镜像', percent: 2 });
    while (offset < driveMeta.sizeBytes) {
      if (activeFlashOp?.cancelled) throw new Error('用户取消备份');
      const toRead = Math.min(buffer.length, driveMeta.sizeBytes - offset);
      const read = fs.readSync(sourceFd, buffer, 0, toRead, offset);
      if (read <= 0) break;
      fs.writeSync(targetFd, buffer, 0, read, offset);
      offset += read;
      const percent = Math.min(99, Math.max(2, Math.round((offset / driveMeta.sizeBytes) * 98) + 1));
      emitFlashProgress({ stage: 'backup', message: `已备份 ${(offset / 1024 / 1024).toFixed(1)} MB / ${(driveMeta.sizeBytes / 1024 / 1024).toFixed(1)} MB`, percent });
    }
    fs.fsyncSync(targetFd);
    emitFlashProgress({ stage: 'done', message: '备份完成', percent: 100 });
    return { path: outputPath, bytes: offset };
  } finally {
    fs.closeSync(sourceFd);
    fs.closeSync(targetFd);
    activeFlashOp = null;
  }
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

async function decompressXzWithFallback(inputPath, outputPath) {
  if (!inputPath.toLowerCase().endsWith('.xz')) return inputPath;
  return new Promise((resolve, reject) => {
    emitFlashProgress({ stage: 'decompressing', message: '正在解压 xz 镜像', percent: 3 });
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `if (Get-Command xz -ErrorAction SilentlyContinue) { xz -dc "${inputPath.replace(/"/g, '""')}" > "${outputPath.replace(/"/g, '""')}" } else { exit 127 }`], { windowsHide: true });
    child.on('close', (code) => {
      if (code === 0) {
        emitFlashProgress({ stage: 'decompressing', message: '解压完成', percent: 100 });
        resolve(outputPath);
      } else {
        reject(new Error('系统缺少 xz，无法自动解压 .xz 文件，请先手动解压为 .img'));
      }
    });
    child.on('error', reject);
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
  try {
    const outputPath = filePath.replace(/\.xz$/i, '');
    const resolved = await decompressXzWithFallback(filePath, outputPath);
    return { ok: true, outputPath: resolved };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '解压失败' };
  }
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
function startEmbeddedServer() {
  if (!isPacked) return Promise.resolve(8787);

  return new Promise((resolve, reject) => {
    // asar: false 时 app.getAppPath() 指向 resources/app/ (真实目录)
    // tsconfig.server.json 的 rootDir 是项目根，所以 server/index.ts 编译到 dist-server/server/index.js
    const serverPath = path.join(getAppRoot(), 'dist-server', 'server', 'index.js');
    const dataPath = path.join(process.resourcesPath, 'data');

    console.log('[server] starting embedded server:', serverPath);
    console.log('[server] data path:', dataPath);

    serverProcess = spawn(process.execPath, [serverPath], {
      cwd: getAppRoot(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: '8787',
        NODE_ENV: 'production',
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

    serverProcess.on('exit', (code, signal) => {
      console.error('[server] exited:', { code, signal });
    });

    // 10s 超时兜底
    setTimeout(() => resolve(8787), 10000);
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

ipcMain.handle('rdk:flash:list-drives', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: '当前仅实现 Windows 桌面端本机真实烧录能力' };
  }
  const drives = await listWindowsFlashDrives();
  return { ok: true, drives };
});

ipcMain.handle('rdk:flash:pick-image', async () => {
  const result = await dialog.showOpenDialog(mainWin ?? undefined, {
    properties: ['openFile'],
    filters: [{ name: 'Image Files', extensions: ['img', 'bin', 'wic', 'wic.gz', 'img.xz', 'xz'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('rdk:flash:write-local', async (_event, payload) => {
  const { imagePath, drivePath, verifyMode } = payload ?? {};
  if (!imagePath || !drivePath) return { ok: false, error: '缺少镜像路径或目标磁盘' };
  if (process.platform !== 'win32') return { ok: false, error: '当前仅实现 Windows 桌面端本机真实烧录能力' };
  try {
    const result = await writeImageToDriveWindows(imagePath, drivePath, { verifyMode });
    return { ok: true, output: result.output, verify: result.verify };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '本机烧录失败' };
  }
});

ipcMain.handle('rdk:flash:verify-local', async (_event, payload) => {
  const { imagePath, drivePath } = payload ?? {};
  if (!imagePath || !drivePath) return { ok: false, error: '缺少镜像路径或目标磁盘' };
  try {
    const imageFd = fs.openSync(imagePath, 'r');
    const driveFd = fs.openSync(drivePath, 'r');
    const total = fs.statSync(imagePath).size;
    const verify = verifyImageSample(imageFd, driveFd, total);
    fs.closeSync(imageFd);
    fs.closeSync(driveFd);
    return { ok: verify.ok, detail: verify.detail };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '校验失败' };
  }
});

ipcMain.handle('rdk:flash:backup-local', async (_event, payload) => {
  const { drivePath, destPath } = payload ?? {};
  if (!drivePath) return { ok: false, error: '缺少目标磁盘路径 drivePath' };
  try {
    const result = await backupDriveToImageWindows(drivePath, destPath);
    return { ok: true, path: result.path, bytes: result.bytes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '备份失败' };
  }
});

ipcMain.handle('rdk:flash:cancel', async () => {
  if (activeFlashOp) {
    activeFlashOp.cancelled = true;
  }
  return { ok: true };
});

ipcMain.handle('rdk:flash:launch-xburn', async (_event, payload) => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'xburn 启动当前仅支持 Windows 客户端' };
  }

  let exePath = payload?.exePath;
  if (!exePath) {
    const picked = await dialog.showOpenDialog(mainWin ?? undefined, {
      properties: ['openFile'],
      filters: [{ name: 'xburn', extensions: ['exe'] }],
      title: '选择 xburn-gui.exe',
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };
    exePath = picked.filePaths[0];
  }

  try {
    const child = spawn(exePath, [], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
    });
    child.unref();
    return { ok: true, path: exePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '启动 xburn 失败' };
  }
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
