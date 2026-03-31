/**
 * macOS flash adapter.
 *
 * Provides drive enumeration, image write/backup/decompression and xburn on macOS (diskutil, dd)。
 * `.img.xz` 与旧版 rdkstudio_frontend 一致：系统 `/usr/bin/gunzip -dk`（同目录写出 .img，保留 .xz）。
 *
 * Requires elevated privileges (sudo / osascript) for disk write operations.
 */

import { spawn, execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { emitFlashProgress } from '../progress.mjs';
import { FlashErrorCode } from '../types.mjs';
import {
  getMacLoginShellPath,
  getBundledSudoAskpassScriptPathOrThrow,
  showMacSudoPasswordPreamble,
  sudoAskpassValidateTicket,
  invalidateMacSudoTimestamp,
} from '../sudo-mac.mjs';

let activeOp = null;
const DD_BS = 1048576;
const PROGRESS_EMIT_INTERVAL_MS = 250;

function resolveIoPolicy(options = {}) {
  const turbo = options.performanceProfile === 'turbo';
  if (turbo) {
    return { chunkBytes: 2 * 1024 * 1024 };
  }
  return { chunkBytes: 512 * 1024 };
}

/** 与旧版 rdkstudio_frontend DecompressBehavior（Mac）一致 */
const MAC_SYSTEM_GUNZIP = '/usr/bin/gunzip';

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

async function getMacFlashSudoPathEnv() {
  const loginPath = await getMacLoginShellPath();
  const cur = process.env.PATH || '';
  if (!loginPath) return cur;
  return `${loginPath}${path.delimiter}${cur}`;
}

function parseDdProgressPercent(line, totalBytes) {
  if (!totalBytes || totalBytes <= 0) return null;
  const m = line.match(/(\d+)\s+bytes transferred/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return Math.min(98, Math.max(3, Math.round((n / totalBytes) * 96) + 2));
  }
  const recOut = line.match(/^(\d+)\+(\d+)\s+records out/i);
  const recIn = line.match(/^(\d+)\+(\d+)\s+records in/i);
  const rec = recOut || recIn;
  if (rec) {
    const blocks = parseInt(rec[1], 10);
    const approx = blocks * DD_BS;
    return Math.min(98, Math.max(3, Math.round((approx / totalBytes) * 96) + 2));
  }
  return null;
}

function ddStatusProgressUnsupportedHint(stderr) {
  return /status(=progress)?\s*:\s*(unknown|illegal|invalid)|unrecognized operand.*status|illegal option/i.test(stderr);
}

/** 收集 ppid 之下整棵子进程树（pgrep -P 递归），用于定位 sudo 拉起的 dd。 */
function macCollectDescendantPids(rootPpid) {
  const descendants = [];
  const collect = (ppid) => {
    let out = '';
    try {
      out = execFileSync('/usr/bin/pgrep', ['-P', String(ppid)], { encoding: 'utf8', maxBuffer: 65536 });
    } catch {
      return;
    }
    for (const line of out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const cpid = parseInt(line, 10);
      if (!Number.isFinite(cpid)) continue;
      descendants.push(cpid);
      collect(cpid);
    }
  };
  collect(rootPpid);
  return descendants;
}

/**
 * dd 以 root 运行，普通进程无法对其 process.kill(SIGINFO)；需通过 sudo kill（复用已认证的 sudo 票据）。
 */
function macSignalSiginfoToDdSubtree(sudoPid, askPassPath, pathEnv) {
  if (!Number.isFinite(sudoPid) || sudoPid <= 0) return;
  const env = { ...process.env, PATH: pathEnv, SUDO_ASKPASS: askPassPath };
  for (const pid of macCollectDescendantPids(sudoPid)) {
    try {
      execFileSync('/usr/bin/sudo', ['--askpass', 'kill', '-INFO', String(pid)], {
        env,
        timeout: 15_000,
        stdio: 'ignore',
        maxBuffer: 0,
      });
    } catch {
      /* dd 已退出或短暂竞态 */
    }
  }
}

async function sudoDdReadToBuffer(ddArgs, askPassPath, pathEnv) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn('/usr/bin/sudo', ['--askpass', '-E', '/bin/dd', ...ddArgs], {
      env: { ...process.env, PATH: pathEnv, SUDO_ASKPASS: askPassPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (c) => chunks.push(c));
    let errAcc = '';
    child.stderr.on('data', (d) => { errAcc += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(Object.assign(new Error(errAcc.trim() || `dd 读取退出码 ${code}`), { code: FlashErrorCode.VERIFY_FAILED }));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

async function sudoReadRawRange(rawPath, offset, length, askPassPath, pathEnv) {
  if (length <= 0) return Buffer.alloc(0);
  const skipBlock = Math.floor(offset / DD_BS);
  const prefix = offset - skipBlock * DD_BS;
  const needBytes = prefix + length;
  const countBlocks = Math.ceil(needBytes / DD_BS);
  const buf = await sudoDdReadToBuffer(
    [`if=${rawPath}`, `bs=${DD_BS}`, `skip=${skipBlock}`, `count=${countBlocks}`],
    askPassPath,
    pathEnv,
  );
  if (buf.length < prefix + length) {
    throw Object.assign(new Error('设备读取长度不足（校验）'), { code: FlashErrorCode.VERIFY_FAILED });
  }
  return buf.subarray(prefix, prefix + length);
}

async function verifyImageSampleWithSudo(imagePath, rawPath, totalBytes, askPassPath, pathEnv) {
  const sampleSize = Math.min(1024 * 1024, totalBytes);
  if (sampleSize <= 0) return { ok: false, detail: '镜像为空，无法校验' };
  const imageFd = fs.openSync(imagePath, 'r');
  try {
    const imageHead = readChunk(imageFd, 0, sampleSize);
    const devHead = await sudoReadRawRange(rawPath, 0, sampleSize, askPassPath, pathEnv);
    if (!imageHead.equals(devHead)) return { ok: false, detail: '头部样本校验失败' };
    const tailPos = Math.max(0, totalBytes - sampleSize);
    const imageTail = readChunk(imageFd, tailPos, sampleSize);
    const devTail = await sudoReadRawRange(rawPath, tailPos, sampleSize, askPassPath, pathEnv);
    if (!imageTail.equals(devTail)) return { ok: false, detail: '尾部样本校验失败' };
    return { ok: true, detail: `样本校验通过（${sampleSize}B 头尾抽样）` };
  } finally {
    fs.closeSync(imageFd);
  }
}

/**
 * `sudo dd` 写镜像或备份；`status=progress` 不可用时回退并保持粗粒度进度。
 */
async function runSudoDdTransfer({
  askPassPath,
  pathEnv,
  ifArg,
  ofArg,
  totalHintBytes,
  stageLabel,
  cancelMessage,
}) {
  const stage = stageLabel === 'backup' ? 'backup' : 'flashing';
  const cancelMsg = cancelMessage || (stageLabel === 'backup' ? '用户取消备份' : '用户取消写盘');

  const runOnce = (useStatusProgress) => new Promise((resolve, reject) => {
    /* 不用 conv=fsync：每块同步会在 TF/SD 上极慢且长时间无任何进度输出；结束后由 /usr/bin/sync 刷盘。 */
    const args = ['--askpass', '-E', '/bin/dd', `if=${ifArg}`, `of=${ofArg}`, `bs=${String(DD_BS)}`];
    if (useStatusProgress) args.push('status=progress');
    const child = spawn('/usr/bin/sudo', args, {
      env: { ...process.env, PATH: pathEnv, SUDO_ASKPASS: askPassPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (activeOp) activeOp.child = child;
    let errAcc = '';
    let lastPct = stageLabel === 'backup' ? 2 : 3;
    let lastSigProgressAt = Date.now();
    const feedProgressLine = (line) => {
      if (!line.trim()) return;
      const pct = parseDdProgressPercent(line, totalHintBytes);
      if (pct != null) {
        lastSigProgressAt = Date.now();
        lastPct = Math.max(lastPct, pct);
        const msg = line.trim().length > 120 ? `${line.trim().slice(0, 120)}…` : line.trim();
        emitFlashProgress({
          stage,
          message: msg || (stageLabel === 'backup' ? '正在备份…' : '正在写入…'),
          percent: lastPct,
        });
      }
    };
    child.stderr.on('data', (d) => {
      const text = d.toString();
      errAcc += text;
      for (const line of text.split(/\r?\n/)) feedProgressLine(line);
    });
    let sigInfoTimer = null;
    let sigInfoKickoff = null;
    if (process.platform === 'darwin') {
      const tick = () => {
        try {
          macSignalSiginfoToDdSubtree(child.pid, askPassPath, pathEnv);
        } catch {
          /* ignore */
        }
        const staleMs = 5000;
        if (Date.now() - lastSigProgressAt > staleMs && totalHintBytes > 0) {
          emitFlashProgress({
            stage,
            message:
              stageLabel === 'backup'
                ? '备份进行中（大容量介质可能较长时间无百分比跳动，请勿中断）…'
                : '写入进行中（大镜像可能数分钟无百分比跳动，请勿拔盘）…',
            percent: Math.min(lastPct + 1, 92),
          });
        }
      };
      /* sudo 拉起 dd 稍慢，首包 SIGINFO 略延迟 */
      sigInfoKickoff = setTimeout(() => {
        tick();
        sigInfoTimer = setInterval(tick, 2000);
      }, 600);
    }
    child.on('error', (e) => {
      if (sigInfoKickoff) clearTimeout(sigInfoKickoff);
      if (sigInfoTimer) clearInterval(sigInfoTimer);
      if (activeOp) activeOp.child = null;
      reject(e);
    });
    child.on('close', (code) => {
      if (sigInfoKickoff) clearTimeout(sigInfoKickoff);
      if (sigInfoTimer) clearInterval(sigInfoTimer);
      if (activeOp) activeOp.child = null;
      if (activeOp?.cancelled) {
        reject(Object.assign(new Error(cancelMsg), { code: FlashErrorCode.USER_CANCELLED }));
        return;
      }
      if (code === 0) {
        try {
          execFileSync('/usr/bin/sync');
        } catch {
          /* ignore */
        }
        resolve(errAcc);
        return;
      }
      reject(Object.assign(new Error(errAcc.trim() || `dd 退出码 ${code}`), { code: FlashErrorCode.WRITE_FAILED }));
    });
  });

  try {
    await runOnce(true);
  } catch (e) {
    const stderr = String(e?.message || '');
    if (ddStatusProgressUnsupportedHint(stderr)) {
      await runOnce(false);
    } else {
      throw e;
    }
  }
}

async function writeImageUsingSudoDd(imagePath, rawPath, total, verifyMode) {
  await invalidateMacSudoTimestamp();
  const askPassPath = getBundledSudoAskpassScriptPathOrThrow();
  const pathEnv = await getMacFlashSudoPathEnv();
  await showMacSudoPasswordPreamble({
    message: '接下来需要管理员权限以向磁盘写入镜像。',
    detail:
      '请先点「好」。随后会出现系统密码框，请输入本机登录密码。'
      + ' 若长时间无弹窗，请 ⌘Tab 切换窗口或暂时退出全屏。',
  });
  emitFlashProgress({ stage: 'prepare', message: '正在请求管理员授权（将弹出密码对话框）…', percent: 2 });
  await sudoAskpassValidateTicket(askPassPath, pathEnv);
  activeOp = { id: crypto.randomUUID(), cancelled: false, child: null };
  try {
    emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘，请勿拔出介质', percent: 3 });
    await runSudoDdTransfer({
      askPassPath,
      pathEnv,
      ifArg: imagePath,
      ofArg: rawPath,
      totalHintBytes: total,
      stageLabel: 'write',
      cancelMessage: '用户取消写盘',
    });
    let verify = { ok: true, detail: '跳过校验' };
    if (verifyMode === 'sample') {
      emitFlashProgress({ stage: 'verifying', message: '正在执行写后抽样校验', percent: 99 });
      verify = await verifyImageSampleWithSudo(imagePath, rawPath, total, askPassPath, pathEnv);
      if (!verify.ok) throw Object.assign(new Error(verify.detail), { code: FlashErrorCode.VERIFY_FAILED });
    }
    emitFlashProgress({ stage: 'done', message: '镜像写入完成', percent: 100 });
    return { output: `镜像已写入 ${rawPath}`, verify };
  } finally {
    activeOp = null;
  }
}

async function backupDriveUsingSudoDd(driveMeta, rawPath, outputPath) {
  await invalidateMacSudoTimestamp();
  const askPassPath = getBundledSudoAskpassScriptPathOrThrow();
  const pathEnv = await getMacFlashSudoPathEnv();
  await showMacSudoPasswordPreamble({
    message: '接下来需要管理员权限以读取磁盘并备份镜像。',
    detail: '请先点「好」，随后在系统密码框中输入本机登录密码。',
  });
  emitFlashProgress({ stage: 'backup', message: '正在请求管理员授权…', percent: 1 });
  await sudoAskpassValidateTicket(askPassPath, pathEnv);
  activeOp = { id: crypto.randomUUID(), cancelled: false, child: null };
  try {
    emitFlashProgress({ stage: 'backup', message: '开始备份磁盘镜像', percent: 2 });
    const totalHint = driveMeta.sizeBytes || 0;
    await runSudoDdTransfer({
      askPassPath,
      pathEnv,
      ifArg: rawPath,
      ofArg: outputPath,
      totalHintBytes: totalHint,
      stageLabel: 'backup',
      cancelMessage: '用户取消备份',
    });
    emitFlashProgress({ stage: 'done', message: '备份完成', percent: 100 });
    const st = fs.statSync(outputPath);
    return { path: outputPath, bytes: st.size };
  } finally {
    activeOp = null;
  }
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
  const ioPolicy = resolveIoPolicy(options);
  const drives = await listDrives();
  const driveMeta = drives.find((d) => d.path === drivePath || d.rawPath === drivePath) || null;
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：目标磁盘不是可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });

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

  const rawPath = driveMeta.rawPath || driveMeta.path;
  if (!checkIsRoot()) {
    return writeImageUsingSudoDd(imagePath, rawPath, total, verifyMode);
  }

  emitFlashProgress({ stage: 'prepare', message: '开始打开镜像文件', percent: 2 });

  activeOp = { id: crypto.randomUUID(), cancelled: false, child: null };
  /** 异步 I/O，保证主线程能及时处理 rdk:flash:cancel */
  let imageFh;
  let targetFh;
  const buffer = Buffer.allocUnsafe(ioPolicy.chunkBytes);
  let offset = 0;
  let lastProgressPercent = -1;
  let lastProgressEmitAt = 0;
  let verify = { ok: true, detail: '跳过校验' };

  try {
    imageFh = await fs.promises.open(imagePath, 'r');
    targetFh = await fs.promises.open(rawPath, 'r+');
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
    return { output: `镜像已写入 ${rawPath}`, verify };
  } finally {
    await imageFh?.close().catch(() => {});
    await targetFh?.close().catch(() => {});
    activeOp = null;
  }
}

export async function verifyImage(imagePath, drivePath) {
  const drives = await listDrives();
  const driveMeta = drives.find((d) => d.path === drivePath || d.rawPath === drivePath) || null;
  const rawPath = driveMeta?.rawPath || drivePath;
  const total = fs.statSync(imagePath).size;
  if (!checkIsRoot()) {
    await invalidateMacSudoTimestamp();
    const askPassPath = getBundledSudoAskpassScriptPathOrThrow();
    const pathEnv = await getMacFlashSudoPathEnv();
    await showMacSudoPasswordPreamble({
      message: '需要管理员权限以读取磁盘并校验镜像。',
      detail: '请先点「好」，随后在系统密码框中输入本机登录密码。',
    });
    await sudoAskpassValidateTicket(askPassPath, pathEnv);
    return verifyImageSampleWithSudo(imagePath, rawPath, total, askPassPath, pathEnv);
  }
  const imageFd = fs.openSync(imagePath, 'r');
  const driveFd = fs.openSync(rawPath, 'r');
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
  const driveMeta = drives.find((d) => d.path === drivePath || d.rawPath === drivePath) || null;
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：仅允许备份可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });
  if (!driveMeta.sizeBytes || driveMeta.sizeBytes <= 0) throw Object.assign(new Error('无法获取磁盘容量，不能执行备份'), { code: FlashErrorCode.BACKUP_FAILED });

  try {
    await unmountDisk(driveMeta.id);
  } catch (e) {
    throw Object.assign(new Error(`无法卸载磁盘 ${driveMeta.id}: ${e.message}`), { code: FlashErrorCode.WRITE_FAILED });
  }

  const outputPath = destPath?.trim() || buildDefaultBackupPath(drivePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const rawPath = driveMeta.rawPath || driveMeta.path;

  if (!checkIsRoot()) {
    return backupDriveUsingSudoDd(driveMeta, rawPath, outputPath);
  }

  activeOp = { id: crypto.randomUUID(), cancelled: false, child: null };
  let sourceFh;
  let targetFh;
  const buffer = Buffer.allocUnsafe(ioPolicy.chunkBytes);
  let offset = 0;
  let lastProgressPercent = -1;
  let lastProgressEmitAt = 0;
  try {
    sourceFh = await fs.promises.open(rawPath, 'r');
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
    activeOp = null;
  }
}

export async function decompressXz(inputPath, outputPath) {
  if (!inputPath.toLowerCase().endsWith('.xz')) return inputPath;

  if (!fs.existsSync(MAC_SYSTEM_GUNZIP)) {
    throw Object.assign(
      new Error('系统缺少 /usr/bin/gunzip，无法解压 .xz 镜像'),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }

  emitFlashProgress({ stage: 'decompressing', message: '正在解压 xz 镜像（gunzip -dk）…', percent: 3 });

  await new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const child = spawn(MAC_SYSTEM_GUNZIP, ['-dk', inputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      done(() =>
        reject(
          Object.assign(new Error(`gunzip 执行失败: ${err.message}`), {
            code: FlashErrorCode.DECOMPRESS_FAILED,
          }),
        ));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        done(() =>
          reject(
            Object.assign(
              new Error(`gunzip 解压失败: ${stderr.trim() || `exit code ${code}`}`),
              { code: FlashErrorCode.DECOMPRESS_FAILED },
            ),
          ));
        return;
      }
      if (!fs.existsSync(outputPath)) {
        done(() =>
          reject(
            Object.assign(new Error('解压完成但未找到输出的 .img 文件'), {
              code: FlashErrorCode.DECOMPRESS_FAILED,
            }),
          ));
        return;
      }
      done(() => resolve());
    });
  });

  emitFlashProgress({ stage: 'decompressing', message: '解压完成', percent: 100 });
  return outputPath;
}

export function cancelActiveOp() {
  if (!activeOp) return;
  activeOp.cancelled = true;
  try {
    activeOp.child?.kill?.('SIGTERM');
  } catch {
    /* ignore */
  }
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
