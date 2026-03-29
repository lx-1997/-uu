/**
 * Windows flash adapter.
 *
 * 烧录（非 S100）：与 rdkstudio_frontend-master `FlashBehavior` / Imager 一致，使用 GNU dd
 *（`dd.exe if=… of=… bs=4M status=progress`）。备份/校验抽样仍用 .NET 流式读写。
 *
 * Every public method mirrors the adapter interface consumed by the
 * flash service — no Electron-specific imports here.
 */

import { spawn, execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { emitFlashProgress } from '../progress.mjs';
import { FlashErrorCode } from '../types.mjs';

let activeOp = null;

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
  /** 小块降低读卡器/杀毒在单次大块写入时 UnauthorizedAccess 的概率（64KB 较 128KB 更稳） */
  return { chunkBytes: 64 * 1024 };
}

/** 与 Imager FlashWindows 一致：优先打包内 `flash/win32/x64/dd.exe`，否则 Git/usr、PATH */
function resolveWindowsDdExe() {
  const env = String(process.env.RDK_DD_EXE || '').trim();
  if (env && fs.existsSync(env)) return env;

  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, 'flash', 'win32', 'x64', 'dd.exe')
    : '';
  if (packaged && fs.existsSync(packaged)) return packaged;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const dev = path.join(here, '..', '..', 'resources', 'flash', 'win32', 'x64', 'dd.exe');
  if (fs.existsSync(dev)) return path.resolve(dev);

  const gitDd = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'dd.exe');
  if (fs.existsSync(gitDd)) return gitDd;

  try {
    const w = execFileSync('where', ['dd'], { encoding: 'utf8', windowsHide: true });
    const first = String(w || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  } catch {
    /* ignore */
  }

  return '';
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
 * 卸载该盘上所有已分配盘符的卷，释放占用（对齐 macOS 上先 unmount 再写 raw）。
 * 不使用 Set-Disk -Offline：脱机后部分 USB/读卡器在 Node fs.open(\\.\PhysicalDriveN) 上会稳定 EIO，
 * 而 mac 仅卸载分区不「整盘脱机」，故表现正常。
 */
async function prepareDiskForRawWrite(diskNumber) {
  const script = `
function Dismount-DiskPartitions {
  param([int]$DiskN)
  Get-Partition -DiskNumber $DiskN -ErrorAction SilentlyContinue | ForEach-Object {
    $p = $_
    if ($p.DriveLetter) {
      try {
        Dismount-Volume -DriveLetter $p.DriveLetter -Confirm:$false -ErrorAction Stop
      } catch { }
    }
    foreach ($ap in @($p.AccessPaths)) {
      if ($ap -match '^\\\\\?\\Volume\{') {
        try { Dismount-Volume -Path $ap -ErrorAction SilentlyContinue } catch { }
      }
    }
  }
}
$ErrorActionPreference = 'Continue'
$n = ${Number(diskNumber)}
Dismount-DiskPartitions -DiskN $n
Start-Sleep -Milliseconds 500
Dismount-DiskPartitions -DiskN $n
Start-Sleep -Milliseconds 800
try { Update-Disk -Number $n -ErrorAction SilentlyContinue } catch { }
Start-Sleep -Milliseconds 600
`;
  await runPowerShell(script);
}

/** USB/读卡器在卸载卷后需再等一会儿，否则 CreateFile(\\.\PhysicalDriveN) 常短暂 EIO */
const POST_UNMOUNT_SETTLE_MS = 2200;

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

/** GNU dd `status=progress` 行解析（与旧版 Imager 逻辑一致） */
function parseDdCopiedBytes(line) {
  const s = String(line || '').trim();
  const m = s.match(/^(\d+)\s+bytes\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 与 rdkstudio_frontend-master FlashWindows 一致：`dd.exe if=… of=… bs=… status=progress`
 * GNU dd：`conv=fsync` 在退出前刷出输出文件，降低 U 盘/读卡器拔盘过早导致末尾未落盘的风险。
 * 返回 { child, done } 供取消时 kill。
 */
function startDdFlashWindows(imagePath, drivePath, totalBytes, performanceProfile) {
  const ddExe = resolveWindowsDdExe();
  if (!ddExe) {
    throw Object.assign(
      new Error(
        '未找到 dd.exe。请将官方 Imager 自带的 flash/win32/x64/dd.exe 放到 electron/resources/flash/win32/x64/，'
        + '或安装 Git for Windows，或设置环境变量 RDK_DD_EXE 指向 dd.exe。',
      ),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }

  const bs = performanceProfile === 'turbo' ? '8M' : '4M';
  const args = [
    `if=${imagePath}`,
    `of=${drivePath}`,
    `bs=${bs}`,
    'status=progress',
    'conv=fsync',
  ];

  const child = spawn(ddExe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrBuf = '';
  let stderrCarry = '';

  const flushLine = (line) => {
    const offset = parseDdCopiedBytes(line);
    if (offset === null || !totalBytes) return;
    const percent = Math.min(98, Math.max(3, Math.round((offset / totalBytes) * 96) + 2));
    emitFlashProgress({
      stage: 'flashing',
      message: `已写入 ${(offset / 1024 / 1024).toFixed(1)} MB / ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
      percent,
    });
  };

  const onChunk = (d) => {
    const chunk = d.toString();
    stderrBuf += chunk;
    const text = stderrCarry + chunk;
    const lines = text.split(/\r?\n/);
    stderrCarry = lines.pop() || '';
    for (const ln of lines) flushLine(ln);
  };

  child.stderr.on('data', onChunk);
  child.stdout.on('data', onChunk);

  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (stderrCarry.trim()) flushLine(stderrCarry.trim());
      /** 须在 code===0 之前判断：取消后 kill 极少数情况下子进程仍可能 0 退出 */
      if (activeOp?.cancelled) {
        reject(Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED }));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error((stderrBuf || `dd 退出码 ${code}`).trim()));
    });
  });

  return { child, done };
}

function formatDdFlashWriteError(stderrOrMessage) {
  const raw = String(stderrOrMessage || '').trim();
  if (!raw) return 'dd 烧录失败（无详细输出）';
  const short = raw.length > 900 ? `${raw.slice(0, 900)}…` : raw;
  return `dd 烧录失败：${short}`;
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
    while ($off -lt $total) {
      $need = [int][Math]::Min($buf.Length, $total - $off)
      $n = $src.Read($buf, 0, $need)
      if ($n -le 0) { break }
      $dst.Write($buf, 0, $n)
      $off += $n
      $line = '${FLASH_PROGRESS_PREFIX}' + (@{ offset = $off; total = $total } | ConvertTo-Json -Compress)
      [Console]::Error.WriteLine($line)
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

export async function writeImage(imagePath, drivePathIn, options = {}) {
  const drivePath = normalizeWinPhysicalDrivePath(drivePathIn);
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

  const diskNo = parsePhysicalDriveNumber(drivePath);
  if (diskNo === null) {
    throw Object.assign(new Error('无效的 Windows 物理磁盘路径'), { code: FlashErrorCode.INVALID_PARAMS });
  }

  activeOp = { id: crypto.randomUUID(), cancelled: false, child: null };
  let verify = { ok: true, detail: '跳过校验' };
  /** 仅在为写盘执行了 mountvol /N 时为 true，finally 中必须 /E */
  let autoMountDisabledByUs = false;

  try {
    emitFlashProgress({ stage: 'prepare', message: '正在卸载目标磁盘卷以释放占用…', percent: 1 });
    try {
      await prepareDiskForRawWrite(diskNo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw Object.assign(
        new Error(
          `无法卸载目标磁盘卷（可能被资源管理器、杀毒或正在访问该盘的程序占用）：${msg}。请关闭已打开的 U 盘/SD 窗口后重试，必要时重新插拔读卡器。`,
        ),
        { code: FlashErrorCode.WRITE_FAILED },
      );
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
    emitFlashProgress({
      stage: 'prepare',
      message: '写盘引擎: GNU dd（与 RDK Studio Imager / rdkstudio_frontend-master 一致）…',
      percent: 2,
    });
    const { child, done } = startDdFlashWindows(imagePath, drivePath, total, options.performanceProfile);
    activeOp.child = child;
    emitFlashProgress({ stage: 'flashing', message: '正在写入物理磁盘，请勿拔出介质', percent: 3 });
    try {
      await done;
    } catch (e) {
      if (activeOp?.cancelled) {
        throw Object.assign(new Error('用户取消写盘'), { code: FlashErrorCode.USER_CANCELLED });
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw Object.assign(
        new Error(formatDdFlashWriteError(msg)),
        { code: FlashErrorCode.WRITE_FAILED },
      );
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
  const drivePath = normalizeWinPhysicalDrivePath(drivePathIn);
  const total = fs.statSync(imagePath).size;
  return verifyImageSampleDotNet(imagePath, drivePath, total);
}

export async function backupDrive(drivePathIn, destPath) {
  const drivePath = normalizeWinPhysicalDrivePath(drivePathIn);
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
  if (activeOp.child) {
    try {
      activeOp.child.kill();
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
