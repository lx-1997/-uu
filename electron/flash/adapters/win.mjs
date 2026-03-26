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
  emitFlashProgress({ stage: 'prepare', message: '开始打开镜像文件', percent: 2 });

  activeOp = { id: crypto.randomUUID(), cancelled: false };
  const imageFd = fs.openSync(imagePath, 'r');
  const targetFd = fs.openSync(drivePath, 'r+');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let readBytes = 0;
  let offset = 0;
  let verify = { ok: true, detail: '跳过校验' };

  try {
    emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘，请勿拔出介质', percent: 3 });
    while ((readBytes = fs.readSync(imageFd, buffer, 0, buffer.length, offset)) > 0) {
      if (activeOp?.cancelled) {
        throw Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED });
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
      if (!verify.ok) throw Object.assign(new Error(verify.detail), { code: FlashErrorCode.VERIFY_FAILED });
    }
    emitFlashProgress({ stage: 'done', message: '镜像写入完成', percent: 100 });
    return { output: `镜像已写入 ${drivePath}`, verify };
  } finally {
    fs.closeSync(imageFd);
    fs.closeSync(targetFd);
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
  const drives = await listDrives();
  const driveMeta = drives.find((d) => d.path === drivePath) || null;
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：仅允许备份可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });
  if (!driveMeta.sizeBytes || driveMeta.sizeBytes <= 0) throw Object.assign(new Error('无法获取磁盘容量，不能执行备份'), { code: FlashErrorCode.BACKUP_FAILED });

  const admin = await isAdmin();
  if (!admin) throw Object.assign(new Error('请以管理员权限启动桌面端后重试备份'), { code: FlashErrorCode.PERMISSION_DENIED });

  const outputPath = destPath?.trim() || buildDefaultBackupPath(drivePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  activeOp = { id: crypto.randomUUID(), cancelled: false };
  const sourceFd = fs.openSync(drivePath, 'r');
  const targetFd = fs.openSync(outputPath, 'w');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let offset = 0;
  try {
    emitFlashProgress({ stage: 'backup', message: '开始备份磁盘镜像', percent: 2 });
    while (offset < driveMeta.sizeBytes) {
      if (activeOp?.cancelled) throw Object.assign(new Error('用户取消备份'), { code: FlashErrorCode.USER_CANCELLED });
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
