/**
 * S100 烧写前置（仅 Windows）：WinUSB 驱动包 + platform-tools（adb/fastboot）。
 * URL 与 rdkstudio_frontend src/main.js 约定对齐。
 */

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { emitFlashProgress } from './progress.mjs';
import { FlashErrorCode } from './types.mjs';

let prereqCancelled = false;
/** @type {import('http').ClientRequest | null} */
let activeHttpsRequest = null;
/** @type {import('child_process').ChildProcess | null} */
let activePowerShellChild = null;

export function resetS100PrereqSession() {
  prereqCancelled = false;
  activeHttpsRequest = null;
  activePowerShellChild = null;
}

export function cancelS100Prereq() {
  if (process.platform !== 'win32') return;
  prereqCancelled = true;
  if (activeHttpsRequest) {
    try {
      activeHttpsRequest.destroy();
    } catch {
      /* ignore */
    }
    activeHttpsRequest = null;
  }
  if (activePowerShellChild?.pid) {
    try {
      activePowerShellChild.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    try {
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(activePowerShellChild.pid)], { windowsHide: true });
      killer.unref();
    } catch {
      /* ignore */
    }
    activePowerShellChild = null;
  }
}

function throwIfPrereqCancelled() {
  if (prereqCancelled) {
    throw Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED });
  }
}

export const S100_WINUSB_DRIVER_URL =
  'https://archive.d-robotics.cc/downloads/software_tools/winusb_drivers/sunrise5_winusb.zip';

/** 官方归档；若失效可改为 dl.google.com/android/repository/platform-tools-latest-windows.zip */
export const ADB_PLATFORM_TOOLS_ZIP_URL_WINDOWS =
  'https://archive.d-robotics.cc/downloads/software_tools/android_sdk/platform-tools-latest-windows.zip';

const WINUSB_MARKER = 's100-winusb-driver.installed';

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    throwIfPrereqCancelled();
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    });
    activePowerShellChild = child;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      activePowerShellChild = null;
      reject(e);
    });
    child.on('close', (code) => {
      activePowerShellChild = null;
      if (prereqCancelled) {
        reject(Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED }));
        return;
      }
      if (code === 0) resolve(stdout.trim());
      else reject(new Error((stderr || stdout || `powershell exit ${code}`).trim()));
    });
  });
}

function downloadHttpsToFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let resStream = null;
    let writer = null;

    const cleanupReq = () => {
      activeHttpsRequest = null;
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanupReq();
      try {
        resStream?.destroy();
      } catch {
        /* ignore */
      }
      try {
        writer?.destroy();
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanupReq();
      resolve(destPath);
    };

    const openReq = (u) => {
      try {
        throwIfPrereqCancelled();
      } catch (e) {
        fail(e);
        return;
      }
      const client = u.startsWith('https://') ? https : http;
      const req = client.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          try {
            req.destroy();
          } catch {
            /* ignore */
          }
          const next = new URL(res.headers.location, u).href;
          cleanupReq();
          openReq(next);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`下载失败: HTTP ${res.statusCode || 'unknown'}`));
          return;
        }
        resStream = res;
        const total = Number(res.headers['content-length'] || 0);
        let done = 0;
        writer = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          if (prereqCancelled) {
            fail(Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED }));
            return;
          }
          done += chunk.length;
          if (typeof onProgress === 'function' && total > 0) {
            onProgress(done, total);
          }
        });
        res.pipe(writer);
        writer.on('finish', () => writer.close(() => succeed()));
        writer.on('error', (e) => fail(e));
      });
      activeHttpsRequest = req;
      req.on('error', (e) => fail(e));
    };

    openReq(url);
  });
}

function psQuoteSingle(s) {
  return String(s).replace(/'/g, "''");
}

function tryAdbFastbootPair(adbPath) {
  if (!adbPath || !fs.existsSync(adbPath)) return null;
  const dir = path.dirname(adbPath);
  const fb = path.join(dir, 'fastboot.exe');
  if (fs.existsSync(fb)) return path.resolve(adbPath);
  return null;
}

/**
 * 与参考 windowsAdbResolve：固定目录优先，再 where adb；须同目录有 fastboot.exe。
 */
export async function findWindowsAdbExe(userData) {
  const ud = userData ? path.resolve(userData) : '';
  const candidates = [];
  if (ud) candidates.push(path.join(ud, 'platform-tools', 'adb.exe'));
  const env = process.env;
  if (env.ANDROID_HOME) candidates.push(path.join(env.ANDROID_HOME, 'platform-tools', 'adb.exe'));
  if (env.ANDROID_SDK_ROOT) candidates.push(path.join(env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe'));
  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  }
  if (env.USERPROFILE) {
    candidates.push(path.join(env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  }
  for (const c of candidates) {
    const ok = tryAdbFastbootPair(c);
    if (ok) return ok;
  }
  return new Promise((resolve) => {
    execFile('cmd.exe', ['/c', 'where adb'], { windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const first = String(stdout).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      resolve(tryAdbFastbootPair(first || ''));
    });
  });
}

function findFileRecursive(root, baseName) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.name.toLowerCase() === baseName.toLowerCase()) return p;
    }
  }
  return null;
}

function findAdbDirInExtract(root) {
  const walk = (d) => {
    const adb = path.join(d, 'adb.exe');
    const fb = path.join(d, 'fastboot.exe');
    if (fs.existsSync(adb) && fs.existsSync(fb)) return d;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const r = walk(path.join(d, ent.name));
        if (r) return r;
      }
    }
    return null;
  };
  return walk(root);
}

function appendWindowsUserPathDir(dirToAdd) {
  const q = psQuoteSingle(dirToAdd);
  const script = `
$add = '${q}'
$cur = [Environment]::GetEnvironmentVariable('Path', 'User')
if ([string]::IsNullOrWhiteSpace($cur)) { $cur = '' }
if ($cur -notlike "*${q}*") {
  [Environment]::SetEnvironmentVariable('Path', ($cur.TrimEnd(';') + ';' + $add), 'User')
}
`;
  return runPowerShell(script);
}

/**
 * 下载并解压 platform-tools 到 userData/platform-tools，并尝试写入用户 Path。
 */
export async function ensureWindowsPlatformTools({ userData }) {
  throwIfPrereqCancelled();
  const adbExisting = await findWindowsAdbExe(userData);
  if (adbExisting) {
    emitFlashProgress({ stage: 'preparing', message: '已检测到 adb + fastboot（同目录），跳过 platform-tools 下载', percent: 5 });
    try {
      await appendWindowsUserPathDir(path.dirname(adbExisting));
    } catch {
      /* 非致命 */
    }
    return { adbPath: adbExisting, skipped: true };
  }

  emitFlashProgress({ stage: 'downloading', message: '正在下载 Android platform-tools（Windows）…', percent: 2 });
  const cacheDir = path.join(userData, 'cache', 's100-prereq');
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, 'platform-tools-latest-windows.zip');
  let lastPct = -1;
  const tryDownload = (url) => downloadHttpsToFile(url, zipPath, (done, total) => {
    const percent = Math.min(95, Math.max(2, Math.round((done / total) * 90)));
    if (percent >= lastPct + 2) {
      lastPct = percent;
      emitFlashProgress({
        stage: 'downloading',
        message: `下载 platform-tools ${(done / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`,
        percent,
      });
    }
  });
  throwIfPrereqCancelled();
  try {
    await tryDownload(ADB_PLATFORM_TOOLS_ZIP_URL_WINDOWS);
  } catch {
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    emitFlashProgress({ stage: 'preparing', message: '归档站下载失败，尝试 Google 官方包…', percent: 2 });
    await tryDownload('https://dl.google.com/android/repository/platform-tools-latest-windows.zip');
  }

  throwIfPrereqCancelled();
  const extractRoot = path.join(cacheDir, `platform-tools-unpack-${Date.now()}`);
  fs.mkdirSync(extractRoot, { recursive: true });
  emitFlashProgress({ stage: 'decompressing', message: '正在解压 platform-tools…', percent: 96 });
  const z = psQuoteSingle(zipPath);
  const o = psQuoteSingle(extractRoot);
  await runPowerShell(`Expand-Archive -LiteralPath '${z}' -DestinationPath '${o}' -Force`);

  const innerDir = findAdbDirInExtract(extractRoot);
  if (!innerDir) {
    throw new Error('解压 platform-tools 后未找到 adb.exe 与 fastboot.exe，请手动安装 Android SDK platform-tools');
  }

  const destDir = path.join(userData, 'platform-tools');
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(innerDir, destDir, { recursive: true });

  const adbPath = path.join(destDir, 'adb.exe');
  if (!tryAdbFastbootPair(adbPath)) {
    throw new Error('platform-tools 安装后校验 adb/fastboot 失败');
  }

  try {
    await appendWindowsUserPathDir(destDir);
    emitFlashProgress({ stage: 'preparing', message: '已将 platform-tools 目录写入用户 Path（新终端生效）', percent: 99 });
  } catch {
    /* ignore */
  }

  try {
    fs.rmSync(extractRoot, { recursive: true, force: true });
    fs.unlinkSync(zipPath);
  } catch {
    /* ignore */
  }

  return { adbPath, skipped: false };
}

/**
 * 下载 WinUSB 驱动包，解压后以 UAC 运行 install_driver.bat（若存在）；成功后写标记文件。
 */
export async function installS100WinusbDriverIfNeeded({ userData }) {
  throwIfPrereqCancelled();
  const marker = path.join(userData, WINUSB_MARKER);
  if (fs.existsSync(marker)) {
    emitFlashProgress({ stage: 'preparing', message: 'WinUSB 驱动已安装（本地标记），跳过', percent: 1 });
    return { skipped: true };
  }

  emitFlashProgress({ stage: 'downloading', message: '正在下载 S100 WinUSB 驱动包…', percent: 1 });
  const cacheDir = path.join(userData, 'cache', 's100-prereq');
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, 'sunrise5_winusb.zip');
  let lastPct = -1;
  await downloadHttpsToFile(S100_WINUSB_DRIVER_URL, zipPath, (done, total) => {
    if (total <= 0) return;
    const percent = Math.min(40, Math.max(1, Math.round((done / total) * 38)));
    if (percent >= lastPct + 2) {
      lastPct = percent;
      emitFlashProgress({
        stage: 'downloading',
        message: `下载 WinUSB 驱动 ${(done / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`,
        percent,
      });
    }
  });

  throwIfPrereqCancelled();
  const extractRoot = path.join(cacheDir, `sunrise5_winusb-unpack-${Date.now()}`);
  fs.mkdirSync(extractRoot, { recursive: true });
  emitFlashProgress({ stage: 'decompressing', message: '正在解压 WinUSB 驱动…', percent: 42 });
  const z = psQuoteSingle(zipPath);
  const o = psQuoteSingle(extractRoot);
  await runPowerShell(`Expand-Archive -LiteralPath '${z}' -DestinationPath '${o}' -Force`);

  const bat = findFileRecursive(extractRoot, 'install_driver.bat');
  if (!bat) {
    try {
      fs.rmSync(extractRoot, { recursive: true, force: true });
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    throw new Error('驱动包内未找到 install_driver.bat，请从官方文档手动安装 WinUSB 驱动');
  }

  throwIfPrereqCancelled();
  const batQ = psQuoteSingle(bat);
  const wdQ = psQuoteSingle(path.dirname(bat));
  emitFlashProgress({ stage: 'preparing', message: '即将弹出 UAC 安装驱动，请在系统对话框中确认…', percent: 45 });
  await runPowerShell(
    `$bat = '${batQ}'; $wd = '${wdQ}'; $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c','call',$bat) -WorkingDirectory $wd -Verb RunAs -Wait -PassThru; if ($null -ne $p -and $null -ne $p.ExitCode -and $p.ExitCode -ne 0) { exit $p.ExitCode }`,
  );

  fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
  emitFlashProgress({ stage: 'preparing', message: 'WinUSB 驱动安装流程已执行', percent: 48 });

  try {
    fs.rmSync(extractRoot, { recursive: true, force: true });
    fs.unlinkSync(zipPath);
  } catch {
    /* ignore */
  }

  return { skipped: false };
}

export function isS100WinusbDriverMarked(userData) {
  return fs.existsSync(path.join(userData, WINUSB_MARKER));
}
