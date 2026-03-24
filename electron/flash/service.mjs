/**
 * Flash service factory.
 *
 * Picks the correct platform adapter and exposes a unified API surface
 * that the IPC handlers in main.mjs consume.
 *
 * Adding a new platform only requires a new adapter — this file and the
 * IPC layer stay unchanged.
 */

import { setProgressSender } from './progress.mjs';

let adapter = null;

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
  if (!a) {
    return {
      supportsDriveScan: false,
      supportsDirectWrite: false,
      supportsBackup: false,
      supportsAutoDecompressXz: false,
      supportsVerifyAfterWrite: false,
      supportsLaunchThirdPartyTool: false,
    };
  }
  return a.getCapabilities();
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
    const outputPath = inputPath.replace(/\.xz$/i, '');
    const resolved = await a.decompressXz(inputPath, outputPath);
    return { ok: true, outputPath: resolved };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code };
  }
}

export async function cancelActiveOp() {
  const a = await getAdapter();
  if (a) a.cancelActiveOp();
  return { ok: true };
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
