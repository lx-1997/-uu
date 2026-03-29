/**
 * Windows 烧录：与 rdkstudio_frontend-master `FlashBehavior.js`（FlashWindows）一致。
 *
 * - 工具：`resources/flash/win32/x64/dd.exe`、`ls.exe`
 * - 枚举：`ls.exe`（同 FlashBehavior.checkUSBDevices）
 * - 烧录：outer.bat / inner.bat，`dd if= of= bs=4M status=progress`
 * - 提权：`powershell Start-Process outer.bat -Verb runAs -WindowStyle hidden`（无 -Wait）
 * - 进度：轮询 stderr.txt，间隔 1100ms
 * - 完成：读取 status.txt 中 ERRORLEVEL，或为 0 则成功
 * - 取消：`wmic process where "name='dd.exe'" call terminate`
 */

import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitFlashProgress } from './progress.mjs';
import { FlashErrorCode } from './types.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STDERR_POLL_MS = 1100;

/**
 * dd `status=progress` 在 stderr 用 \\r 覆盖更新，同一「行」里会有多次 `12345678 bytes ...`；
 * 不能取第一个 `bytes` 前的片段，否则会一直卡在首块（如 bs=4M 时约 8MB）。
 */
function parseLatestDdProgressBytes(stderrText) {
  const s = String(stderrText || '');
  const re = /(\d+)\s+bytes/gi;
  let last = null;
  let m;
  while ((m = re.exec(s)) !== null) {
    const v = parseInt(m[1], 10);
    if (Number.isInteger(v) && v >= 0) {
      last = v;
    }
  }
  return last;
}

/**
 * 安装包：`package.json` extraResources 将 electron/resources/flash → resources/flash，故用 process.resourcesPath。
 * 开发态：process.resourcesPath 常为 undefined，退回 electron/resources/flash（与源码目录一致）。
 */
export function getFlashWin32X64Dir() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'flash', 'win32', 'x64'));
  }
  candidates.push(path.join(__dirname, '..', 'resources', 'flash', 'win32', 'x64'));
  for (const p of candidates) {
    if (p && fs.existsSync(path.join(p, 'dd.exe')) && fs.existsSync(path.join(p, 'msys-2.0.dll'))) {
      return path.resolve(p);
    }
  }
  return null;
}

export function resolveDdExecutable() {
  const env = process.env.RDK_DD_PATH?.trim();
  if (env && fs.existsSync(env)) {
    return path.resolve(env);
  }
  const dir = getFlashWin32X64Dir();
  if (dir) {
    const dd = path.join(dir, 'dd.exe');
    if (fs.existsSync(dd)) {
      return dd;
    }
  }
  return null;
}

export function resolveLsExecutable() {
  const dir = getFlashWin32X64Dir();
  if (dir) {
    const ls = path.join(dir, 'ls.exe');
    if (fs.existsSync(ls)) {
      return ls;
    }
  }
  return null;
}

/** 与旧版前端一致：同目录下 dd + ls 齐全才走「插件同款」枚举+烧录 */
export function hasFrontendFlashBundle() {
  return !!(resolveDdExecutable() && resolveLsExecutable());
}

/**
 * `/dev/sdX` → `\\.\PhysicalDriveN`
 */
export function msysDeviceToPhysicalDrive(device) {
  const m = String(device || '').trim().match(/^\/dev\/sd([a-z])$/i);
  if (!m) {
    return null;
  }
  const idx = m[1].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
  if (idx < 0 || idx > 32) {
    return null;
  }
  return `\\\\.\\PhysicalDrive${idx}`;
}

/**
 * 与 FlashBehavior.checkUSBDevices 等价
 * @returns {{ device: string, name: string }[]}
 */
export function listUsbDevicesViaLs() {
  const ls = resolveLsExecutable();
  if (!ls) {
    return [];
  }

  let ret = execFileSync(ls, ['/dev/sd*'], { encoding: 'utf8', windowsHide: true });
  const devices = ret.toString().trim().split('\n').filter(Boolean);

  ret = execFileSync(ls, ['/dev/disk/by-id'], { encoding: 'utf8', windowsHide: true });
  let names = ret.toString().split('\n');
  names = names.filter((name) => name.indexOf('usb') >= 0 && name.indexOf('part') < 0);

  ret = execFileSync(ls, ['-l', '/dev/disk/by-id'], { encoding: 'utf8', windowsHide: true });
  let casts = ret.toString().split('\n');
  casts = casts.filter((cast) => cast.indexOf('usb') >= 0 && cast.indexOf('part') < 0);

  ret = execFileSync(ls, ['-l', '/dev/disk/by-drive'], { encoding: 'utf8', windowsHide: true });
  const drives = ret.toString().split('\n');

  const pairs = [];
  names.forEach((name) => {
    const castItemArray = casts.filter((cast) => cast.indexOf(name) >= 0);
    if (castItemArray.length === 1) {
      const cacheArray = [];
      devices.forEach((device) => {
        const devStr = device.replace('/dev', '');
        if (castItemArray[0].indexOf(devStr) >= 0) {
          cacheArray.push({
            device,
            name,
          });
        }
      });
      if (cacheArray.length === 1) {
        pairs.push(...cacheArray);
      }
    }
  });

  if (pairs.length === 0) {
    ret = execFileSync(ls, ['-l', '/dev/disk/by-id'], { encoding: 'utf8', windowsHide: true });
    casts = ret.toString().split('\n');
    casts = casts.filter((cast) => cast.indexOf('nvme') >= 0 && cast.indexOf('part') < 0);

    const availableDevices = devices.filter((device) => {
      if (device.indexOf('/sda') < 0) {
        const countArray = devices.filter((countDev) => countDev.indexOf(device) >= 0);
        if (countArray.length > 1) {
          const devStr = device.replace('/dev', '');
          const countHasNvmeArray = casts.filter((countCast) => countCast.indexOf(devStr) >= 0);
          return countHasNvmeArray.length === 0;
        }
      }
      return false;
    });

    if (availableDevices.length > 0) {
      pairs.push(
        ...availableDevices.map((device) => ({
          device,
          name: device,
        })),
      );
    }
  }

  pairs.forEach((pair) => {
    const devStr = pair.device.replace('/dev', '');
    const drivesArray = drives.filter((drive) => drive.indexOf(devStr) >= 0);
    let drivesStr = '(';
    drivesArray.forEach((drive) => {
      const items = drive.split(' ');
      drivesStr = `${drivesStr}${items[items.length - 3].toUpperCase()}: `;
    });
    drivesStr += ')';
    pair.name = drivesStr + pair.name;
  });

  return pairs;
}

/** 终止 dd：优先 taskkill（Win11 起 wmic 可能不可用），再尝试 wmic */
export function cancelDdWmic() {
  return new Promise((resolve) => {
    execFile('taskkill', ['/F', '/IM', 'dd.exe'], { windowsHide: true }, () => {
      execFile('wmic', ['process', 'where', "name='dd.exe'", 'call', 'terminate'], { windowsHide: true }, () => resolve());
    });
  });
}

/**
 * @param {object} opts
 * @param {string} opts.imagePath
 * @param {string} opts.ofDevice 形如 /dev/sdb（与 FlashBehavior 一致）
 * @param {number} opts.imageSizeBytes
 * @param {() => boolean} [opts.isCancelled]
 * @param {'balanced'|'turbo'} [opts.performanceProfile] 与 Flasher 一致；turbo 使用更大 bs（默认 8M），常规 4M（与 rdkstudio_frontend 默认一致）
 * @returns {{ launchChild: import('child_process').ChildProcess | null, done: Promise<void>, tempFolderPath: string, cancelDd: () => Promise<void> }}
 */
export function startFrontendStyleDdFlash({ imagePath, ofDevice, imageSizeBytes, isCancelled, performanceProfile }) {
  const dd = resolveDdExecutable();
  if (!dd) {
    throw new Error(
      '未找到捆绑 dd.exe：请将 rdkstudio_frontend 的 flash/win32/x64/dd.exe、ls.exe 复制到 electron/resources/flash/win32/x64/',
    );
  }

  const tempFolderPath = path.join(os.tmpdir(), `rdk-flash-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  fs.mkdirSync(tempFolderPath, { recursive: true });

  const pathStdout = path.join(tempFolderPath, 'stdout.txt');
  const pathStderr = path.join(tempFolderPath, 'stderr.txt');
  const pathStatus = path.join(tempFolderPath, 'status.txt');
  const pathOuterScript = path.join(tempFolderPath, 'outer.bat');
  const pathInnerScript = path.join(tempFolderPath, 'inner.bat');

  /** 与 FlashBehavior 一致；镜像路径含空格时加引号 */
  const qBat = (p) => {
    const s = String(p);
    return /\s/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  /** 极速：更大块减少系统调用；若不稳定可改回常规模式 */
  const bs = performanceProfile === 'turbo' ? '8M' : '4M';
  const flashCommand = `"${dd}" if=${qBat(imagePath)} of=${ofDevice} bs=${bs} status=progress`;

  const outerArray = [
    '@echo off',
    `call "${pathInnerScript}" > "${pathStdout}" 2> "${pathStderr}"`,
    `(echo %ERRORLEVEL%) > "${pathStatus}"`,
  ];
  fs.writeFileSync(pathOuterScript, outerArray.join('\r\n'), 'utf-8');

  const innerArray = ['@echo off', 'chcp 65001>nul', flashCommand];
  fs.writeFileSync(pathInnerScript, innerArray.join('\r\n'), 'utf-8');

  const paramsArray = ['Start-Process', '-FilePath', pathOuterScript, '-WindowStyle', 'hidden', '-Verb', 'runAs'];
  const launchChild = spawn('powershell.exe', paramsArray, {
    windowsHide: true,
    stdio: 'ignore',
  });

  const done = new Promise((resolve, reject) => {
    let settled = false;
    const tick = () => {
      if (settled) {
        return;
      }
      if (isCancelled?.()) {
        settled = true;
        reject(Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED }));
        return;
      }
      try {
        if (fs.existsSync(pathStatus)) {
          const raw = fs.readFileSync(pathStatus, 'utf-8').trim();
          const lastLine = raw.split(/\r?\n/).filter(Boolean).pop() ?? raw;
          const code = parseInt(String(lastLine).trim(), 10);
          if (Number.isNaN(code)) {
            settled = true;
            reject(new Error(`无法解析 dd 退出状态: ${raw}`));
            return;
          }
          if (code === 0) {
            settled = true;
            resolve();
            return;
          }
          let errTail = '';
          try {
            errTail = fs.readFileSync(pathStderr, 'utf-8').slice(-2000);
          } catch {
            /* ignore */
          }
          settled = true;
          reject(new Error(`dd 退出码 ${code}${errTail ? `：${errTail}` : ''}`));
          return;
        }

        let result = '';
        try {
          result = fs.readFileSync(pathStderr, 'utf-8');
        } catch {
          /* 尚未创建 */
        }
        const n = parseLatestDdProgressBytes(result);
        if (n !== null && imageSizeBytes > 0) {
          if (n >= imageSizeBytes) {
            /** 镜像字节数出现在进度行时视为接近写完 */
            emitFlashProgress({
              stage: 'flashing',
              message: `已写入 ${(imageSizeBytes / 1024 / 1024).toFixed(1)} MB / ${(imageSizeBytes / 1024 / 1024).toFixed(1)} MB`,
              percent: 98,
            });
          } else {
            const percent = Math.min(98, Math.max(3, Math.floor((n * 100) / imageSizeBytes)));
            emitFlashProgress({
              stage: 'flashing',
              message: `已写入 ${(n / 1024 / 1024).toFixed(1)} MB / ${(imageSizeBytes / 1024 / 1024).toFixed(1)} MB`,
              percent,
            });
          }
        }
      } catch (e) {
        if (e && typeof e === 'object' && 'code' in e && e.code === FlashErrorCode.USER_CANCELLED) {
          settled = true;
          reject(e);
          return;
        }
      }
      setTimeout(tick, STDERR_POLL_MS);
    };
    tick();
  });

  const doneWithCleanup = done.finally(() => {
    setTimeout(() => {
      try {
        if (fs.existsSync(tempFolderPath)) {
          fs.rmSync(tempFolderPath, { recursive: true, force: true });
        }
      } catch {
        /* ignore */
      }
    }, 2000);
  });

  return {
    launchChild,
    done: doneWithCleanup,
    tempFolderPath,
    cancelDd: cancelDdWmic,
  };
}

/** 物理盘路径 → /dev/sd?，无 ls 时给 dd 用 */
export function physicalDriveToMsysOf(devicePath) {
  const m = String(devicePath || '').match(/PhysicalDrive(\d+)\s*$/i);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 0 || n > 25) {
    return null;
  }
  const letter = String.fromCharCode('a'.charCodeAt(0) + n);
  return `/dev/sd${letter}`;
}
