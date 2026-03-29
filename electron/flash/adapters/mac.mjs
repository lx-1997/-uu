/**
 * macOS flash adapter.
 *
 * 烧录（非 S100）：与 rdkstudio_frontend-master `FlashBehavior` / Imager FlashMac 一致：
 * `diskutil unmountDisk` 后 `sudo --askpass sh -c '/bin/dd bs=4m of=/dev/rdiskN if=… status=progress'`。
 * 备份仍为 Node 分块读写（需 root，行为未改）。
 */

import { spawn, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { emitFlashProgress } from '../progress.mjs';
import { FlashErrorCode } from '../types.mjs';

let activeOp = null;
const PROGRESS_EMIT_INTERVAL_MS = 250;

function shSingleQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** GNU dd status=progress 行 */
function parseDdCopiedBytes(line) {
  const m = String(line || '').trim().match(/^(\d+)\s+bytes\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function resolveFlashDarwinAskpassPathOrThrow() {
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, 'flash', 'darwin')
    : '';
  let base = '';
  if (packaged && fs.existsSync(packaged)) {
    base = packaged;
  } else {
    const dev = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'flash', 'darwin');
    if (fs.existsSync(dev)) base = path.resolve(dev);
  }
  if (!base) {
    throw Object.assign(
      new Error('未找到 flash/darwin 资源（sudo-askpass）。开发态请保留 electron/resources/flash/darwin。'),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }
  let lang = 'en';
  try {
    lang = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2);
  } catch {
    /* ignore */
  }
  const pick = (lng) => path.join(base, `sudo-askpass.osascript-${lng}.js`);
  if (fs.existsSync(pick(lang))) return pick(lang);
  if (fs.existsSync(pick('en'))) return pick('en');
  throw Object.assign(
    new Error('缺少 sudo-askpass.osascript-zh.js / en.js'),
    { code: FlashErrorCode.TOOL_MISSING },
  );
}

/** 与 Imager FlashMac 一致：用 `/usr/bin/env` 取 PATH 再交给 sudo */
function buildMacSudoDdEnv(askpassPath) {
  let envOut = '';
  try {
    envOut = execFileSync('/usr/bin/env', [], { encoding: 'utf8' });
  } catch {
    envOut = '';
  }
  const pathLine = envOut.split('\n').find((l) => l.startsWith('PATH='));
  const PATH = pathLine ? pathLine.slice(5) : process.env.PATH || '';
  return {
    ...process.env,
    SUDO_ASKPASS: askpassPath,
    PATH,
  };
}

/** 与 Windows verifyImageSampleDotNet 一致：头尾各至多 1MB，且尾块在镜像与盘上的偏移均为 tailPos（非磁盘物理末尾） */
async function verifySampleWithSudoMac(imagePath, rawPath, totalBytes, sudoEnv) {
  const n = Math.min(1024 * 1024, totalBytes);
  if (n <= 0) return { ok: false, detail: '镜像为空，无法校验' };
  const tailPos = Math.max(0, totalBytes - n);
  const script = `
set -e
IMG=${shSingleQuote(imagePath)}
RAW=${shSingleQuote(rawPath)}
T=$(mktemp -d /tmp/rdkvfy.XXXXXX)
head -c ${n} "$IMG" > "$T/i"
head -c ${n} "$RAW" > "$T/d"
cmp -s "$T/i" "$T/d"
/usr/bin/python3 -c "
import sys
img, raw, tail, n = sys.argv[1:5]
tail, n = int(tail), int(n)
with open(img, 'rb') as f:
    f.seek(tail)
    a = f.read(n)
with open(raw, 'rb') as f:
    f.seek(tail)
    b = f.read(n)
sys.exit(0 if a == b else 1)
" "$IMG" "$RAW" ${tailPos} ${n}
rm -rf "$T"
`;
  await new Promise((resolve, reject) => {
    const child = spawn('sudo', ['--askpass', 'sh', '-c', script], { env: sudoEnv });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `校验脚本退出 ${code}`));
    });
  });
  return { ok: true, detail: `样本校验通过（${n}B 头尾抽样，sudo）` };
}

function resolveIoPolicy(options = {}) {
  const turbo = options.performanceProfile === 'turbo';
  if (turbo) {
    return { chunkBytes: 2 * 1024 * 1024 };
  }
  return { chunkBytes: 512 * 1024 };
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

  const stat = fs.statSync(imagePath);
  const total = stat.size;
  if (Number.isFinite(driveMeta.sizeBytes) && driveMeta.sizeBytes > 0 && total > driveMeta.sizeBytes) {
    throw Object.assign(new Error(`镜像体积超出目标盘容量：image=${total}B, drive=${driveMeta.sizeBytes}B`), { code: FlashErrorCode.IMAGE_TOO_LARGE });
  }

  const askpassPath = resolveFlashDarwinAskpassPathOrThrow();
  const sudoEnv = buildMacSudoDdEnv(askpassPath);

  emitFlashProgress({ stage: 'prepare', message: '正在卸载磁盘分区...', percent: 1 });
  try {
    await unmountDisk(driveMeta.id);
  } catch (e) {
    throw Object.assign(new Error(`无法卸载磁盘 ${driveMeta.id}: ${e.message}`), { code: FlashErrorCode.WRITE_FAILED });
  }

  const rawPath = driveMeta.rawPath || driveMeta.path;
  emitFlashProgress({
    stage: 'prepare',
    message: '写盘引擎: /bin/dd（与 rdkstudio_frontend-master Imager FlashMac 一致）…',
    percent: 2,
  });

  const bs = options.performanceProfile === 'turbo' ? '8m' : '4m';
  /** BSD dd 无 GNU 的 conv=fsync；写后由 /bin/sync 刷盘（见 close 回调） */
  const shellCmd = `/bin/dd bs=${bs} of=${shSingleQuote(rawPath)} if=${shSingleQuote(imagePath)} status=progress`;

  activeOp = { id: crypto.randomUUID(), cancelled: false, child: null };
  let verify = { ok: true, detail: '跳过校验' };

  try {
    emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘，请勿拔出介质', percent: 3 });
    await new Promise((resolve, reject) => {
      const child = spawn('sudo', ['--askpass', 'sh', '-c', shellCmd], { env: sudoEnv });
      activeOp.child = child;
      let stderrCarry = '';
      let ioBuf = '';
      const onChunk = (d) => {
        const chunk = d.toString();
        ioBuf += chunk;
        const text = stderrCarry + chunk;
        const lines = text.split(/\r?\n/);
        stderrCarry = lines.pop() || '';
        for (const line of lines) {
          const bytes = parseDdCopiedBytes(line);
          if (bytes === null) continue;
          const percent = Math.min(98, Math.max(3, Math.round((bytes / total) * 96) + 2));
          emitFlashProgress({
            stage: 'flashing',
            message: `已写入 ${(bytes / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`,
            percent,
          });
        }
      };
      child.stderr.on('data', onChunk);
      child.stdout.on('data', onChunk);
      child.on('error', reject);
      child.on('close', (code) => {
        activeOp.child = null;
        if (stderrCarry.trim()) {
          const bytes = parseDdCopiedBytes(stderrCarry.trim());
          if (bytes !== null) {
            const percent = Math.min(98, Math.max(3, Math.round((bytes / total) * 96) + 2));
            emitFlashProgress({
              stage: 'flashing',
              message: `已写入 ${(bytes / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`,
              percent,
            });
          }
        }
        if (activeOp?.cancelled) {
          reject(Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED }));
          return;
        }
        if (code === 0) {
          try {
            execFileSync('/bin/sync', [], { stdio: 'ignore' });
          } catch {
            /* ignore */
          }
          resolve();
        } else {
          reject(new Error((ioBuf || `dd 退出码 ${code}`).trim()));
        }
      });
    });

    if (verifyMode === 'sample') {
      emitFlashProgress({ stage: 'verifying', message: '正在执行写后抽样校验', percent: 99 });
      if (checkIsRoot()) {
        let imageFd;
        let targetFd;
        try {
          imageFd = fs.openSync(imagePath, 'r');
          targetFd = fs.openSync(rawPath, 'r');
          verify = verifyImageSample(imageFd, targetFd, total);
        } finally {
          try {
            if (imageFd !== undefined) fs.closeSync(imageFd);
          } catch {
            /* ignore */
          }
          try {
            if (targetFd !== undefined) fs.closeSync(targetFd);
          } catch {
            /* ignore */
          }
        }
      } else {
        try {
          verify = await verifySampleWithSudoMac(imagePath, rawPath, total, sudoEnv);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          verify = { ok: false, detail: msg };
        }
      }
      if (!verify.ok) throw Object.assign(new Error(verify.detail), { code: FlashErrorCode.VERIFY_FAILED });
    }

    emitFlashProgress({ stage: 'done', message: '镜像写入完成', percent: 100 });
    return { output: `镜像已写入 ${rawPath}`, verify };
  } finally {
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
  const ioPolicy = resolveIoPolicy();
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
  if (!activeOp) return;
  activeOp.cancelled = true;
  if (activeOp.child) {
    try {
      activeOp.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
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
