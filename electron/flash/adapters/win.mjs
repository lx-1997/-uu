/**
 * Windows flash adapter.
 *
 * Provides drive enumeration, image writing, backup, decompression and
 * xburn launching on Windows via PowerShell and direct file I/O.
 *
 * Every public method mirrors the adapter interface consumed by the
 * flash service — no Electron-specific imports here.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { emitFlashProgress } from '../progress.mjs';
import { FlashErrorCode } from '../types.mjs';

let activeOp = null;
const PROGRESS_EMIT_INTERVAL_MS = 250;

function resolveIoPolicy(options = {}) {
  const turbo = options.performanceProfile === 'turbo';
  if (turbo) {
    return { chunkBytes: 2 * 1024 * 1024 };
  }
  return { chunkBytes: 512 * 1024 };
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

async function isAdmin() {
  try {
    const out = await runPowerShell(
      '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)',
    );
    return String(out).trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/** @param {string} drivePath e.g. `\\\\.\\PhysicalDrive1` */
function parsePhysicalDriveNumber(drivePath) {
  const m = String(drivePath).match(/PhysicalDrive(\d+)\s*$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 脱机整块磁盘，卸下卷占用，便于对 `\\.\PhysicalDriveN` 做原始读写（类似 macOS 上先 unmount）。 */
async function takeDiskOfflineForRawAccess(diskNumber) {
  const script = `$ErrorActionPreference = 'Stop'; Set-Disk -Number ${diskNumber} -Offline`;
  await runPowerShell(script);
}

/** 写盘结束或异常后尽量恢复联机，便于用户看到盘符；失败则不抛，改由界面提示。 */
async function bringDiskOnlineBestEffort(diskNumber) {
  try {
    const script = `$ErrorActionPreference = 'Stop'; Set-Disk -Number ${diskNumber} -Online`;
    await runPowerShell(script);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
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

function buildDefaultBackupPath(drivePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const diskName = String(drivePath).replace(/[\\/.]/g, '_');
  return path.join(os.homedir(), 'Downloads', `rdk-backup-${diskName}-${stamp}.img`);
}

export function getCapabilities() {
  return {
    supportsDriveScan: true,
    supportsDirectWrite: true,
    supportsBackup: true,
    supportsAutoDecompressXz: true,
    supportsVerifyAfterWrite: true,
    supportsLaunchThirdPartyTool: true,
    thirdPartyToolName: 'xburn',
  };
}

export async function listDrives() {
  const script = `$drives = Get-Disk | Select-Object Number,FriendlyName,BusType,Size,IsBoot,IsSystem,OperationalStatus,Path; $drives | ConvertTo-Json -Depth 3`;
  const output = await runPowerShell(script);
  if (!output) return [];
  const parsed = JSON.parse(output);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr
    .filter((item) => !item.IsSystem && !item.IsBoot)
    .map((item) => ({
      id: String(item.Number),
      path: `\\\\.\\PhysicalDrive${item.Number}`,
      label: item.FriendlyName || `PhysicalDrive${item.Number}`,
      size: item.Size || '',
      sizeBytes: Number(item.Size || 0),
      bus: item.BusType || '',
      mediaType: item.OperationalStatus || '',
      removable: ['USB', 'SD', 'MMC'].includes(String(item.BusType || '').toUpperCase()),
    }));
}

export async function writeImage(imagePath, drivePath, options = {}) {
  const verifyMode = options.verifyMode || 'sample';
  const ioPolicy = resolveIoPolicy(options);
  const drives = await listDrives();
  const driveMeta = drives.find((d) => d.path === drivePath) || null;
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：目标磁盘不是可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });

  const admin = await isAdmin();
  if (!admin) throw Object.assign(new Error('请以管理员权限启动桌面端后重试烧录'), { code: FlashErrorCode.PERMISSION_DENIED });

  const stat = fs.statSync(imagePath);
  const total = stat.size;
  if (Number.isFinite(driveMeta.sizeBytes) && driveMeta.sizeBytes > 0 && total > driveMeta.sizeBytes) {
    throw Object.assign(new Error(`镜像体积超出目标盘容量：image=${total}B, drive=${driveMeta.sizeBytes}B`), { code: FlashErrorCode.IMAGE_TOO_LARGE });
  }

  const diskNo = parsePhysicalDriveNumber(drivePath);
  if (diskNo === null) {
    throw Object.assign(new Error('无效的 Windows 物理磁盘路径'), { code: FlashErrorCode.INVALID_PARAMS });
  }

  activeOp = { id: crypto.randomUUID(), cancelled: false };
  /** 使用异步 read/write，避免同步 I/O 长时间占用主线程导致无法处理 rdk:flash:cancel */
  let imageFh;
  let targetFh;
  const buffer = Buffer.allocUnsafe(ioPolicy.chunkBytes);
  let offset = 0;
  let lastProgressPercent = -1;
  let lastProgressEmitAt = 0;
  let verify = { ok: true, detail: '跳过校验' };
  let tookDiskOffline = false;

  try {
    emitFlashProgress({ stage: 'prepare', message: '正在脱机目标磁盘以释放系统占用…', percent: 1 });
    try {
      await takeDiskOfflineForRawAccess(diskNo);
      tookDiskOffline = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw Object.assign(
        new Error(
          `无法脱机目标磁盘（可能被资源管理器、杀毒或正在访问该盘的程序占用）：${msg}。请关闭已打开的 U 盘/SD 窗口后重试，必要时重新插拔读卡器。`,
        ),
        { code: FlashErrorCode.WRITE_FAILED },
      );
    }

    emitFlashProgress({ stage: 'prepare', message: '开始打开镜像文件', percent: 2 });
    imageFh = await fs.promises.open(imagePath, 'r');
    targetFh = await fs.promises.open(drivePath, 'r+');
    emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘，请勿拔出介质', percent: 3 });
    while (true) {
      if (activeOp?.cancelled) {
        throw Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED });
      }
      const { bytesRead } = await imageFh.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      if (activeOp?.cancelled) {
        throw Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED });
      }
      await targetFh.write(buffer, 0, bytesRead, offset);
      offset += bytesRead;
      const percent = Math.min(98, Math.max(3, Math.round((offset / total) * 96) + 2));
      const now = Date.now();
      const shouldEmitProgress =
        percent >= lastProgressPercent + 1
        || now - lastProgressEmitAt >= PROGRESS_EMIT_INTERVAL_MS
        || offset >= total;
      if (shouldEmitProgress) {
        lastProgressPercent = percent;
        lastProgressEmitAt = now;
        emitFlashProgress({ stage: 'flashing', message: `已写入 ${(offset / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`, percent });
      }
    }
    await targetFh.sync();
    if (verifyMode === 'sample') {
      emitFlashProgress({ stage: 'verifying', message: '正在执行写后抽样校验', percent: 99 });
      verify = verifyImageSample(imageFh.fd, targetFh.fd, total);
      if (!verify.ok) throw Object.assign(new Error(verify.detail), { code: FlashErrorCode.VERIFY_FAILED });
    }
    emitFlashProgress({ stage: 'done', message: '镜像写入完成', percent: 100 });
    return { output: `镜像已写入 ${drivePath}`, verify };
  } finally {
    await imageFh?.close().catch(() => {});
    await targetFh?.close().catch(() => {});
    if (tookDiskOffline) {
      const online = await bringDiskOnlineBestEffort(diskNo);
      if (!online.ok) {
        emitFlashProgress({
          stage: 'prepare',
          message: `磁盘重新联机失败：${online.detail || '未知错误'}。若此电脑中看不到该 U 盘/SD，请重新插拔介质。`,
          percent: 2,
        });
      }
    }
    activeOp = null;
  }
}

export async function verifyImage(imagePath, drivePath) {
  const imageFd = fs.openSync(imagePath, 'r');
  const driveFd = fs.openSync(drivePath, 'r');
  const total = fs.statSync(imagePath).size;
  try {
    return verifyImageSample(imageFd, driveFd, total);
  } finally {
    fs.closeSync(imageFd);
    fs.closeSync(driveFd);
  }
}

export async function backupDrive(drivePath, destPath) {
  const ioPolicy = resolveIoPolicy();
  const drives = await listDrives();
  const driveMeta = drives.find((d) => d.path === drivePath) || null;
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：仅允许备份可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });
  if (!driveMeta.sizeBytes || driveMeta.sizeBytes <= 0) throw Object.assign(new Error('无法获取磁盘容量，不能执行备份'), { code: FlashErrorCode.BACKUP_FAILED });

  const admin = await isAdmin();
  if (!admin) throw Object.assign(new Error('请以管理员权限启动桌面端后重试备份'), { code: FlashErrorCode.PERMISSION_DENIED });

  const diskNo = parsePhysicalDriveNumber(drivePath);
  if (diskNo === null) {
    throw Object.assign(new Error('无效的 Windows 物理磁盘路径'), { code: FlashErrorCode.INVALID_PARAMS });
  }

  const outputPath = destPath?.trim() || buildDefaultBackupPath(drivePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  activeOp = { id: crypto.randomUUID(), cancelled: false };
  let sourceFh;
  let targetFh;
  const buffer = Buffer.allocUnsafe(ioPolicy.chunkBytes);
  let offset = 0;
  let lastProgressPercent = -1;
  let lastProgressEmitAt = 0;
  let tookDiskOffline = false;
  try {
    emitFlashProgress({ stage: 'backup', message: '正在脱机目标磁盘以释放系统占用…', percent: 1 });
    try {
      await takeDiskOfflineForRawAccess(diskNo);
      tookDiskOffline = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw Object.assign(
        new Error(
          `无法脱机目标磁盘（可能被资源管理器或其它程序占用）：${msg}。请关闭相关窗口后重试。`,
        ),
        { code: FlashErrorCode.BACKUP_FAILED },
      );
    }

    sourceFh = await fs.promises.open(drivePath, 'r');
    targetFh = await fs.promises.open(outputPath, 'w');
    emitFlashProgress({ stage: 'backup', message: '开始备份磁盘镜像', percent: 2 });
    while (offset < driveMeta.sizeBytes) {
      if (activeOp?.cancelled) throw Object.assign(new Error('用户取消备份'), { code: FlashErrorCode.USER_CANCELLED });
      const toRead = Math.min(buffer.length, driveMeta.sizeBytes - offset);
      const { bytesRead } = await sourceFh.read(buffer, 0, toRead, offset);
      if (bytesRead <= 0) break;
      if (activeOp?.cancelled) throw Object.assign(new Error('用户取消备份'), { code: FlashErrorCode.USER_CANCELLED });
      await targetFh.write(buffer, 0, bytesRead, offset);
      offset += bytesRead;
      const percent = Math.min(99, Math.max(2, Math.round((offset / driveMeta.sizeBytes) * 98) + 1));
      const now = Date.now();
      const shouldEmitProgress =
        percent >= lastProgressPercent + 1
        || now - lastProgressEmitAt >= PROGRESS_EMIT_INTERVAL_MS
        || offset >= driveMeta.sizeBytes;
      if (shouldEmitProgress) {
        lastProgressPercent = percent;
        lastProgressEmitAt = now;
        emitFlashProgress({ stage: 'backup', message: `已备份 ${(offset / 1024 / 1024).toFixed(1)} MB / ${(driveMeta.sizeBytes / 1024 / 1024).toFixed(1)} MB`, percent });
      }
    }
    await targetFh.sync();
    emitFlashProgress({ stage: 'done', message: '备份完成', percent: 100 });
    return { path: outputPath, bytes: offset };
  } finally {
    await sourceFh?.close().catch(() => {});
    await targetFh?.close().catch(() => {});
    if (tookDiskOffline) {
      const online = await bringDiskOnlineBestEffort(diskNo);
      if (!online.ok) {
        emitFlashProgress({
          stage: 'backup',
          message: `磁盘重新联机失败：${online.detail || '未知错误'}。若看不到该盘，请重新插拔介质。`,
          percent: 2,
        });
      }
    }
    activeOp = null;
  }
}

export async function decompressXz(inputPath, outputPath) {
  if (!inputPath.toLowerCase().endsWith('.xz')) return inputPath;
  return new Promise((resolve, reject) => {
    emitFlashProgress({ stage: 'decompressing', message: '正在解压 xz 镜像', percent: 3 });
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `if (Get-Command xz -ErrorAction SilentlyContinue) { xz -dc "${inputPath.replace(/"/g, '""')}" > "${outputPath.replace(/"/g, '""')}" } else { exit 127 }`,
    ], { windowsHide: true });
    child.on('close', (code) => {
      if (code === 0) {
        emitFlashProgress({ stage: 'decompressing', message: '解压完成', percent: 100 });
        resolve(outputPath);
      } else {
        reject(Object.assign(
          new Error('系统缺少 xz，无法自动解压 .xz 文件，请先手动解压为 .img'),
          { code: FlashErrorCode.TOOL_MISSING },
        ));
      }
    });
    child.on('error', reject);
  });
}

export function cancelActiveOp() {
  if (activeOp) activeOp.cancelled = true;
}

export function getActiveOperation() {
  return {
    running: !!activeOp,
    id: activeOp?.id || '',
  };
}

export async function launchThirdPartyTool(toolPath, _options) {
  let exePath = toolPath;
  if (!exePath) return { ok: false, needsPick: true };
  const child = spawn(exePath, [], {
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  });
  child.unref();
  return { ok: true, path: exePath };
}
