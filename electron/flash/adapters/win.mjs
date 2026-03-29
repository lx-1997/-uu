/**
 * Windows flash adapter.
 *
 * TF 卡写盘：仅使用与 rdkstudio_frontend 一致的捆绑工具（`electron/resources/flash/win32/x64/` 下
 * dd.exe + ls.exe + msys 依赖，由 `npm run copy:win-flash` 或打包流程提供）。
 * 枚举与烧录见 `win-dd-flash.mjs`（bat + UAC runAs + dd）。
 * 备份 / 写后抽样校验仍用 PowerShell + .NET（读 raw 设备比 Node fs 更稳）。
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
import {
  hasFrontendFlashBundle,
  listUsbDevicesViaLs,
  msysDeviceToPhysicalDrive,
  physicalDriveToMsysOf,
  startFrontendStyleDdFlash,
} from '../win-dd-flash.mjs';

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
  /**
   * 常规模式：此前 64KB + PowerShell 每块 `ConvertTo-Json` 会占满 CPU，有效写速仅几十 KB/s。
   * 512KB 仍明显低于极速 1MB，一般读卡器可接受；若遇杀软拦截可再试环境变量或 turbo。
   */
  return { chunkBytes: 512 * 1024 };
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

/** 备份 / 校验脚本通过 stderr 输出 JSON 行进度 */
const FLASH_PROGRESS_PREFIX = 'RDK_FLASH_PROGRESS_JSON=';

/** 临时 meta 供 PowerShell 读路径与参数（备份、抽样校验）。 */
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

  if (!hasFrontendFlashBundle()) {
    throw Object.assign(
      new Error(
        '未找到 Windows 烧录工具（dd.exe、ls.exe 及 msys 依赖）。请在仓库根目录执行 npm run copy:win-flash（需已安装 Git for Windows），或手动复制到 electron/resources/flash/win32/x64/ 后重启应用。',
      ),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }

  const drives = await listDrives();
  const driveMeta = findDriveMetaInList(drives, drivePathIn);
  if (!driveMeta) throw Object.assign(new Error('未找到目标磁盘，请刷新后重试'), { code: FlashErrorCode.DEVICE_NOT_FOUND });
  if (!driveMeta.removable) throw Object.assign(new Error('安全策略阻止：目标磁盘不是可移动介质'), { code: FlashErrorCode.DEVICE_NOT_REMOVABLE });

  const stat = fs.statSync(imagePath);
  const total = stat.size;
  if (Number.isFinite(driveMeta.sizeBytes) && driveMeta.sizeBytes > 0 && total > driveMeta.sizeBytes) {
    throw Object.assign(new Error(`镜像体积超出目标盘容量：image=${total}B, drive=${driveMeta.sizeBytes}B`), { code: FlashErrorCode.IMAGE_TOO_LARGE });
  }

  /** 与 rdkstudio_frontend 一致：bat + UAC runAs + dd，主进程无需管理员 */
  const physicalForOps = drivePath.startsWith('/dev/') ? msysDeviceToPhysicalDrive(drivePath) : drivePath;
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
      message: '写盘引擎: dd + outer.bat + UAC runAs（与打包资源 flash/win32/x64 一致）…',
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
