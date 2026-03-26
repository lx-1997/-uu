/**
 * macOS flash adapter.
 *
 * Provides drive enumeration, image writing, backup, decompression and
 * xburn launching on macOS via diskutil, dd, and native xz.
 *
 * Requires elevated privileges (sudo / osascript) for disk write operations.
 */

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { emitFlashProgress } from '../progress.mjs';
import { FlashErrorCode } from '../types.mjs';

let activeOp = null;
const IO_CHUNK_BYTES = 512 * 1024;
const IO_YIELD_INTERVAL_BYTES = 4 * 1024 * 1024;
const IO_THROTTLE_MS = 8;
const PROGRESS_EMIT_INTERVAL_MS = 250;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

function parsePlist(text) {
  const get = (key) => {
    const re = new RegExp(`<key>${key}</key>\\s*<(\\w+)>([^<]*)<`);
    const m = text.match(re);
    if (!m) return undefined;
    if (m[1] === 'integer') return parseInt(m[2], 10);
    if (m[1] === 'true') return true;
    if (m[1] === 'false') return false;
    return m[2];
  };
  const getBool = (key) => {
    const reTrue = new RegExp(`<key>${key}</key>\\s*<true\\s*/>`);
    const reFalse = new RegExp(`<key>${key}</key>\\s*<false\\s*/>`);
    if (reTrue.test(text)) return true;
    if (reFalse.test(text)) return false;
    return undefined;
  };
  return { get, getBool };
}

async function getDiskInfo(diskId) {
  try {
    const out = await exec('diskutil', ['info', '-plist', diskId]);
    const p = parsePlist(out);
    return {
      id: diskId,
      path: `/dev/${diskId}`,
      rawPath: `/dev/r${diskId}`,
      label: p.get('MediaName') || p.get('VolumeName') || diskId,
      size: String(p.get('TotalSize') || ''),
      sizeBytes: p.get('TotalSize') || 0,
      bus: p.get('BusProtocol') || '',
      mediaType: p.get('MediaType') || '',
      removable: p.getBool('RemovableMedia') === true || p.getBool('Ejectable') === true,
      internal: p.getBool('Internal') === true,
    };
  } catch {
    return null;
  }
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
  const out = await exec('diskutil', ['list', '-plist', 'external', 'physical']);
  const diskIds = [];
  const re = /<string>(disk\d+)<\/string>/g;
  let m;
  while ((m = re.exec(out)) !== null) {
    if (!diskIds.includes(m[1])) diskIds.push(m[1]);
  }

  const results = [];
  for (const diskId of diskIds) {
    const info = await getDiskInfo(diskId);
    if (info) results.push(info);
  }
  return results;
}

function checkIsRoot() {
  return process.getuid?.() === 0;
}

function unmountDisk(diskId) {
  return exec('diskutil', ['unmountDisk', diskId]);
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
  const diskName = String(drivePath).replace(/[/]/g, '_');
  return path.join(os.homedir(), 'Downloads', `rdk-backup-${diskName}-${stamp}.img`);
}

export async function writeImage(imagePath, drivePath, options = {}) {
  const verifyMode = options.verifyMode || 'sample';
  const drives = await listDrives();
  const driveMeta = drives.find((d) => d.path === drivePath || d.rawPath === drivePath) || null;
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：目标磁盘不是可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });

  if (!checkIsRoot()) {
    throw Object.assign(new Error('需要管理员权限才能写入磁盘，请使用 sudo 启动应用或在系统偏好设置中授予磁盘访问权限'), { code: FlashErrorCode.PERMISSION_DENIED });
  }

  const stat = fs.statSync(imagePath);
  const total = stat.size;
  if (Number.isFinite(driveMeta.sizeBytes) && driveMeta.sizeBytes > 0 && total > driveMeta.sizeBytes) {
    throw Object.assign(new Error(`镜像体积超出目标盘容量：image=${total}B, drive=${driveMeta.sizeBytes}B`), { code: FlashErrorCode.IMAGE_TOO_LARGE });
  }

  emitFlashProgress({ stage: 'prepare', message: '正在卸载磁盘分区...', percent: 1 });
  try {
    await unmountDisk(driveMeta.id);
  } catch (e) {
    throw Object.assign(new Error(`无法卸载磁盘 ${driveMeta.id}: ${e.message}`), { code: FlashErrorCode.WRITE_FAILED });
  }

  emitFlashProgress({ stage: 'prepare', message: '开始打开镜像文件', percent: 2 });
  const rawPath = driveMeta.rawPath || driveMeta.path;

  activeOp = { id: crypto.randomUUID(), cancelled: false };
  const imageFd = fs.openSync(imagePath, 'r');
  const targetFd = fs.openSync(rawPath, 'r+');
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  let readBytes = 0;
  let offset = 0;
  let bytesSinceYield = 0;
  let lastProgressPercent = -1;
  let lastProgressEmitAt = 0;
  let verify = { ok: true, detail: '跳过校验' };

  try {
    emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘，请勿拔出介质', percent: 3 });
    while ((readBytes = fs.readSync(imageFd, buffer, 0, buffer.length, offset)) > 0) {
      if (activeOp?.cancelled) {
        throw Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED });
      }
      fs.writeSync(targetFd, buffer, 0, readBytes, offset);
      offset += readBytes;
      bytesSinceYield += readBytes;
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
      if (bytesSinceYield >= IO_YIELD_INTERVAL_BYTES) {
        bytesSinceYield = 0;
        await new Promise((resolve) => setImmediate(resolve));
        await delay(IO_THROTTLE_MS);
      }
    }
    fs.fsyncSync(targetFd);
    if (verifyMode === 'sample') {
      emitFlashProgress({ stage: 'verifying', message: '正在执行写后抽样校验', percent: 99 });
      verify = verifyImageSample(imageFd, targetFd, total);
      if (!verify.ok) throw Object.assign(new Error(verify.detail), { code: FlashErrorCode.VERIFY_FAILED });
    }
    emitFlashProgress({ stage: 'done', message: '镜像写入完成', percent: 100 });
    return { output: `镜像已写入 ${rawPath}`, verify };
  } finally {
    fs.closeSync(imageFd);
    fs.closeSync(targetFd);
    activeOp = null;
  }
}

export async function verifyImage(imagePath, drivePath) {
  const drives = await listDrives();
  const driveMeta = drives.find((d) => d.path === drivePath || d.rawPath === drivePath) || null;
  const rawPath = driveMeta?.rawPath || drivePath;
  const imageFd = fs.openSync(imagePath, 'r');
  const driveFd = fs.openSync(rawPath, 'r');
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
  const driveMeta = drives.find((d) => d.path === drivePath || d.rawPath === drivePath) || null;
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：仅允许备份可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });
  if (!driveMeta.sizeBytes || driveMeta.sizeBytes <= 0) throw Object.assign(new Error('无法获取磁盘容量，不能执行备份'), { code: FlashErrorCode.BACKUP_FAILED });

  if (!checkIsRoot()) {
    throw Object.assign(new Error('需要管理员权限才能读取磁盘，请使用 sudo 启动应用'), { code: FlashErrorCode.PERMISSION_DENIED });
  }

  try {
    await unmountDisk(driveMeta.id);
  } catch (e) {
    throw Object.assign(new Error(`无法卸载磁盘 ${driveMeta.id}: ${e.message}`), { code: FlashErrorCode.WRITE_FAILED });
  }

  const outputPath = destPath?.trim() || buildDefaultBackupPath(drivePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const rawPath = driveMeta.rawPath || driveMeta.path;

  activeOp = { id: crypto.randomUUID(), cancelled: false };
  const sourceFd = fs.openSync(rawPath, 'r');
  const targetFd = fs.openSync(outputPath, 'w');
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  let offset = 0;
  let bytesSinceYield = 0;
  let lastProgressPercent = -1;
  let lastProgressEmitAt = 0;
  try {
    emitFlashProgress({ stage: 'backup', message: '开始备份磁盘镜像', percent: 2 });
    while (offset < driveMeta.sizeBytes) {
      if (activeOp?.cancelled) throw Object.assign(new Error('用户取消备份'), { code: FlashErrorCode.USER_CANCELLED });
      const toRead = Math.min(buffer.length, driveMeta.sizeBytes - offset);
      const read = fs.readSync(sourceFd, buffer, 0, toRead, offset);
      if (read <= 0) break;
      fs.writeSync(targetFd, buffer, 0, read, offset);
      offset += read;
      bytesSinceYield += read;
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
      if (bytesSinceYield >= IO_YIELD_INTERVAL_BYTES) {
        bytesSinceYield = 0;
        await new Promise((resolve) => setImmediate(resolve));
        await delay(IO_THROTTLE_MS);
      }
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

  const hasXz = await exec('which', ['xz']).then(() => true).catch(() => false);
  if (!hasXz) {
    throw Object.assign(
      new Error('系统缺少 xz 工具，请先安装（brew install xz），或手动解压为 .img'),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }

  return new Promise((resolve, reject) => {
    emitFlashProgress({ stage: 'decompressing', message: '正在解压 xz 镜像', percent: 3 });
    const child = spawn('xz', ['-dc', inputPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const writer = fs.createWriteStream(outputPath);
    child.stdout.pipe(writer);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) {
        emitFlashProgress({ stage: 'decompressing', message: '解压完成', percent: 100 });
        resolve(outputPath);
      } else {
        reject(Object.assign(
          new Error(`xz 解压失败: ${stderr || `exit code ${code}`}`),
          { code: FlashErrorCode.DECOMPRESS_FAILED },
        ));
      }
    });
    child.on('error', (err) => {
      reject(Object.assign(
        new Error(`xz 执行失败: ${err.message}`),
        { code: FlashErrorCode.DECOMPRESS_FAILED },
      ));
    });
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
  if (toolPath && toolPath.endsWith('.app')) {
    const child = spawn('open', ['-a', toolPath], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, path: toolPath };
  }
  if (toolPath) {
    const child = spawn('open', [toolPath], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, path: toolPath };
  }
  return { ok: false, needsPick: true };
}
