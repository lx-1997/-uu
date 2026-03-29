/**
 * Windows flash adapter.
 *
 * Provides drive enumeration, image writing, backup, decompression and
 * xburn launching on Windows via PowerShell and direct file I/O.
 *
 * TF 卡：若 `electron/resources/flash/win32/x64/` 下同时存在 **dd.exe + ls.exe**（与 rdkstudio_frontend-master
 * `extraResources/flash/win32/x64` 一致），则**完全采用该前端的 FlashBehavior 流程**（ls 枚举、bat+runAs、dd）。
 * 否则回退：diskpart clean + PowerShell/.NET 或 Node 直写。
 *
 * Every public method mirrors the adapter interface consumed by the
 * flash service — no Electron-specific imports here.
 */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);
import { emitFlashProgress } from '../progress.mjs';
import { FlashErrorCode } from '../types.mjs';
import { etcherStyleDiskpartClean } from '../etcher-diskpart-clean.mjs';
import {
  hasFrontendFlashBundle,
  listUsbDevicesViaLs,
  msysDeviceToPhysicalDrive,
  physicalDriveToMsysOf,
  startFrontendStyleDdFlash,
} from '../win-dd-flash.mjs';

let activeOp = null;

/** Node 写盘进度节流（与 macOS 对齐） */
const WIN_NODE_WRITE_PROGRESS_MS = 250;

/** Win CreateProcess 命令行约 8191 字符；-EncodedCommand 的 Base64 单独控制长度，避免超长退回 -File */
const ENCODED_COMMAND_B64_MAX = 7000;

/**
 * 烧录用：优先 PowerShell 7（pwsh），错误为纯文本，不会像 5.1 那样把 stderr 打成 CLIXML。
 * 否则 32 位进程在 64 位 Windows 上用 Sysnative 下的 Windows PowerShell 5.1。
 */
function getPowerShellExe() {
  if (process.platform !== 'win32') return 'powershell.exe';
  const pwshCandidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'PowerShell', '7', 'pwsh.exe'),
  ].filter(Boolean);
  for (const p of pwshCandidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  try {
    const sysnative = path.join(process.env.SystemRoot || 'C:\\Windows', 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(sysnative)) return sysnative;
  } catch {
    /* ignore */
  }
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(system32)) return system32;
  return 'powershell.exe';
}

/** PowerShell -EncodedCommand：脚本须为 UTF-16LE 再 Base64（无 BOM） */
function encodePowerShellCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function writePs1WithBom(ps1Path, body) {
  fs.writeFileSync(ps1Path, `\ufeff${body}`, 'utf8');
}

function resolvePowerShellSpawnArgs(scriptBody) {
  const enc = encodePowerShellCommand(scriptBody);
  /** -NonInteractive：避免宿主在异常时仍尝试交互，与 CLIXML 混排 */
  const psArgsPrefix = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
  if (enc.length <= ENCODED_COMMAND_B64_MAX) {
    return { mode: 'encoded', args: [...psArgsPrefix, '-EncodedCommand', enc] };
  }
  const ps1Path = path.join(os.tmpdir(), `rdk-flash-script-${crypto.randomUUID()}.ps1`);
  writePs1WithBom(ps1Path, scriptBody);
  return { mode: 'file', ps1Path, args: [...psArgsPrefix, '-File', ps1Path] };
}

function resolveIoPolicy(options = {}) {
  const turbo = options.performanceProfile === 'turbo';
  if (turbo) {
    /** 极速仍用较大块；若遇不稳定可改回常规模式（小块） */
    return { chunkBytes: 1024 * 1024 };
  }
  /**
   * 常规模式：此前 64KB + PowerShell 每块 `ConvertTo-Json` 会占满 CPU，有效写速仅几十 KB/s。
   * 512KB 仍明显低于极速 1MB，一般读卡器可接受；若遇杀软拦截可再试环境变量或 turbo。
   */
  return { chunkBytes: 512 * 1024 };
}

/**
 * 尝试以 Node libuv 直接打开镜像与 \\.\PhysicalDriveN（与 macOS 同源，不经 PowerShell/.NET）。
 * 打包/杀软环境下首次 open 常因时机 EIO，故多次重试并间歇重申 mountvol /N。
 * 若仍失败则返回 null，由调用方回退 startDotNetRawWrite。
 */
async function tryOpenWinNodeRawHandles(imagePath, drivePath) {
  let imageFh;
  try {
    imageFh = await fs.promises.open(imagePath, 'r');
  } catch {
    return null;
  }
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 350 * attempt));
      void setWindowsAutoMountNewVolumes(false);
    }
    try {
      const targetFh = await fs.promises.open(drivePath, 'r+');
      return { imageFh, targetFh };
    } catch {
      /* 下一轮 */
    }
  }
  await imageFh.close().catch(() => {});
  return null;
}

/**
 * Windows：优先用 Node 与 mac 相同循环写盘；句柄由本函数关闭。
 * 分区表出现后若单次 write 失败会重试并重申 mountvol /N（由外层 interval + 此处 void 调用）。
 */
async function runWinNodeRawWriteWithHandles(imageFh, targetFh, chunkBytes, totalBytes) {
  const buffer = Buffer.allocUnsafe(chunkBytes);
  let offset = 0;
  let lastProgressPercent = -1;
  let lastProgressEmitAt = 0;
  activeOp.nodeRawHandles = { imageFh, targetFh };
  try {
    emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘，请勿拔出介质', percent: 3 });
    while (true) {
      if (activeOp?.cancelled) {
        throw Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED });
      }
      const res = await imageFh.read(buffer, 0, buffer.length, offset);
      const bytesRead = res.bytesRead;
      if (bytesRead === 0) break;

      let writeOk = false;
      let lastW = null;
      for (let ti = 0; ti < 18; ti++) {
        if (activeOp?.cancelled) {
          throw Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED });
        }
        try {
          await targetFh.write(buffer, 0, bytesRead, offset);
          writeOk = true;
          break;
        } catch (w) {
          lastW = w;
          void setWindowsAutoMountNewVolumes(false);
          await new Promise((r) => setTimeout(r, 280 + ti * 140));
        }
      }
      if (!writeOk) {
        const em = lastW instanceof Error ? lastW.message : String(lastW);
        throw Object.assign(new Error(`写入物理磁盘失败：${em}`), { code: FlashErrorCode.WRITE_FAILED });
      }

      offset += bytesRead;
      const percent = Math.min(98, Math.max(3, Math.round((offset / totalBytes) * 96) + 2));
      const now = Date.now();
      if (
        percent >= lastProgressPercent + 1
        || now - lastProgressEmitAt >= WIN_NODE_WRITE_PROGRESS_MS
        || offset >= totalBytes
      ) {
        lastProgressPercent = percent;
        lastProgressEmitAt = now;
        emitFlashProgress({
          stage: 'flashing',
          message: `已写入 ${(offset / 1024 / 1024).toFixed(1)} MB / ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
          percent,
        });
      }
    }
    await targetFh.sync();
  } finally {
    activeOp.nodeRawHandles = null;
    await imageFh.close().catch(() => {});
    await targetFh.close().catch(() => {});
  }
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(getPowerShellExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
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

/**
 * 是否以管理员身份运行（提升后的进程）。
 * 打包版 Electron 有时 PATH 不含 System32，spawn 仅依赖 `powershell.exe` 会失败；故优先用绝对路径 + execFile。
 * 仅当 PowerShell 无法执行（而非明确返回 False）时，用 `net session` 作备用（非管理员通常 System error 5）。
 */
async function isAdmin() {
  const psCmd =
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)';
  const parsePs = (out) => String(out ?? '').trim().toLowerCase();

  try {
    const ps = getPowerShellExe();
    const { stdout } = await execFileAsync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
      windowsHide: true,
      maxBuffer: 256,
    });
    const v = parsePs(stdout);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* PowerShell 未跑起来，尝试 spawn 路径 */
  }
  try {
    const out = await runPowerShell(psCmd);
    const v = parsePs(out);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* ignore */
  }
  try {
    const netExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'net.exe');
    await execFileAsync(netExe, ['session'], { windowsHide: true, maxBuffer: 4096 });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} drivePath e.g. `\\\\.\\PhysicalDrive1` */
function parsePhysicalDriveNumber(drivePath) {
  const normalized = normalizeWinPhysicalDrivePath(drivePath);
  const m = String(normalized).match(/PhysicalDrive(\d+)\s*$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * 规范化为 `\\.\PhysicalDriveN`（无尾部 `\`/`/`）。
 * - 尾部多一个 `\` 时，部分环境下 libuv CreateFile 会报 EIO；
 * - `//./PhysicalDriveN`、混用 `/`、IPC 转义等统一为同一形式；
 * 烧录 UI 与 listDrives 仅传入物理盘路径；若普通文件路径以 PhysicalDriveN 结尾会误伤（极罕见）。
 */
function normalizeWinPhysicalDrivePath(drivePath) {
  let s = String(drivePath || '').trim();
  s = s.replace(/\//g, '\\');
  while (s.endsWith('\\')) {
    s = s.slice(0, -1);
  }
  const m = s.match(/PhysicalDrive\s*(\d+)$/i);
  if (m) {
    return `\\\\.\\PhysicalDrive${m[1]}`;
  }
  return s;
}

/**
 * 参考 rpi-imager `diskpart_util::unmountVolumes`：卸载卷并移除盘符（mountvol /D），
 * 避免资源管理器在写入过程中再次占用（仅 Dismount-Volume 往往不够）。
 * 不使用 Set-Disk -Offline，避免部分读卡器在打开 PhysicalDrive 时稳定 EIO。
 */
async function unmountPhysicalDriveVolumesRpiStyle(diskNumber) {
  const n = Number(diskNumber);
  const script = `
$ErrorActionPreference = 'Continue'
$n = ${n}
function Remove-RpiDiskLetters {
  param([int]$DiskN)
  $parts = @(Get-Partition -DiskNumber $DiskN -ErrorAction SilentlyContinue)
  foreach ($p in $parts) {
    $dl = $p.DriveLetter
    if ($dl) {
      try {
        Dismount-Volume -DriveLetter $dl -Confirm:$false -ErrorAction SilentlyContinue
      } catch { }
      try {
        $mv = Join-Path $env:SystemRoot 'System32\\mountvol.exe'
        if (Test-Path -LiteralPath $mv) {
          $arg = $dl + ':'
          Start-Process -FilePath $mv -ArgumentList @($arg, '/D') -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
        }
      } catch { }
    }
    foreach ($ap in @($p.AccessPaths)) {
      if ($ap -match '^\\\\\?\\Volume\{') {
        try { Dismount-Volume -Path $ap -ErrorAction SilentlyContinue } catch { }
      }
    }
  }
}
Remove-RpiDiskLetters -DiskN $n
Start-Sleep -Milliseconds 400
Remove-RpiDiskLetters -DiskN $n
Start-Sleep -Milliseconds 600
try { Update-Disk -Number $n -ErrorAction SilentlyContinue } catch { }
Start-Sleep -Milliseconds 400
`;
  await runPowerShell(script);
}

/** 备份等只读场景：仅卸载，不 clean */
async function prepareDiskForRawWrite(diskNumber) {
  await unmountPhysicalDriveVolumesRpiStyle(diskNumber);
}

/** USB/读卡器在卸载卷后需再等一会儿，否则 CreateFile(\\.\PhysicalDriveN) 常短暂 EIO */
const POST_UNMOUNT_SETTLE_MS = 2200;

/** 写入过程中分区表出现后 Windows 可能再次尝试挂载新卷，主进程侧定期重申 mountvol /N */
const AUTO_MOUNT_REASSERT_MS = 2500;

/**
 * 写入前 mountvol /N：暂时关闭「新卷自动挂载」，减轻写入数 MB 后分区表已写入、系统识别分区并自动挂载、与 raw 写入争用导致的 UnauthorizedAccess。
 * 写入结束务必 mountvol /E 恢复，避免影响用户插拔其它 U 盘。
 */
function setWindowsAutoMountNewVolumes(enable) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false });
  }
  return new Promise((resolve) => {
    execFile('mountvol', [enable ? '/E' : '/N'], { windowsHide: true }, (err) => {
      resolve({ ok: !err });
    });
  });
}

const FLASH_PROGRESS_PREFIX = 'RDK_FLASH_PROGRESS_JSON=';
/** 旧版明文（易因控制台代码页在 Node 侧变乱码） */
const RDK_FLASH_FATAL_PREFIX = 'RDK_FLASH_FATAL:';
/** UTF-8 经 Base64 输出（备用） */
const RDK_FLASH_FATAL_B64_PREFIX = 'RDK_FLASH_FATAL_B64=';
/** 首选：异常写入 %TEMP% 下 UTF-8 文件，stdout 只输出 ASCII 路径行，避免管道编码损坏中文 */
const RDK_FLASH_FATAL_FILE_PREFIX = 'RDK_FLASH_FATAL_FILE=';

function readFatalUtf8File(filePath) {
  const fp = String(filePath || '').trim();
  if (!fp) return null;
  try {
    const content = fs.readFileSync(fp, 'utf8');
    try {
      fs.unlinkSync(fp);
    } catch {
      /* ignore */
    }
    const t = content.trim();
    return t || null;
  } catch {
    return null;
  }
}

function parseFatalLineFromOutput(text) {
  const s = String(text || '');
  const fileIdx = s.indexOf(RDK_FLASH_FATAL_FILE_PREFIX);
  if (fileIdx !== -1) {
    const rest = s.slice(fileIdx + RDK_FLASH_FATAL_FILE_PREFIX.length);
    const lineEnd = rest.search(/\r\n|\n|\r/);
    const line = (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).trim();
    const fromFile = readFatalUtf8File(line);
    if (fromFile) return fromFile;
  }
  const b64Idx = s.indexOf(RDK_FLASH_FATAL_B64_PREFIX);
  if (b64Idx !== -1) {
    const rest = s.slice(b64Idx + RDK_FLASH_FATAL_B64_PREFIX.length);
    const lineEnd = rest.search(/\r\n|\n|\r/);
    const line = (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).trim();
    if (!line) return null;
    try {
      return Buffer.from(line, 'base64').toString('utf8') || null;
    } catch {
      return null;
    }
  }
  const idx = s.indexOf(RDK_FLASH_FATAL_PREFIX);
  if (idx === -1) return null;
  const rest = s.slice(idx + RDK_FLASH_FATAL_PREFIX.length);
  const lineEnd = rest.search(/\r\n|\n|\r/);
  const line = (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).trim();
  return line || null;
}

/** 从 PowerShell 5.1 写入 stderr 的 CLIXML 中抽出 <S S="Error"> 文本（便于展示，避免整段 XML） */
function extractClixmlErrorStrings(raw) {
  const s = String(raw || '');
  const out = [];
  const re = /<S\s+S="Error">([^<]*)<\/S>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const t = String(m[1] || '')
      .replace(/_x000D__x000A_/gi, '\n')
      .replace(/_x000A_/gi, '\n')
      .trim();
    if (t) out.push(t);
  }
  return out;
}

/** IPC 或 stderr 拼接偶发导致同一段说明出现两遍，折叠后再进 UI/Toast */
function collapseDuplicateFlashErrorText(s) {
  const t = String(s || '').replace(/\r\n/g, '\n').trim();
  if (t.length < 24) return t;
  const half = Math.floor(t.length / 2);
  if (half >= 12 && t.slice(0, half) === t.slice(half)) return t.slice(0, half).trim();
  /** 整段重复、或连续两行/多行完全相同（长文本对半切分可能落在段中导致漏判） */
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
  const deduped = [];
  for (const line of lines) {
    if (deduped.length && deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }
  return deduped.join('\n');
}

/** 解析 .NET/PowerShell 失败信息，避免把整段 CLIXML 塞进 UI */
function formatDotNetFlashWriteErrorRaw(stderrOrMessage) {
  const raw = String(stderrOrMessage || '').trim();
  /** Node 直写等路径已带「写入物理磁盘失败：」前缀，避免再包一层 */
  if (/^写入物理磁盘失败[：:]/u.test(raw)) {
    return collapseDuplicateFlashErrorText(raw);
  }
  const fatal = parseFatalLineFromOutput(raw);
  if (fatal) {
    let short = fatal.length > 520 ? `${fatal.slice(0, 520)}…` : fatal;
    /** .NET 中文提示常以「。」结尾，避免与下文「。常见原因」连成「。。」 */
    short = short.replace(/[。.]+$/u, '').trim();
    if (
      /UnauthorizedAccess|访问被拒绝|对路径的访问被拒绝|Access is denied|Access to the path/i.test(fatal)
    ) {
      return `写入被拒绝（UnauthorizedAccess）：${short}。常见原因：写入数 MB 后分区表已落盘，Windows 可能短暂挂载新卷并与 raw 写入争用；杀毒/Defender 实时扫描、资源管理器或读卡器不稳也会触发。请尝试：以管理员运行、将 RDK Studio 与镜像目录加入排除、关闭已打开的该介质窗口、换 USB 口后重试。若其它工具（如 Rufus）可写而此处失败，多为上述争用，可多试几次。仍失败可设置环境变量 RDK_FLASH_WIN_FORCE_NODE=1 后重启，改用 Node 直写物理盘（与默认 PowerShell/.NET 路径争用表现可能不同）。`;
    }
    return `写入物理磁盘失败：${short}`;
  }
  const clixmlErrors = extractClixmlErrorStrings(raw);
  const joinedClixml = clixmlErrors.join('\n');
  const looksLikeClixml = /<Objs\s+Version=|#<\s*CLIXML/i.test(raw);
  /** 大镜像时旧脚本 [Math]::Min(int, long) 会按 Int32 解析第二个参数导致溢出 */
  if (
    /\[Math\]::Min|Math\]::Min/i.test(joinedClixml + raw) &&
    /Int32|System\.Int32|val2|太小|太大|overflow/i.test(joinedClixml + raw)
  ) {
    return '写入物理磁盘失败：单次读取长度计算时发生 Int32 溢出（镜像或磁盘大于约 2GB 时，旧版 PowerShell 脚本会误将剩余字节数当作 32 位整数处理）。请更新并重启桌面端后重试；若已是最新版本仍失败，请向开发者反馈。';
  }
  if (looksLikeClixml && joinedClixml) {
    const ascii = joinedClixml.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
    const tail = ascii.length > 420 ? `${ascii.slice(0, 420)}…` : ascii;
    return `写入物理磁盘失败：${tail || 'PowerShell 报错（CLIXML）。多为杀毒实时扫描或卷被重新挂载；请暂时排除该物理盘、关闭实时防护与资源管理器中该盘窗口后重试。'}`;
  }
  if (looksLikeClixml) {
    return '写入物理磁盘失败：PowerShell 报错被序列化为 CLIXML（已写入部分数据后中断）。多为杀毒实时扫描或卷被重新挂载。请暂时排除该物理盘/关闭实时防护、关闭资源管理器中该盘窗口后重试。';
  }
  let short = raw.length > 900 ? `${raw.slice(0, 900)}…` : raw;
  /** CLIXML / 控制台乱码里常重复同一行，避免「写入物理磁盘失败：… 写入物理磁盘失败：…」 */
  short = short.replace(/(写入物理磁盘失败[：:]\s*)+/g, '写入物理磁盘失败：').trim();
  return `写入物理磁盘失败：${short}`;
}

function formatDotNetFlashWriteError(stderrOrMessage) {
  return collapseDuplicateFlashErrorText(formatDotNetFlashWriteErrorRaw(stderrOrMessage));
}

/**
 * Node 在 Windows 上对 \\.\PhysicalDriveN 会经 path.win32.toNamespacedPath 错误地追加尾部 \，
 * 导致 libuv CreateFile 稳定 EIO（见 nodejs/node#54025）。.NET FileStream 直接传设备路径，可绕过该问题。
 */
function writeMetaFile(obj) {
  const p = path.join(os.tmpdir(), `rdk-flash-meta-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
  return p;
}

function runPowerShellFileCaptureStdout(ps1Path) {
  return new Promise((resolve, reject) => {
    const child = spawn(getPowerShellExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path], {
      windowsHide: true,
    });
    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout.on('data', (d) => { stdoutBuf += d.toString(); });
    child.stderr.on('data', (d) => { stderrBuf += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdoutBuf.trim());
      else reject(new Error((stderrBuf || stdoutBuf || `powershell exit ${code}`).trim()));
    });
  });
}

/** 使用 .NET FileStream 整盘写入；返回 { child, done } 以便取消时 kill */
function startDotNetRawWrite(imagePath, drivePath, chunkBytes) {
  const metaPath = writeMetaFile({ imagePath, drivePath, chunkBytes });
  const ps1Body = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$metaPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(metaPath, 'utf8').toString('base64')}'))
$meta = Get-Content -LiteralPath $metaPath -Encoding UTF8 | ConvertFrom-Json
$imagePath = $meta.imagePath
$drivePath = $meta.drivePath
$chunk = [int]$meta.chunkBytes
function Write-RdkFatalUtf8([string]$txt) {
  $p = Join-Path $env:TEMP ('rdk-fatal-' + [guid]::NewGuid().ToString() + '.txt')
  [System.IO.File]::WriteAllText($p, $txt, [System.Text.UTF8Encoding]::new($false))
  [Console]::Out.WriteLine('${RDK_FLASH_FATAL_FILE_PREFIX}' + $p)
  [Console]::Out.Flush()
}
function Invoke-RdkReassertNoAutoMount {
  try {
    $mv = Join-Path $env:SystemRoot 'System32\\mountvol.exe'
    if (Test-Path -LiteralPath $mv) {
      Start-Process -FilePath $mv -ArgumentList '/N' -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
    }
  } catch { }
}
# 顺序读镜像，减轻系统缓存与 I/O 抖动
$img = New-Object System.IO.FileStream($imagePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read, $chunk, [System.IO.FileOptions]::SequentialScan)
try {
  # FileShare.Read：独占 None 时易与 Defender/卷枚举争用句柄导致 UnauthorizedAccess；允许读共享常可共存
  $dst = New-Object System.IO.FileStream($drivePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read, $chunk)
  try {
    Invoke-RdkReassertNoAutoMount
    # 多留 512 字节，末块扇区对齐填充时不会越界（对齐 rpi-imager / Win 物理盘写入要求）
    $buf = New-Object byte[] ([int]$chunk + 512)
    $total = $img.Length
    $off = 0L
    $lastMountVolPing = 0L
    $lastProgressOff = 0L
    # 约 120 条进度/盘；单步上限 16MB，下限 1MB（避免 9GB 镜像仍每 64KB 打一次 JSON）
    $progressEvery = [long][Math]::Max(1048576L, [Math]::Min(16777216L, [Math]::Ceiling($total / 120.0)))
    # 前 128MB：GPT/分区已可见，512KB 重申 mountvol；之后每 64MB 一次（避免全程过密拖慢）
    $earlyGuardBytes = 134217728L
    $sector = 512
    while ($off -lt $total) {
      # 与备份同源：必须用 Int64 参与 Min，否则 $total-$off 超过 Int32 时 [Math]::Min 会按 Int32 解析而抛错
      $need = [int][Math]::Min([int64]$chunk, $total - $off)
      $n = $img.Read($buf, 0, $need)
      if ($n -le 0) { break }
      $wlen = $n
      if (($n % $sector) -ne 0) {
        $pad = $sector - ($n % $sector)
        for ($pi = 0; $pi -lt $pad; $pi++) { $buf[$n + $pi] = 0 }
        $wlen = $n + $pad
      }
      $blockStart = $off
      $maxStreamRecover = 8
      $streamRecover = 0
      $blockDone = $false
      while (-not $blockDone) {
        $writeOk = $false
        $lastWriteErr = $null
        for ($ti = 0; $ti -lt 18; $ti++) {
          try {
            $dst.Write($buf, 0, $wlen)
            $writeOk = $true
            break
          } catch {
            $lastWriteErr = $_
            Invoke-RdkReassertNoAutoMount
            Start-Sleep -Milliseconds (280 + $ti * 140)
          }
        }
        if ($writeOk) {
          $blockDone = $true
          break
        }
        if ($streamRecover -ge $maxStreamRecover) {
          $ex = $null
          if ($lastWriteErr) { $ex = $lastWriteErr.Exception } else { $ex = (New-Object System.Exception('写入失败（无异常详情）')) }
          $inner = $ex
          while ($inner.InnerException) { $inner = $inner.InnerException }
          $em = ($inner.Message -replace "\\s+", " ")
          Write-RdkFatalUtf8 $em
          exit 1
        }
        $streamRecover++
        try { $dst.Dispose() } catch { }
        Start-Sleep -Milliseconds 700
        Invoke-RdkReassertNoAutoMount
        try {
          $dst = New-Object System.IO.FileStream($drivePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read, $chunk)
          [void]$dst.Seek($blockStart, 'Begin')
        } catch {
          $inner = $_.Exception
          while ($inner.InnerException) { $inner = $inner.InnerException }
          $em = ($inner.Message -replace "\\s+", " ")
          Write-RdkFatalUtf8 $em
          exit 1
        }
      }
      $off += $n
      $mountVolStep = 67108864L
      if ($off -le $earlyGuardBytes) { $mountVolStep = 524288L }
      if (($off - $lastMountVolPing) -ge $mountVolStep) {
        Invoke-RdkReassertNoAutoMount
        $lastMountVolPing = $off
      }
      # 勿用 ConvertTo-Json 逐块输出（极慢）；字符串拼 JSON + 按间隔写 stdout
      $emitProgress = ($off -ge $total) -or (($off - $lastProgressOff) -ge $progressEvery) -or (($lastProgressOff -eq 0L) -and ($off -ge [Math]::Min(1048576L, $total)))
      if ($emitProgress) {
        $line = '${FLASH_PROGRESS_PREFIX}{"offset":' + $off + ',"total":' + $total + '}'
        [Console]::Out.WriteLine($line)
        [Console]::Out.Flush()
        $lastProgressOff = $off
      }
    }
    $dst.Flush()
  } finally { $dst.Dispose() }
} finally { $img.Dispose() }
`;
  const spawnOpts = resolvePowerShellSpawnArgs(ps1Body);
  const extraPs1 = spawnOpts.mode === 'file' ? spawnOpts.ps1Path : null;
  const child = spawn(getPowerShellExe(), spawnOpts.args, {
    windowsHide: true,
  });
  let stdoutBuf = '';
  let stderrBuf = '';
  let stdoutLineCarry = '';
  const flushFlashLine = (line) => {
    if (
      line.startsWith(RDK_FLASH_FATAL_FILE_PREFIX) ||
      line.startsWith(RDK_FLASH_FATAL_B64_PREFIX) ||
      line.startsWith(RDK_FLASH_FATAL_PREFIX)
    ) {
      return;
    }
    if (!line.startsWith(FLASH_PROGRESS_PREFIX)) return;
    try {
      const { offset, total } = JSON.parse(line.slice(FLASH_PROGRESS_PREFIX.length));
      const percent = Math.min(98, Math.max(3, Math.round((offset / total) * 96) + 2));
      emitFlashProgress({
        stage: 'flashing',
        message: `已写入 ${(offset / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`,
        percent,
      });
    } catch {
      /* ignore malformed line */
    }
  };
  const pushStdout = (d) => {
    const chunk = d.toString();
    stdoutBuf += chunk;
    const text = stdoutLineCarry + chunk;
    const lines = text.split(/\r?\n/);
    stdoutLineCarry = lines.pop() || '';
    for (const line of lines) {
      flushFlashLine(line);
    }
  };
  /** 仅 stdout 解析进度；PS 5.1 等会把同类输出同时打到 stderr，避免对 stderr 再 emit 一遍进度 */
  const pushStderr = (d) => {
    stderrBuf += d.toString();
  };
  child.stdout.on('data', pushStdout);
  child.stderr.on('data', pushStderr);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (stdoutLineCarry.trim()) flushFlashLine(stdoutLineCarry.trim());
      try {
        fs.unlinkSync(metaPath);
      } catch {
        /* ignore */
      }
      try {
        if (extraPs1) fs.unlinkSync(extraPs1);
      } catch {
        /* ignore */
      }
      if (code === 0) resolve();
      else {
        const combined = `${stdoutBuf}\n${stderrBuf}`.trim();
        reject(new Error(combined || `powershell exit ${code}`));
      }
    });
  });
  return { child, done };
}

/** 物理盘备份：.NET 读 PhysicalDrive，避免 Node fs.open 对 raw 设备 EIO */
function startDotNetRawBackup(drivePath, outputPath, totalBytes, chunkBytes) {
  const metaPath = writeMetaFile({ drivePath, outputPath, totalBytes, chunkBytes });
  const ps1Body = `$ErrorActionPreference = 'Stop'
$metaPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(metaPath, 'utf8').toString('base64')}'))
$meta = Get-Content -LiteralPath $metaPath -Encoding UTF8 | ConvertFrom-Json
$src = New-Object System.IO.FileStream($meta.drivePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
try {
  $dst = New-Object System.IO.FileStream($meta.outputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try {
    $buf = New-Object byte[] ([int]$meta.chunkBytes)
    $total = [int64]$meta.totalBytes
    $off = 0L
    $lastProgressOff = 0L
    $progressEvery = [long][Math]::Max(1048576L, [Math]::Min(16777216L, [Math]::Ceiling($total / 120.0)))
    while ($off -lt $total) {
      # 必须用 Int64 参与 Min：镜像/磁盘 >2GiB 时 $total-$off 超出 Int32，否则 [Math]::Min 会错误地按 Int32 解析第二个参数而抛错
      $need = [int][Math]::Min([int64]$buf.Length, $total - $off)
      $n = $src.Read($buf, 0, $need)
      if ($n -le 0) { break }
      $dst.Write($buf, 0, $n)
      $off += $n
      $emitProgress = ($off -ge $total) -or (($off - $lastProgressOff) -ge $progressEvery) -or (($lastProgressOff -eq 0L) -and ($off -ge [Math]::Min(1048576L, $total)))
      if ($emitProgress) {
        $line = '${FLASH_PROGRESS_PREFIX}{"offset":' + $off + ',"total":' + $total + '}'
        [Console]::Error.WriteLine($line)
        $lastProgressOff = $off
      }
    }
    $dst.Flush()
  } finally { $dst.Dispose() }
} finally { $src.Dispose() }
`;
  const spawnOpts = resolvePowerShellSpawnArgs(ps1Body);
  const extraPs1 = spawnOpts.mode === 'file' ? spawnOpts.ps1Path : null;
  const child = spawn(getPowerShellExe(), spawnOpts.args, {
    windowsHide: true,
  });
  let stderrBuf = '';
  let stderrLineCarry = '';
  const flushBackupProgressLine = (line) => {
    if (!line.startsWith(FLASH_PROGRESS_PREFIX)) return;
    try {
      const { offset, total } = JSON.parse(line.slice(FLASH_PROGRESS_PREFIX.length));
      const percent = Math.min(99, Math.max(2, Math.round((offset / total) * 98) + 1));
      emitFlashProgress({
        stage: 'backup',
        message: `已备份 ${(offset / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`,
        percent,
      });
    } catch {
      /* ignore */
    }
  };
  child.stderr.on('data', (d) => {
    const chunk = d.toString();
    stderrBuf += chunk;
    const text = stderrLineCarry + chunk;
    const lines = text.split(/\r?\n/);
    stderrLineCarry = lines.pop() || '';
    for (const line of lines) {
      flushBackupProgressLine(line);
    }
  });
  child.stdout.on('data', (d) => { stderrBuf += d.toString(); });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (stderrLineCarry.trim()) flushBackupProgressLine(stderrLineCarry.trim());
      try {
        fs.unlinkSync(metaPath);
      } catch {
        /* ignore */
      }
      try {
        if (extraPs1) fs.unlinkSync(extraPs1);
      } catch {
        /* ignore */
      }
      if (code === 0) resolve();
      else reject(new Error((stderrBuf || `powershell exit ${code}`).trim()));
    });
  });
  return { child, done };
}

/** 抽样校验：.NET 读盘与镜像对比（避免对 PhysicalDrive 使用 fs.open） */
async function verifyImageSampleDotNet(imagePath, drivePath, totalBytes) {
  const sampleSize = Math.min(1024 * 1024, totalBytes);
  if (sampleSize <= 0) return { ok: false, detail: '镜像为空，无法校验' };
  const tailPos = Math.max(0, totalBytes - sampleSize);
  const metaPath = writeMetaFile({ imagePath, drivePath, sampleSize, tailPos });
  const ps1Path = path.join(os.tmpdir(), `rdk-flash-verify-${crypto.randomUUID()}.ps1`);
  const ps1Body = `$ErrorActionPreference = 'Stop'
function Test-RdkByteEqual([byte[]]$a, [byte[]]$b) {
  if ($a.Length -ne $b.Length) { return $false }
  for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { return $false } }
  return $true
}
$metaPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(metaPath, 'utf8').toString('base64')}'))
$meta = Get-Content -LiteralPath $metaPath -Encoding UTF8 | ConvertFrom-Json
$imgFs = [System.IO.File]::OpenRead($meta.imagePath)
$diskFs = New-Object System.IO.FileStream($meta.drivePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
try {
  $sz = [int]$meta.sampleSize
  $bImg = New-Object byte[] $sz
  $bDisk = New-Object byte[] $sz
  [void]$imgFs.Read($bImg, 0, $sz)
  [void]$diskFs.Read($bDisk, 0, $sz)
  if (-not (Test-RdkByteEqual $bImg $bDisk)) { Write-Output 'RESULT:HEAD_FAIL'; exit 0 }
  $tail = [int64]$meta.tailPos
  [void]$imgFs.Seek($tail, 'Begin')
  [void]$diskFs.Seek($tail, 'Begin')
  [void]$imgFs.Read($bImg, 0, $sz)
  [void]$diskFs.Read($bDisk, 0, $sz)
  if (-not (Test-RdkByteEqual $bImg $bDisk)) { Write-Output 'RESULT:TAIL_FAIL'; exit 0 }
  Write-Output 'RESULT:OK'
} finally {
  $imgFs.Dispose()
  $diskFs.Dispose()
}
`;
  writePs1WithBom(ps1Path, ps1Body);
  try {
    const out = await runPowerShellFileCaptureStdout(ps1Path);
    try {
      fs.unlinkSync(metaPath);
    } catch {
      /* ignore */
    }
    if (String(out).includes('RESULT:HEAD_FAIL')) return { ok: false, detail: '头部样本校验失败' };
    if (String(out).includes('RESULT:TAIL_FAIL')) return { ok: false, detail: '尾部样本校验失败' };
    if (String(out).includes('RESULT:OK')) return { ok: true, detail: `样本校验通过（${sampleSize}B 头尾抽样）` };
    return { ok: false, detail: '校验输出异常' };
  } finally {
    try {
      fs.unlinkSync(ps1Path);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 写盘结束或异常后尽量恢复联机，便于用户看到盘符；失败则不抛，改由界面提示。
 * 注意：Windows PowerShell 5.1 自带 Storage 模块里 Set-Disk 常无 -Online 参数（会报 NamedParameterNotFound），
 * 应使用 -IsOffline $false（与 Win10/Server 等版本兼容）。
 */
async function bringDiskOnlineBestEffort(diskNumber) {
  const n = Number(diskNumber);
  try {
    const script = `
$ErrorActionPreference = 'Stop'
$n = ${n}
$d = Get-Disk -Number $n -ErrorAction Stop
# Use IsOffline only; OperationalStatus strings may be locale-dependent.
if ($d.IsOffline) { $d | Set-Disk -IsOffline $false -ErrorAction Stop }
`;
    await runPowerShell(script);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
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

async function listDrivesPowerShell() {
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

/**
 * 与 rdkstudio_frontend 一致：有 ls.exe 时优先用其枚举 /dev/sd*，并与 Get-Disk 合并容量信息。
 */
export async function listDrives() {
  if (hasFrontendFlashBundle()) {
    try {
      const pairs = listUsbDevicesViaLs();
      const ps = await listDrivesPowerShell();
      if (pairs.length > 0) {
        return pairs.map((p, i) => {
          const phys = msysDeviceToPhysicalDrive(p.device);
          const meta = phys ? ps.find((d) => d.path === phys) : null;
          return {
            id: meta ? String(meta.id) : `ls-${i}`,
            path: p.device,
            label: p.name,
            size: meta?.size ?? '',
            sizeBytes: Number(meta?.sizeBytes || 0),
            bus: meta?.bus ?? '',
            mediaType: meta?.mediaType ?? '',
            removable: meta?.removable ?? true,
          };
        });
      }
    } catch (e) {
      console.warn('[win flash] listUsbDevicesViaLs failed, fallback Get-Disk:', e);
    }
  }
  return listDrivesPowerShell();
}

/**
 * listDrives 在 ls 模式下 path 为 /dev/sd*，UI 或缓存可能仍传 \\.\PhysicalDriveN；需按同一物理盘匹配。
 */
function findDriveMetaInList(drives, drivePathIn) {
  const list = Array.isArray(drives) ? drives : [];
  const raw = String(drivePathIn || '').trim();
  if (!raw) return null;

  const pdNorm = (p) => {
    const s = String(p || '').trim();
    if (s.startsWith('/dev/')) return null;
    return normalizeWinPhysicalDrivePath(p);
  };

  const direct = list.find((d) => d.path === raw);
  if (direct) return direct;

  const targetPd = raw.startsWith('/dev/')
    ? msysDeviceToPhysicalDrive(raw)
    : pdNorm(drivePathIn);
  if (!targetPd) return null;

  return (
    list.find((d) => {
      if (String(d.path || '').startsWith('/dev/')) {
        return msysDeviceToPhysicalDrive(d.path) === targetPd;
      }
      return pdNorm(d.path) === targetPd;
    }) || null
  );
}

export async function writeImage(imagePath, drivePathIn, options = {}) {
  const drivePathRaw = String(drivePathIn || '').trim();
  /** /dev/sd* 勿走 PhysicalDrive 规范化 */
  const drivePath = drivePathRaw.startsWith('/dev/')
    ? drivePathRaw
    : normalizeWinPhysicalDrivePath(drivePathIn);
  const verifyMode = options.verifyMode || 'sample';
  const ioPolicy = resolveIoPolicy(options);
  const drives = await listDrives();
  const driveMeta = findDriveMetaInList(drives, drivePathIn);
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：目标磁盘不是可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });

  const stat = fs.statSync(imagePath);
  const total = stat.size;
  if (Number.isFinite(driveMeta.sizeBytes) && driveMeta.sizeBytes > 0 && total > driveMeta.sizeBytes) {
    throw Object.assign(new Error(`镜像体积超出目标盘容量：image=${total}B, drive=${driveMeta.sizeBytes}B`), { code: FlashErrorCode.IMAGE_TOO_LARGE });
  }

  /** 与 rdkstudio_frontend FlashBehavior 一致：捆绑 dd+ls 时走 bat+runAs，不强制主进程管理员（UAC 在烧录时弹出） */
  const useFrontendFlash =
    hasFrontendFlashBundle() &&
    process.env.RDK_FLASH_WIN_CLASSIC !== '1' &&
    (process.env.RDK_FLASH_ENGINE || '').trim().toLowerCase() !== 'dotnet';

  const physicalForOps = drivePath.startsWith('/dev/') ? msysDeviceToPhysicalDrive(drivePath) : drivePath;

  if (useFrontendFlash) {
    const ofDevice = drivePath.startsWith('/dev/') ? drivePath : physicalDriveToMsysOf(normalizeWinPhysicalDrivePath(drivePathIn));
    if (!ofDevice) {
      throw Object.assign(new Error('无效的烧录目标（需要 /dev/sd* 或 PhysicalDrive）'), { code: FlashErrorCode.INVALID_PARAMS });
    }
    const diskNoFe = parsePhysicalDriveNumber(physicalForOps || drivePath);
    if (diskNoFe === null) {
      throw Object.assign(new Error('无法将目标映射为 PhysicalDrive，请刷新磁盘列表后重试'), { code: FlashErrorCode.INVALID_PARAMS });
    }

    activeOp = { id: crypto.randomUUID(), cancelled: false, child: null, cancelDd: null };
    let verifyFe = { ok: true, detail: '跳过校验' };

    try {
      emitFlashProgress({
        stage: 'prepare',
        message: '写盘引擎: RDK Studio 插件同款（dd + outer.bat + UAC runAs，与 rdkstudio_frontend 一致）…',
        percent: 2,
      });
      const { done, cancelDd } = startFrontendStyleDdFlash({
        imagePath,
        ofDevice,
        imageSizeBytes: total,
        isCancelled: () => !!activeOp?.cancelled,
        performanceProfile: options.performanceProfile,
      });
      activeOp.cancelDd = cancelDd;
      emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘（请在 UAC 中允许），请勿拔出介质', percent: 3 });
      await done;
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? e.code : '';
      if (activeOp?.cancelled || code === FlashErrorCode.USER_CANCELLED) {
        throw Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED });
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw Object.assign(new Error(msg), { code: FlashErrorCode.WRITE_FAILED });
    } finally {
      activeOp.cancelDd = null;
    }

    if (verifyMode === 'sample' && physicalForOps) {
      emitFlashProgress({ stage: 'verifying', message: '正在执行写后抽样校验', percent: 99 });
      verifyFe = await verifyImageSampleDotNet(imagePath, physicalForOps, total);
      if (!verifyFe.ok) throw Object.assign(new Error(verifyFe.detail), { code: FlashErrorCode.VERIFY_FAILED });
    }
    emitFlashProgress({ stage: 'done', message: '镜像写入完成', percent: 100 });
    activeOp = null;
    const onlineFe = await bringDiskOnlineBestEffort(diskNoFe);
    if (!onlineFe.ok) {
      emitFlashProgress({
        stage: 'prepare',
        message: `磁盘重新联机提示：${onlineFe.detail || '未知'}。若看不到 U 盘/SD，请重新插拔介质。`,
        percent: 2,
      });
    }
    return { output: `镜像已写入 ${ofDevice}`, verify: verifyFe };
  }

  const admin = await isAdmin();
  if (!admin) {
    throw Object.assign(
      new Error(
        '未检测到管理员提升权限（打包版若已「以管理员身份运行」仍提示此项，多为杀软拦截 PowerShell、或从压缩包直接运行导致未真正提升）。请：右键安装目录中的 RDK Studio.exe →「以管理员身份运行」；将安装目录加入 Windows 安全中心排除项；勿从 zip 内直接运行，先解压到本地磁盘后再试。',
      ),
      { code: FlashErrorCode.PERMISSION_DENIED },
    );
  }

  const diskNo = parsePhysicalDriveNumber(drivePath);
  if (diskNo === null) {
    throw Object.assign(new Error('无效的 Windows 物理磁盘路径'), { code: FlashErrorCode.INVALID_PARAMS });
  }

  activeOp = { id: crypto.randomUUID(), cancelled: false, child: null, cancelDd: null };
  let verify = { ok: true, detail: '跳过校验' };
  /** 仅在为写盘执行了 mountvol /N 时为 true，finally 中必须 /E */
  let autoMountDisabledByUs = false;

  try {
    emitFlashProgress({ stage: 'prepare', message: '正在卸载目标磁盘卷并移除盘符（与 Raspberry Pi Imager 一致）…', percent: 1 });
    try {
      await unmountPhysicalDriveVolumesRpiStyle(diskNo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw Object.assign(
        new Error(
          `无法卸载目标磁盘卷（可能被资源管理器、杀毒或正在访问该盘的程序占用）：${msg}。请关闭已打开的 U 盘/SD 窗口后重试，必要时重新插拔读卡器。`,
        ),
        { code: FlashErrorCode.WRITE_FAILED },
      );
    }

    if (process.env.RDK_FLASH_WIN_SKIP_DISK_CLEAN !== '1') {
      emitFlashProgress({
        stage: 'prepare',
        message: '正在清空分区表（diskpart clean，与 balena Etcher / etcher-sdk 一致）…',
        percent: 1,
      });
      try {
        await etcherStyleDiskpartClean(drivePath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw Object.assign(
          new Error(`无法清空目标磁盘分区表：${msg}。请以管理员运行并关闭占用该磁盘的程序后重试。`),
          { code: FlashErrorCode.WRITE_FAILED },
        );
      }
    }

    emitFlashProgress({ stage: 'prepare', message: '正在等待磁盘就绪（卸载后释放句柄）…', percent: 2 });
    await new Promise((r) => setTimeout(r, POST_UNMOUNT_SETTLE_MS));
    const am = await setWindowsAutoMountNewVolumes(false);
    autoMountDisabledByUs = am.ok;
    if (am.ok) {
      emitFlashProgress({
        stage: 'prepare',
        message: '已暂时禁用新卷自动挂载（降低写入中途被系统占用概率），完成后自动恢复…',
        percent: 2,
      });
    }
    /**
     * 经典回退：RDK_FLASH_ENGINE=dotnet 或未捆绑 dd+ls 时
     * - RDK_FLASH_WIN_FORCE_NODE=1：Node 直写
     * - 否则：PowerShell + .NET
     */
    const flashEngineEnv = (process.env.RDK_FLASH_ENGINE || '').trim().toLowerCase();
    const forceNode = process.env.RDK_FLASH_WIN_FORCE_NODE === '1';

    let handles = null;
    if (forceNode) {
      handles = await tryOpenWinNodeRawHandles(imagePath, drivePath);
    }

    const reassertNoAutoMount = setInterval(() => {
      void setWindowsAutoMountNewVolumes(false);
    }, AUTO_MOUNT_REASSERT_MS);
    let writeEngine = 'dotnet';

    try {
      if (handles) {
        writeEngine = 'node';
        emitFlashProgress({
          stage: 'prepare',
          message: '写盘引擎: Node 原生流式写入（RDK_FLASH_WIN_FORCE_NODE=1，与 macOS 同源）…',
          percent: 2,
        });
        await runWinNodeRawWriteWithHandles(handles.imageFh, handles.targetFh, ioPolicy.chunkBytes, total);
      } else {
        writeEngine = 'dotnet';
        emitFlashProgress({
          stage: 'prepare',
          message: forceNode
            ? '写盘引擎: PowerShell + .NET（Node 未能打开物理盘，已回退）…'
            : '写盘引擎: PowerShell + .NET（未使用插件同款 dd 时回退）…',
          percent: 2,
        });
        const { child, done } = startDotNetRawWrite(imagePath, drivePath, ioPolicy.chunkBytes);
        activeOp.child = child;
        emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘，请勿拔出介质', percent: 3 });
        await done;
      }
    } catch (e) {
      if (activeOp?.cancelled) {
        throw Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED });
      }
      const msg = e instanceof Error ? e.message : String(e);
      const formatted = writeEngine === 'dotnet' ? formatDotNetFlashWriteError(msg) : msg;
      throw Object.assign(new Error(formatted), { code: FlashErrorCode.WRITE_FAILED });
    } finally {
      clearInterval(reassertNoAutoMount);
    }
    if (verifyMode === 'sample') {
      emitFlashProgress({ stage: 'verifying', message: '正在执行写后抽样校验', percent: 99 });
      verify = await verifyImageSampleDotNet(imagePath, drivePath, total);
      if (!verify.ok) throw Object.assign(new Error(verify.detail), { code: FlashErrorCode.VERIFY_FAILED });
    }
    emitFlashProgress({ stage: 'done', message: '镜像写入完成', percent: 100 });
    return { output: `镜像已写入 ${drivePath}`, verify };
  } finally {
    activeOp.child = null;
    if (activeOp?.nodeRawHandles) {
      const h = activeOp.nodeRawHandles;
      activeOp.nodeRawHandles = null;
      try {
        void h.imageFh?.close();
        void h.targetFh?.close();
      } catch {
        /* ignore */
      }
    }
    if (autoMountDisabledByUs) {
      try {
        await setWindowsAutoMountNewVolumes(true);
      } catch {
        /* ignore */
      }
    }
    const online = await bringDiskOnlineBestEffort(diskNo);
    if (!online.ok) {
      emitFlashProgress({
        stage: 'prepare',
        message: `磁盘重新联机提示：${online.detail || '未知'}。若看不到 U 盘/SD，请重新插拔介质。`,
        percent: 2,
      });
    }
    activeOp = null;
  }
}

export async function verifyImage(imagePath, drivePathIn) {
  const raw = String(drivePathIn || '').trim();
  const drivePath = raw.startsWith('/dev/')
    ? msysDeviceToPhysicalDrive(raw)
    : normalizeWinPhysicalDrivePath(drivePathIn);
  if (!drivePath) {
    throw Object.assign(new Error('无效的磁盘路径'), { code: FlashErrorCode.INVALID_PARAMS });
  }
  const total = fs.statSync(imagePath).size;
  return verifyImageSampleDotNet(imagePath, drivePath, total);
}

export async function backupDrive(drivePathIn, destPath) {
  const raw = String(drivePathIn || '').trim();
  const drivePath = raw.startsWith('/dev/')
    ? msysDeviceToPhysicalDrive(raw)
    : normalizeWinPhysicalDrivePath(drivePathIn);
  if (!drivePath) {
    throw Object.assign(new Error('无效的磁盘路径'), { code: FlashErrorCode.INVALID_PARAMS });
  }
  const ioPolicy = resolveIoPolicy();
  const drives = await listDrives();
  const driveMeta = findDriveMetaInList(drives, drivePathIn);
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：仅允许备份可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });
  if (!driveMeta.sizeBytes || driveMeta.sizeBytes <= 0) throw Object.assign(new Error('无法获取磁盘容量，不能执行备份'), { code: FlashErrorCode.BACKUP_FAILED });

  const admin = await isAdmin();
  if (!admin) {
    throw Object.assign(
      new Error(
        '未检测到管理员提升权限。请右键 RDK Studio →「以管理员身份运行」后再试备份；若已提升仍失败，请将安装目录加入杀毒排除项。',
      ),
      { code: FlashErrorCode.PERMISSION_DENIED },
    );
  }

  const diskNo = parsePhysicalDriveNumber(drivePath);
  if (diskNo === null) {
    throw Object.assign(new Error('无效的 Windows 物理磁盘路径'), { code: FlashErrorCode.INVALID_PARAMS });
  }

  const outputPath = destPath?.trim() || buildDefaultBackupPath(drivePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  activeOp = { id: crypto.randomUUID(), cancelled: false, child: null };
  try {
    emitFlashProgress({ stage: 'backup', message: '正在卸载目标磁盘卷以释放占用…', percent: 1 });
    try {
      await prepareDiskForRawWrite(diskNo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw Object.assign(
        new Error(
          `无法卸载目标磁盘卷（可能被资源管理器或其它程序占用）：${msg}。请关闭相关窗口后重试。`,
        ),
        { code: FlashErrorCode.BACKUP_FAILED },
      );
    }

    emitFlashProgress({ stage: 'backup', message: '正在等待磁盘就绪…', percent: 1 });
    await new Promise((r) => setTimeout(r, POST_UNMOUNT_SETTLE_MS));
    const { child, done } = startDotNetRawBackup(drivePath, outputPath, driveMeta.sizeBytes, ioPolicy.chunkBytes);
    activeOp.child = child;
    emitFlashProgress({ stage: 'backup', message: '开始备份磁盘镜像', percent: 2 });
    try {
      await done;
    } catch (e) {
      if (activeOp?.cancelled) {
        throw Object.assign(new Error('用户取消备份'), { code: FlashErrorCode.USER_CANCELLED });
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw Object.assign(new Error(`备份失败：${msg}`), { code: FlashErrorCode.BACKUP_FAILED });
    }
    emitFlashProgress({ stage: 'done', message: '备份完成', percent: 100 });
    return { path: outputPath, bytes: driveMeta.sizeBytes };
  } finally {
    activeOp.child = null;
    const online = await bringDiskOnlineBestEffort(diskNo);
    if (!online.ok) {
      emitFlashProgress({
        stage: 'backup',
        message: `磁盘重新联机提示：${online.detail || '未知'}。若看不到该盘，请重新插拔介质。`,
        percent: 2,
      });
    }
    activeOp = null;
  }
}

export async function decompressXz(inputPath, outputPath) {
  if (!inputPath.toLowerCase().endsWith('.xz')) return inputPath;
  return new Promise((resolve, reject) => {
    emitFlashProgress({ stage: 'decompressing', message: '正在解压 xz 镜像', percent: 3 });
    const child = spawn(getPowerShellExe(), [
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
  if (!activeOp) return;
  activeOp.cancelled = true;
  if (typeof activeOp.cancelDd === 'function') {
    void activeOp.cancelDd();
  }
  if (activeOp.child) {
    try {
      activeOp.child.kill();
    } catch {
      /* ignore */
    }
  }
  if (activeOp.nodeRawHandles) {
    const h = activeOp.nodeRawHandles;
    activeOp.nodeRawHandles = null;
    try {
      void h.imageFh?.close();
      void h.targetFh?.close();
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
