/**
 * Flash service factory.
 *
 * Picks the correct platform adapter and exposes a unified API surface
 * that the IPC handlers in main.mjs consume.
 *
 * Adding a new platform only requires a new adapter — this file and the
 * IPC layer stay unchanged.
 */

import {
  getFlashProgressSnapshot,
  resetFlashProgressHistory,
  setProgressSender,
} from './progress.mjs';
import { FlashErrorCode } from './types.mjs';
import {
  runS100XburnFlash as executeS100Xburn,
  cancelS100XburnOp,
  resetS100XburnSession,
  isS100XburnRunning,
} from './xburn-s100.mjs';
import {
  cancelS100Prereq,
  resetS100PrereqSession,
} from './s100-prereq-windows.mjs';

let adapter = null;
/** S100 整条链路（含 Windows 前置）进行中，用于 getActiveOperation / 取消 */
let s100PipelineActive = false;

export function initFlashService({ platform, webContentsSend }) {
  setProgressSender(webContentsSend);

  if (platform === 'win32') {
    adapter = import('./adapters/win.mjs');
  } else if (platform === 'darwin') {
    adapter = import('./adapters/mac.mjs');
  } else {
    adapter = null;
  }
}

async function getAdapter() {
  if (!adapter) return null;
  if (adapter instanceof Promise) adapter = await adapter;
  return adapter;
}

export async function getCapabilities() {
  const a = await getAdapter();
  const plat = process.platform;
  const s100Cli = plat === 'win32' || plat === 'darwin';
  if (!a) {
    return {
      supportsDriveScan: false,
      supportsDirectWrite: false,
      supportsBackup: false,
      supportsAutoDecompressXz: false,
      supportsVerifyAfterWrite: false,
      supportsLaunchThirdPartyTool: false,
      supportsS100XburnCli: s100Cli,
    };
  }
  return { ...a.getCapabilities(), supportsS100XburnCli: s100Cli };
}

export async function listDrives() {
  const a = await getAdapter();
  if (!a) return { ok: false, error: '当前平台暂不支持磁盘扫描', code: 'UNSUPPORTED_PLATFORM' };
  try {
    const drives = await a.listDrives();
    return { ok: true, drives };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code };
  }
}

export async function writeImage(imagePath, drivePath, options) {
  const a = await getAdapter();
  if (!a) return { ok: false, error: '当前平台暂不支持磁盘写入', code: 'UNSUPPORTED_PLATFORM' };
  try {
    resetFlashProgressHistory();
    const result = await a.writeImage(imagePath, drivePath, options);
    return { ok: true, output: result.output, verify: result.verify };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code };
  }
}

export async function verifyImage(imagePath, drivePath) {
  const a = await getAdapter();
  if (!a) return { ok: false, error: '当前平台暂不支持镜像校验', code: 'UNSUPPORTED_PLATFORM' };
  try {
    const result = await a.verifyImage(imagePath, drivePath);
    return { ok: result.ok, detail: result.detail };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code };
  }
}

export async function backupDrive(drivePath, destPath) {
  const a = await getAdapter();
  if (!a) return { ok: false, error: '当前平台暂不支持磁盘备份', code: 'UNSUPPORTED_PLATFORM' };
  try {
    resetFlashProgressHistory();
    const result = await a.backupDrive(drivePath, destPath);
    return { ok: true, path: result.path, bytes: result.bytes };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code };
  }
}

export async function decompressXz(inputPath) {
  if (!inputPath.toLowerCase().endsWith('.xz')) return { ok: true, outputPath: inputPath };
  const a = await getAdapter();
  if (!a) return { ok: false, error: '当前平台暂不支持自动解压', code: 'UNSUPPORTED_PLATFORM' };
  try {
    resetFlashProgressHistory();
    const outputPath = inputPath.replace(/\.xz$/i, '');
    const resolved = await a.decompressXz(inputPath, outputPath);
    return { ok: true, outputPath: resolved };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code };
  }
}

export async function cancelActiveOp() {
  cancelS100Prereq();
  cancelS100XburnOp();
  const a = await getAdapter();
  if (a) a.cancelActiveOp();
  return { ok: true };
}

export async function getActiveOperation() {
  const a = await getAdapter();
  const adapterState = typeof a?.getActiveOperation === 'function'
    ? a.getActiveOperation()
    : { running: false, id: '' };
  const snapshot = getFlashProgressSnapshot();
  const s100Running = isS100XburnRunning() || s100PipelineActive;
  return {
    ok: true,
    running: !!adapterState?.running || s100Running,
    opId: adapterState?.id || '',
    lastPayload: snapshot.lastPayload,
    logs: snapshot.logs,
  };
}

export async function launchThirdPartyTool(toolPath, options) {
  const a = await getAdapter();
  if (!a) return { ok: false, error: '当前平台暂不支持启动第三方工具', code: 'UNSUPPORTED_PLATFORM' };
  try {
    return await a.launchThirdPartyTool(toolPath, options);
  } catch (error) {
    return { ok: false, error: error.message, code: error.code };
  }
}

/**
 * S100：与参考 Studio 对齐 — Win 前置 WinUSB+ADB；Mac 前置校验 adb/fastboot/dfu-util（PATH 含 brew 常见目录）再自动安装 xburn-gui（若缺失）；
 * xburn 经 sudo --askpass + 打包的 JXA（flash/darwin/sudo-askpass.osascript-*.js），PATH 从登录 shell（zsh -lic）合并后再前置 xburn 目录，与 Imager FlashMac 一致。Mac 不跑 adb reboot usb2。
 */
export async function runS100XburnFlash(payload = {}) {
  const plat = process.platform;
  if (plat !== 'win32' && plat !== 'darwin') {
    return {
      ok: false,
      error: 'S100 一键烧写仅支持 Windows 与 macOS 桌面端',
      code: FlashErrorCode.UNSUPPORTED_PLATFORM,
    };
  }
  resetFlashProgressHistory();
  resetS100PrereqSession();
  resetS100XburnSession();
  s100PipelineActive = true;
  try {
    let adbExePath;
    if (plat === 'win32') {
      const pre = await import('./s100-prereq-windows.mjs');
      const userData = String(payload.stagingBase || '').trim();
      if (!userData) {
        throw Object.assign(new Error('缺少 stagingBase（userData）'), { code: FlashErrorCode.INVALID_PARAMS });
      }
      await pre.installS100WinusbDriverIfNeeded({ userData });
      if (!payload.skipAdbReboot) {
        const adbRes = await pre.ensureWindowsPlatformTools({ userData });
        adbExePath = adbRes.adbPath;
      }
    }
    if (plat === 'darwin') {
      const userData = String(payload.stagingBase || '').trim();
      if (!userData) {
        throw Object.assign(new Error('缺少 stagingBase（userData）'), { code: FlashErrorCode.INVALID_PARAMS });
      }
      const preMac = await import('./s100-prereq-mac.mjs');
      await preMac.ensureMacS100FlashCliTools();
      await preMac.ensureMacXburnGuiInstalled({ userData });
    }
    const burnMeta = await executeS100Xburn({
      xburnGuiPath: payload.xburnGuiPath,
      imagePath: payload.imagePath,
      skipAdbReboot: !!payload.skipAdbReboot,
      stagingBase: payload.stagingBase,
      adbExePath,
    });
    return { ok: true, completedBurnEvidence: burnMeta?.completedBurnEvidence !== false };
  } catch (error) {
    const code = error?.code;
    if (code === FlashErrorCode.USER_CANCELLED) {
      return {
        ok: false,
        error: error.message || '用户取消',
        code,
        canceled: true,
      };
    }
    return {
      ok: false,
      error: error?.message || 'xburn 烧录失败',
      code,
      logTail: error?.logTail,
    };
  } finally {
    s100PipelineActive = false;
  }
}
