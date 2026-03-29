/**
 * S100 one-click flash: xburn CLI over USB + fastboot (eMMC).
 * Windows + macOS. See product spec for argument semantics.
 *
 * macOS：主进程前置（s100-prereq-mac）会检查 adb/fastboot/dfu-util；提权与 Imager FlashMac 一致：`sudo --askpass`
 * + **打包的 JXA**（`electron/resources/flash/darwin/sudo-askpass.osascript-*.js`，`displayDialog`/`hiddenAnswer` 输出密码到 stdout）。
 * `PATH` 从登录 shell（`/bin/zsh -lic`）取出后再前置 xburn 目录；不执行 adb reboot usb2。
 * Windows：`runAdbRebootUsb2` 与 Imager `FlashBehavior._rebootS100ToFastbootIfNeeded` 一致（渐进轮询 devices + reboot usb2 + 18s）。
 *
 * 日志判定与参考 Imager 渲染层 `FlashBehavior.js`（xburnLogIndicates* / xburnFormatFailureMessage）对齐，
 * 并保留 RDK 侧扩展：仅 fastboot 扫描早退检测、`Status: SUCCESS` 等新机型尾日志。
 */

import { spawn, execFile, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { emitFlashProgress } from './progress.mjs';
import { FlashErrorCode } from './types.mjs';

/** 与参考 `FlashBehavior.js` 中 XBURN_LOG_BUF_MAX 一致 */
const RING_MAX = 200_000;
const ADB_REBOOT_WAIT_MS = 18_000;

/** RDK S100 常见「disk」核心镜像；缺失时 xburn 常跳过写入却仍报 SUCCESS（假成功）。 */
const S100_CORE_DISK_BASENAMES = ['miniboot_flash.img', 'miniboot_emmc.img', 'emmc_disk.simg'];

/** 与 Imager `FlashBehavior.js` / `_rebootS100ToFastbootIfNeeded` 一致 */
const ADB_DEVICES_SOFT_DELAYS_MS = [200, 350, 500, 700, 950, 1250];
const ADB_DEVICES_HARD_DELAYS_MS = [400, 550, 700, 900, 1100, 1300, 1600, 1900, 2200, 2600, 3000];
const ADB_DEVICES_EXTRA_DELAYS_MS = [800, 1200, 1700, 2200, 2800, 3500];

let activeXburnChild = null;
let s100OpRunning = false;
let cancelRequested = false;

export function isS100XburnRunning() {
  return s100OpRunning;
}

export function resetS100XburnSession() {
  cancelRequested = false;
}

export function cancelS100XburnOp() {
  cancelRequested = true;
  killActiveXburnChild();
}

function killActiveXburnChild() {
  if (!activeXburnChild) return;
  try {
    if (process.platform === 'win32') {
      try {
        activeXburnChild.kill();
      } catch {
        /* ignore */
      }
      const killer = spawn('taskkill', ['/F', '/IM', 'xburn.exe', '/T'], { windowsHide: true });
      killer.unref();
    } else {
      activeXburnChild.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
  activeXburnChild = null;
}

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
      } else {
        resolve(String(stdout || ''));
      }
    });
  });
}

/** sh 单引号内可安全嵌入的转义（POSIX shell） */
function shSq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * 与 Imager FlashMac `getEnvCommand` 意图一致：从登录 shell 取 PATH，便于 sudo 子进程找到 brew 的 adb/fastboot。
 * 若 .zshrc 等污染 stdout，取「含路径分隔符的最长一行」；
 */
async function getMacLoginShellPath() {
  let raw = '';
  try {
    raw = await execFileAsync('/bin/zsh', ['-lic', 'command printf %s "$PATH"']);
  } catch {
    return process.env.PATH || '';
  }
  const cleaned = String(raw || '').replace(/\r/g, '').trim();
  if (!cleaned) return process.env.PATH || '';
  if (!cleaned.includes(path.delimiter)) {
    const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let best = '';
    for (const line of lines) {
      if ((line.includes(path.delimiter) || line.startsWith('/')) && line.length > best.length) best = line;
    }
    if (best) return best;
  }
  return cleaned;
}

/** 合并 PATH：xburn 目录优先，其次登录 shell PATH（不含重复首段时可略去去重，简单拼接即可满足 sudo -E） */
function mergeXburnMacPath(cliDir, loginPath) {
  const tail = process.env.PATH || '';
  const mid = String(loginPath || '').trim() || tail;
  return `${cliDir}${path.delimiter}${mid}`;
}

/**
 * 与 Imager `FlashBehavior._getAskPassScriptPath` 一致：打包内 `flash/darwin/sudo-askpass.osascript-<locale>.js`，退回 en。
 * 开发态：`electron/resources/flash/darwin`；安装包：`process.resourcesPath/flash/darwin`（extraResources）。
 */
function resolveFlashDarwinResourcesDir() {
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, 'flash', 'darwin')
    : '';
  if (packaged && fs.existsSync(packaged)) return packaged;
  const dev = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'flash', 'darwin');
  if (fs.existsSync(dev)) return dev;
  return '';
}

function getBundledSudoAskpassScriptPathOrThrow() {
  const base = resolveFlashDarwinResourcesDir();
  if (!base) {
    throw Object.assign(
      new Error(
        '未找到 flash/darwin 资源目录（sudo-askpass）。开发态请保留 electron/resources/flash/darwin；安装包请确认打包配置 extraResources。',
      ),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }
  let lang = 'en';
  try {
    lang = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2);
  } catch {
    /* ignore */
  }
  const pick = (lng) => {
    const p = path.join(base, `sudo-askpass.osascript-${lng}.js`);
    return fs.existsSync(p) ? p : '';
  };
  const resolved = pick(lang) || pick('en') || path.join(base, 'sudo-askpass.osascript-en.js');
  if (!resolved || !fs.existsSync(resolved)) {
    throw Object.assign(
      new Error(`内置 sudo 提权脚本缺失：${base}（需要 sudo-askpass.osascript-zh.js / en.js）`),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }
  return path.resolve(resolved);
}

/** 先弹 Studio 原生框，把应用拉到前台，减少密码窗被挡在后的情况 */
async function showMacSudoPasswordPreamble() {
  if (process.env.RDK_STUDIO_S100_SKIP_SUDO_PREAMBLE === '1') return;
  try {
    const { dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    await dialog.showMessageBox(win ?? undefined, {
      type: 'info',
      title: '需要管理员权限',
      message: '接下来将通过 sudo 运行 xburn。',
      detail:
        '请先点「好」。随后会出现**系统密码框**（由 AppleScript/osascript 提供），请输入你的**本机登录密码**。'
        + ' 若长时间无弹窗，请 ⌘Tab 切换窗口或暂时退出全屏，并检查是否本机在 /etc/sudoers 中对当前用户配置了 NOPASSWD。',
      buttons: ['好'],
      defaultId: 0,
      noLink: true,
    });
  } catch {
    /* 非 Electron 主进程时忽略 */
  }
}

/**
 * 单独执行 `sudo --askpass -v`：**强制**调用一次 SUDO_ASKPASS；仅 `sudo -k` + 直接 spawn 长命令时，部分环境下仍可能不弹窗却沿用票据。
 */
async function sudoAskpassValidateTicket(askPassExecutable, pathEnv) {
  if (process.env.RDK_STUDIO_S100_SKIP_SUDO_V === '1') return;
  const env = {
    ...process.env,
    PATH: pathEnv,
    SUDO_ASKPASS: askPassExecutable,
  };
  try {
    await execFileAsync('/usr/bin/sudo', ['--askpass', '-v'], {
      env,
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (e) {
    const hint = [e?.stderr, e?.stdout, e?.message].filter(Boolean).join('\n').trim();
    throw Object.assign(
      new Error(
        `sudo 认证未通过（可能关闭了密码框或密码错误）。请重试。\n${hint.slice(0, 800)}`,
      ),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }
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

async function extractZipToDir(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  if (process.platform === 'win32') {
    const z = zipPath.replace(/'/g, "''");
    const o = outDir.replace(/'/g, "''");
    await runPowerShell(`Expand-Archive -LiteralPath '${z}' -DestinationPath '${o}' -Force`);
    return;
  }
  try {
    await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', outDir]);
  } catch {
    await execFileAsync('ditto', ['-x', '-k', zipPath, outDir]);
  }
}

function xburnCliArgs(imageDir) {
  return [
    '-V', 'info',
    '-p', 'RDKS100',
    '-l', 'usb',
    '-d', 'fastboot',
    '--storage_type', 'emmc',
    '--security_type', 'secure',
    '-i', imageDir,
    '--batch_num', '1',
    '--reboot',
  ];
}

/** 与 spawn 使用的 argv 一致，供日志/UI 展示；各参数 JSON 编码便于路径含空格时复制到 shell。 */
function formatXburnArgvLine(cliPath, imageDir) {
  const argv = [cliPath, ...xburnCliArgs(imageDir)];
  return argv.map((a) => JSON.stringify(String(a))).join(' ');
}

function isPathAllAscii(p) {
  for (let i = 0; i < p.length; i += 1) {
    if (p.charCodeAt(i) > 127) return false;
  }
  return true;
}

async function getWindowsShortPath(longPath) {
  try {
    const p = longPath.replace(/'/g, "''");
    const out = await runPowerShell(
      `$p = '${p}'; if (Test-Path -LiteralPath $p) { (New-Object -ComObject Scripting.FileSystemObject).GetFolder($p).ShortPath } else { '' }`,
    );
    const s = String(out || '').trim();
    return s || null;
  } catch {
    return null;
  }
}

async function ensureAsciiImagePath(imageRoot, stagingBase) {
  if (isPathAllAscii(imageRoot)) {
    return { imageDir: imageRoot, cleanupRoots: [] };
  }
  if (process.platform === 'win32') {
    const short = await getWindowsShortPath(imageRoot);
    if (short && isPathAllAscii(short)) {
      try {
        const resolved = path.resolve(short);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          return { imageDir: resolved, cleanupRoots: [] };
        }
      } catch {
        /* fall through */
      }
    }
  }
  const stagedRoot = path.join(stagingBase, 'rdk-s100-stage', `copy-${Date.now()}`);
  const dest = path.join(stagedRoot, 'image');
  fs.mkdirSync(dest, { recursive: true });
  emitFlashProgress({ stage: 'preparing', message: '路径含非 ASCII，正在复制到临时英文目录（大镜像可能较慢）…', percent: 2 });
  fs.cpSync(imageRoot, dest, { recursive: true });
  return { imageDir: dest, cleanupRoots: [stagedRoot] };
}

/** 返回 dir 下 product 子目录的绝对路径；无则 null（名称大小写不敏感） */
function getProductChildPath(dir) {
  try {
    const direct = path.join(dir, 'product');
    if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return path.resolve(direct);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return null;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      if (name.toLowerCase() !== 'product') continue;
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).isDirectory()) return path.resolve(p);
      } catch {
        /* continue */
      }
    }
    return null;
  } catch {
    return null;
  }
}

function hasProductDir(dir) {
  return getProductChildPath(dir) != null;
}

/**
 * 是否包含名为 disk 的子目录（大小写不敏感，兼容部分解压包为 Disk/DISK）。
 * 启发式：多数 S100 包在「镜像根/disk/」下放 emmc 等镜像；与 xburn-gui「自动往下找」不是同一套逻辑——GUI 可能多轮扫描，CLI 只认一个 `-i`。
 */
function hasDiskDir(dir) {
  try {
    const names = fs.readdirSync(dir);
    for (const name of names) {
      if (name.startsWith('.')) continue;
      if (name.toLowerCase() !== 'disk') continue;
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).isDirectory()) return true;
      } catch {
        /* continue */
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 将用户所选目录解析为 xburn CLI 使用的镜像根（`-i`）。
 *
 * 与 **xburn-gui** 的差异：图形界面常会在子树里多路径尝试；我们传的是**单个** `-i`，只能靠目录约定对齐。
 * 常见包：`<某层>/disk/*.img`（镜像根 = 含 `disk` 的那一层）；若只选到更外层且下面有 `product/disk`，会落到 `product`。
 * 若某项目没有 `disk` 目录、镜像放在别处，请以「实际烧写命令」里的 `-i` 为准，在访达里对照该层目录是否就是你在 GUI 里等价选择的那一层。
 */
function normalizeS100ImageDirForCli(absDir) {
  const abs = path.resolve(absDir);
  try {
    if (hasDiskDir(abs)) return abs;

    const prodChild = getProductChildPath(abs);
    if (prodChild && hasDiskDir(prodChild)) return prodChild;

    if (hasProductDir(abs)) return abs;

    let entries;
    try {
      entries = fs.readdirSync(abs).filter((n) => !n.startsWith('.'));
    } catch {
      return abs;
    }
    const subs = entries
      .map((n) => path.join(abs, n))
      .filter((p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
    if (subs.length === 1 && hasProductDir(subs[0])) {
      return normalizeS100ImageDirForCli(subs[0]);
    }
    const withProduct = subs.filter((p) => hasProductDir(p));
    if (withProduct.length === 1) {
      return normalizeS100ImageDirForCli(withProduct[0]);
    }
  } catch {
    /* ignore */
  }
  return abs;
}

/**
 * 日志中 xburn 报找不到核心镜像 → 视为假成功风险，**不**承认烧录成功。
 */
function xburnLogIndicatesMissingCoreDiskImages(text) {
  const t = String(text || '');
  if (!/cannot\s+find/i.test(t)) return false;
  return S100_CORE_DISK_BASENAMES.some((name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`cannot\\s+find[^\\n]*${esc}`, 'i').test(t);
  });
}

/** 与参考 Studio 一致：可选解压目录或 product.zip */
export function validateS100ImagePick(absPath) {
  const p = String(absPath || '').trim();
  if (!p) return { ok: false, error: '未选择路径' };
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return { ok: false, error: '无法访问所选路径' };
  }
  if (st.isDirectory()) return { ok: true };
  if (st.isFile() && p.toLowerCase().endsWith('.zip')) return { ok: true };
  return { ok: false, error: '请选择固件文件夹或 .zip（如 product.zip）' };
}

/** @deprecated 使用 validateS100ImagePick */
export const validateS100FirmwareFolderPick = validateS100ImagePick;

/** 与参考 Studio 一致：系统自带路径优先 */
export const MAC_STD_XBURN_CLI = '/Applications/xburn-gui.app/Contents/MacOS/xburn';

function macUserAppsXburnCli() {
  return path.join(os.homedir(), 'Applications', 'xburn-gui.app', 'Contents', 'MacOS', 'xburn');
}

/** 同步探测：/Applications 与 ~/Applications 下的 xburn CLI 是否存在 */
export function macXburnCliExistsSync() {
  if (fs.existsSync(MAC_STD_XBURN_CLI)) return true;
  if (fs.existsSync(macUserAppsXburnCli())) return true;
  return false;
}

/** 在登录 shell 环境中执行 `command -v xburn`（覆盖 Homebrew 等 PATH） */
export async function whichMacXburnCli() {
  try {
    const out = await execFileAsync('/bin/zsh', ['-lic', 'command -v xburn']);
    const line = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() || '';
    if (!line) return '';
    if (fs.existsSync(line)) return path.resolve(line);
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * macOS：未传路径时依次尝试 /Applications、~/Applications、PATH 中的 xburn；
 * 若用户显式传入 .app 或二进制路径，仍走原有解析（可抛错）。
 * @param {string} pickedGuiPath
 * @returns {Promise<string | null>}
 */
export async function resolveMacS100XburnCliPath(pickedGuiPath) {
  const manual = String(pickedGuiPath || '').trim();
  if (manual) {
    return resolveXburnCliPath(manual);
  }
  if (fs.existsSync(MAC_STD_XBURN_CLI)) return MAC_STD_XBURN_CLI;
  const userCli = macUserAppsXburnCli();
  if (fs.existsSync(userCli)) return userCli;
  const w = await whichMacXburnCli();
  return w || null;
}

/** 由用户选择的 xburn-gui / xburn 路径解析出可执行的 xburn CLI（Windows / macOS） */
export function resolveXburnCliPath(pickedGuiPath) {
  const p = path.resolve(String(pickedGuiPath || '').trim());
  if (!p) {
    throw Object.assign(new Error('未指定 xburn 路径'), { code: FlashErrorCode.INVALID_PARAMS });
  }
  if (process.platform === 'win32') {
    const dir = path.dirname(p);
    const candidates = [path.join(dir, 'xburn.exe'), path.join(dir, 'Xburn.exe')];
    if (p.toLowerCase().endsWith('.exe')) {
      const base = path.basename(p).toLowerCase();
      if (base === 'xburn.exe' && fs.existsSync(p)) return p;
      for (const c of candidates) {
        if (fs.existsSync(c)) return path.resolve(c);
      }
    }
    for (const c of candidates) {
      if (fs.existsSync(c)) return path.resolve(c);
    }
    throw Object.assign(
      new Error('未在 xburn-gui 同目录找到 xburn.exe，请安装官方 xburn-gui 或手动选择 xburn.exe'),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }
  if (process.platform === 'darwin') {
    if (p.endsWith('.app') && fs.existsSync(p)) {
      const cli = path.join(p, 'Contents/MacOS/xburn');
      if (fs.existsSync(cli)) return cli;
    }
    if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) {
      return p;
    }
    throw Object.assign(new Error('请选择 xburn-gui.app，或可直接执行的 xburn 文件'), { code: FlashErrorCode.TOOL_MISSING });
  }
  throw Object.assign(new Error('当前系统不支持 S100 一键烧写'), { code: FlashErrorCode.UNSUPPORTED_PLATFORM });
}

function appendRing(ringRef, chunk) {
  ringRef.buf += chunk;
  if (ringRef.buf.length > RING_MAX) {
    ringRef.buf = ringRef.buf.slice(-RING_MAX);
  }
}

/** 与参考 Imager `FlashBehavior.js` 一致：用尾部日志判定「是否算烧完 / 是否算失败」 */
const XBURN_LOG_TAIL = 20_000;

function xburnLogTail(text) {
  const t = String(text || '');
  if (t.length <= XBURN_LOG_TAIL) return t;
  return t.slice(-XBURN_LOG_TAIL);
}

/**
 * xburn 仅多轮 Scan fastboot 后 exit 0、从未进入 Burn 线程 / 无写盘尾日志——不应视为烧写成功（即使设了 LOOSE_XBURN）。
 */
function isProbablyScanOnlyEarlyExit(text) {
  const t = String(text || '');
  if (!/Scan\s+fastboot\s+\[\d+\]round/i.test(t)) return false;
  if (/\[Burn thread/i.test(t)) return false;
  if (
    /S100FastbootBurn:|Status:\s*SUCCESS|check_burn_result|Sending\s+sparse|\bburn progress\s+100/i.test(t)
  ) {
    return false;
  }
  /**
   * 「Rebooting … OKAY」仅为 fastboot 对 reboot 指令的应答，不能代表镜像已烧完；
   * 若整段尾部只有扫描 + 该应答，仍应按「仅扫描/未完成」收敛（由 analyzeXburnOutcome 提示）。
   */
  return true;
}

/**
 * S100 xburn：进度 100% + Status: SUCCESS + fastboot_all（不含 Process terminated 行）。
 */
function hasS100XburnBoardSuccessTriplet(text) {
  const t = String(text || '');
  const progress100 =
    /\bburn\s+progress\s+100(?:\.0+)?\s*%/i.test(t)
    || /\[PROGRESS\][^\n]*\b100(?:\.0+)?\s*%/i.test(t);
  const statusSuccess = /\bStatus:\s*SUCCESS\b/i.test(t);
  const fastbootAll = /S100FastbootBurn:\s*fastboot_all\b/i.test(t);
  return progress100 && statusSuccess && fastbootAll;
}

/**
 * 第④条「进程/流程已收尾」：**多数** xburn 会打 `Process terminated, exit code: 0`，CLI 版本常不写该句；
 * 以 **`check_burn_result` 步骤成功** 视为同等依据（与工具内部顺序一致）。
 */
function hasS100XburnCliTailCompletionEvidence(text) {
  const t = String(text || '');
  if (
    /Process\s+terminated\s*,\s*exit\s+code\s*:\s*0\b/i.test(t)
    || /Process\s+terminated\s+with\s+exit\s+code\s+0\b/i.test(t)
  ) {
    return true;
  }
  return (
    /Step\s+['"]check_burn_result['"]\s+completed\s+successfully/i.test(t)
    || /check_burn_result[^\n]*completed\s+successfully/i.test(t)
  );
}

/**
 * 强完成依据（completedBurnEvidence）：①②③ 三要素 + ④ 上列收尾（Process terminated **或** check_burn_result 完成）。
 */
function hasS100XburnCliStrictSuccessEvidence(text) {
  if (!hasS100XburnBoardSuccessTriplet(text)) return false;
  return hasS100XburnCliTailCompletionEvidence(text);
}

/** 整段日志内最后一组 sparse 分片是否已全部发出（与 Imager 一致用全量 ring，避免 tail 截断丢最后一包） */
function xburnSparseFullySentInLog(text) {
  const t = String(text || '');
  const slice = t.length > 120_000 ? t.slice(-120_000) : t;
  const sparseRe = /Sending\s+sparse[^\n]*?\b(\d+)\s*\/\s*(\d+)\b/gi;
  let lastCur = 0;
  let lastTot = 0;
  let m;
  while ((m = sparseRe.exec(slice)) !== null) {
    lastCur = parseInt(m[1], 10);
    lastTot = parseInt(m[2], 10);
  }
  return lastTot > 0 && lastCur === lastTot;
}

/**
 * 最后一次「等 Fastboot/ADB 状态超时」前后若都 **没有** 写盘完成依据，则视为未真正写完（与 xburn 仍可能 exit 0 不矛盾）。
 * 用于 analyze：避免仅靠 `[Burn thread` + 0 退出误报成功。
 */
function xburnLastStateWaitTimeoutLacksBurnEvidence(text) {
  const full = String(text || '');
  const timeoutMarkers = [
    'Wait for state Fastboot Mode timed out',
    'Wait for state ADB Mode timed out',
  ];
  for (const marker of timeoutMarkers) {
    const li = full.lastIndexOf(marker);
    if (li < 0) continue;
    const before = full.slice(0, li);
    const after = full.slice(li + marker.length);
    const okBefore =
      hasS100XburnCliStrictSuccessEvidence(before)
      || hasS100XburnBoardSuccessTriplet(before)
      || xburnSparseFullySentInLog(before);
    const okAfter =
      hasS100XburnCliStrictSuccessEvidence(after)
      || hasS100XburnBoardSuccessTriplet(after)
      || xburnSparseFullySentInLog(after);
    if (!okBefore && !okAfter) return true;
  }
  return false;
}

/**
 * 烧写「强完成」：100% + Status: SUCCESS + fastboot_all +（Process terminated **或** check_burn_result 完成）；
 * 不做 sparse 单独兜底（避免误报）。
 */
function xburnLogIndicatesCompletedBurn(text) {
  if (!text || String(text).length < 12) return false;
  const full = String(text);
  const tail = xburnLogTail(full);
  if (/\[FATAL\]/i.test(tail)) return false;
  if (isProbablyScanOnlyEarlyExit(tail)) return false;
  if (xburnLogIndicatesMissingCoreDiskImages(full)) return false;

  if (!hasS100XburnCliStrictSuccessEvidence(full)) return false;

  if (xburnLastStateWaitTimeoutLacksBurnEvidence(full)) return false;

  /**
   * 日志以「Rebooting … OKAY」收尾时：必须在**最后一次**该应答之前已出现三要素或严格四要素。
   */
  if (/Rebooting\s+.*\bOKAY\b/i.test(full)) {
    let lastRebootStart = -1;
    const r = /Rebooting\s+[^\n]*\bOKAY\b/gi;
    let m;
    while ((m = r.exec(full)) !== null) lastRebootStart = m.index;
    if (lastRebootStart >= 0) {
      const beforeLastReboot = full.slice(0, lastRebootStart);
      const okBeforeReboot =
        hasS100XburnCliStrictSuccessEvidence(beforeLastReboot)
        || hasS100XburnBoardSuccessTriplet(beforeLastReboot)
        || xburnSparseFullySentInLog(beforeLastReboot);
      if (!okBeforeReboot) return false;
    }
  }

  return true;
}

/**
 * 从 xburn 日志解析 `-i` 镜像目录。
 * 注意：macOS 上 **「Run command:」行常为工具内部拼接**，可能与真实 argv 不一致；以 Mac 下写入日志文件头的
 * `[RDK Studio] 本进程传给 xburn…` 为准。
 */
function xburnExtractIPathFromLog(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  const line = lines.find((l) => /Run command:/i.test(l) && /xburn/i.test(l));
  if (!line) return null;
  const endMarker = ' --batch_num ';
  const idxSpaced = line.indexOf(' -i ');
  if (idxSpaced >= 0) {
    const after = line.slice(idxSpaced + 4);
    const end = after.indexOf(endMarker);
    if (end >= 0) {
      return after.slice(0, end).trim().replace(/^["']|["']$/g, '');
    }
  }
  /** 兼容 `-i/path`、`-i '/p a t h'` 等（部分版本日志无 ` -i ` 前后空格） */
  const m = line.match(/(?:^|\s)-i\s*(?:'([^']*)'|"([^"]*)"|(\S+))/);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  if (!raw) return null;
  const cut = raw.indexOf(' --');
  return (cut >= 0 ? raw.slice(0, cut) : raw).replace(/^["']|["']$/g, '');
}

/**
 * macOS：xburn 重定向日志里自带的「Run command」可能显示 bundle 默认路径，不代表 Node 实际传入的 argv。
 */
function writeMacXburnCliLogHeader(logPath, { imageDir, pickedImagePath, cliPath, argvLine }) {
  const absI = path.resolve(String(imageDir || ''));
  const picked = String(pickedImagePath || '').trim();
  const cmdLine = String(argvLine || '').trim() || formatXburnArgvLine(cliPath, imageDir);
  const lines = [
    '[RDK Studio] 本进程传给 xburn 的镜像目录（-i，绝对路径）。若与下方「Run command」不一致，以本行为准。',
    absI,
    '[RDK Studio] 实际烧写命令行（与 sudo 包装脚本内 argv 一致，可复制到终端核对）：',
    cmdLine,
    `xburn CLI: ${cliPath}`,
  ];
  if (picked && path.resolve(picked) !== absI) {
    lines.push(`您在应用中选择的原始路径: ${picked}`);
  }
  lines.push('', '--- xburn 输出 ---', '');
  fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
}

function xburnDiagnosePathFromLog(logText) {
  const configBroken =
    /Product configuration file not found/i.test(logText)
    || /Valid product types are:\s*\[\s*\]/i.test(logText);
  if (!configBroken) return '';
  const iPath = xburnExtractIPathFromLog(logText);
  const iPathLooksAsciiOnly =
    iPath && !/[^\x00-\x7F]/.test(iPath) && !/\uFFFD/.test(iPath);
  if (iPath && !iPathLooksAsciiOnly) {
    return '\n\n【路径】请使用纯英文目录存放镜像，或使用应用内自动复制到临时英文路径。';
  }
  return '\n\n【路径】路径已为英文仍失败时，请重装 xburn-gui 并重启 RDK Studio。';
}

function xburnDiagnoseDeviceConnectionFromLog(logText) {
  const t = logText || '';
  if (!/Scan ADB error|Scan fastboot error|Failed to get board uid|fastboot_burn.*failed/i.test(t)) {
    return '';
  }
  return (
    '\n\n【设备】未识别到可烧录设备。请检查数据线/接口、驱动、板子是否处于下载或 fastboot；可在终端执行 adb devices / fastboot devices 自检。'
  );
}

/**
 * 与 Imager `FlashBehavior.js` 中 `xburnLogIndicatesFailure` 对齐（短日志不单独判失败，交给退出码）。
 * 退出码为 0 时：**不**因泛化 `[ERROR]` 判失败——xburn 常对缺失的可选分区/镜像打印 ERROR 后仍以 0 退出。
 * `[FATAL]` 与产品配置类错误仍视为失败。
 */
function xburnLogIndicatesFailure(text, exitCode) {
  if (!text || text.length < 6) return false;
  if (/Product configuration file not found/i.test(text)) return true;
  if (/Unsupported product type/i.test(text)) return true;
  if (/Valid product types are:\s*\[\s*\]/i.test(text)) return true;
  if (/\[FATAL\]/i.test(text)) return true;
  const exitOk = exitCode === 0;
  if (exitOk && xburnLogIndicatesCompletedBurn(text)) return false;
  if (!exitOk && /\[ERROR\]/i.test(text)) return true;
  return false;
}

/** 与 FlashBehavior `xburnFormatFailureMessage` 一致：优先 ERROR/FATAL 行 + 路径/设备诊断 */
function xburnFormatFailureMessage(logText, exitCode) {
  const lines = String(logText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const errLines = lines.filter((l) => /\[(ERROR|FATAL)\]/i.test(l));
  const pick = errLines.length ? errLines.slice(-10) : lines.slice(-12);
  const detail = pick.join('\n').slice(0, 1600);
  const body = detail || String(logText || '').trim().slice(-900);
  const suffix =
    exitCode != null && exitCode !== 0
      ? `\n\n（进程退出码: ${exitCode}）`
      : '\n\n（进程退出码为 0，但日志判定为失败。）';
  return body + suffix + xburnDiagnosePathFromLog(logText) + xburnDiagnoseDeviceConnectionFromLog(logText);
}

/** 与 FlashBehavior `_extractProgressFromXburnLog`：sparse 进度与「最后一处百分比」取较大值 */
function parseProgressPercent(buf) {
  const text =
    buf && typeof buf === 'string' ? (buf.length > 48_000 ? buf.slice(-48_000) : buf) : '';
  if (!text) return 0;
  let fromSparse = 0;
  const reSparse = /Sending\s+sparse[^\n]*?\b(\d+)\s*\/\s*(\d+)\b/gi;
  let m;
  while ((m = reSparse.exec(text)) !== null) {
    const cur = parseInt(m[1], 10);
    const tot = parseInt(m[2], 10);
    if (tot > 0 && cur >= 0 && cur <= tot) {
      fromSparse = Math.max(fromSparse, Math.min(99, Math.floor((cur / tot) * 100)));
    }
  }
  let fromPct = 0;
  const allPct = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)];
  if (allPct.length) {
    const num = Math.floor(Number(allPct[allPct.length - 1][1]));
    if (!Number.isNaN(num)) {
      fromPct = Math.max(0, Math.min(100, num));
      fromPct = Math.min(99, fromPct);
    }
  }
  return Math.max(fromSparse, fromPct);
}

/**
 * 与 Imager `FlashBehavior.js` 的 `exit` 分支对齐：signal、非 0 退出、`xburnLogIndicatesFailure`。
 * **默认**：`xburnLogIndicatesCompletedBurn`（三要素 + 收尾句）为强依据；子进程 **exit 后** 本函数才运行——并非提前结束 xburn。
 * 可选镜像缺失的 `[ERROR]` 不因泛化规则误报失败。仅按退出码放行时设 `RDK_STUDIO_S100_LOOSE_XBURN=1`。
 *
 * @param {number | null | undefined} exitCode  与 `child_process` close 一致，勿随意改写
 * @param {NodeJS.Signals | null} signal
 * @param {string} ringBuf
 */
function analyzeXburnOutcome(exitCode, signal, ringBuf) {
  if (signal && (exitCode == null || exitCode === undefined)) {
    return { ok: false, reason: `烧写进程被终止 (${signal})` };
  }
  if (exitCode !== 0 && exitCode != null) {
    return { ok: false, reason: xburnFormatFailureMessage(ringBuf, exitCode) };
  }
  if (process.env.RDK_STUDIO_S100_ALLOW_MISSING_CORE_LOG !== '1' && xburnLogIndicatesMissingCoreDiskImages(ringBuf)) {
    const snippet = String(ringBuf || '')
      .split(/\r?\n/)
      .filter((l) => /cannot\s+find/i.test(l) && /miniboot|emmc_disk/i.test(l))
      .slice(-10)
      .join('\n')
      .slice(0, 1600);
    return {
      ok: false,
      reason: [
        '日志显示找不到 S100 **核心镜像**（见 Cannot find …miniboot_flash / miniboot_emmc / emmc_disk…）。',
        '工具会**跳过写入**却仍可能显示 SUCCESS / 进度 100%，属于 **假成功**：未真正刷入启动与系统，开机可能黑屏或无法进入系统。',
        '请换用**完整官方固件包**，确认所选目录下 **disk/** 内含 miniboot_flash.img、miniboot_emmc.img、emmc_disk.simg；完整烧录一般需数分钟，几秒结束多为未写入。',
        snippet ? `【相关日志】\n${snippet}` : '',
      ].filter(Boolean).join('\n\n'),
    };
  }
  if (xburnLogIndicatesFailure(ringBuf, exitCode)) {
    return { ok: false, reason: xburnFormatFailureMessage(ringBuf, exitCode ?? 0) };
  }
  if (isProbablyScanOnlyEarlyExit(ringBuf)) {
    return {
      ok: false,
      reason:
        'xburn 很快退出（退出码 0），但日志仅有多轮 fastboot 扫描，未见 Burn 线程写盘或 Status: SUCCESS 等完成标志。**这通常不是正常烧写结束**（多为未进 fastboot、线缆/口不稳定或工具提前退出）。请换线、直接进 fastboot 后重试，或用 xburn-gui 对照完整流程。',
    };
  }
  const loose = process.env.RDK_STUDIO_S100_LOOSE_XBURN === '1';
  const logCompleted = xburnLogIndicatesCompletedBurn(ringBuf);
  if (!loose && !logCompleted && xburnLastStateWaitTimeoutLacksBurnEvidence(ringBuf)) {
    return {
      ok: false,
      reason:
        '日志出现「Wait for state Fastboot/ADB Mode timed out」，且超时前后均未见写盘完成依据（强完成尾迹或 sparse 进度）。xburn 虽以退出码 0 结束，**不视为烧写已完成**（多为设备未稳定进入 fastboot）。请先 `fastboot devices` 能看到设备后再烧写，或换线/USB 口、手动进 fastboot 后重试。',
    };
  }
  if (!loose && !logCompleted) {
    return {
      ok: false,
      reason:
        'xburn **进程已退出**（退出码 0），但日志未满足强完成条件：① burn progress 100%；② Status: SUCCESS；③ S100FastbootBurn: fastboot_all；④ Process terminated exit 0 **或** Step \'check_burn_result\' completed successfully。请对照完整日志或重试。若仅想按退出码判断成功，可设 RDK_STUDIO_S100_LOOSE_XBURN=1。',
    };
  }
  return { ok: true, reason: '', completedBurnEvidence: logCompleted };
}

/** 结束只推一条进度，避免与 Flasher 总结重复、且前后文案自相矛盾 */
function emitXburnCliFinishedProgress(outcome) {
  const strong = outcome.completedBurnEvidence === true;
  const looseEnv = process.env.RDK_STUDIO_S100_LOOSE_XBURN === '1';
  const message = strong
    ? 'xburn 已结束（退出码 0）：日志已满足强完成条件（100%、Status SUCCESS、fastboot_all，且 Process terminated 或 check_burn_result 完成）。请稍候再在板端验证；设备可能仍在重启。'
    : looseEnv
      ? 'xburn 已结束（退出码 0，宽松模式）：未校验完成尾日志，请务必在板端确认是否刷写成功。'
      : 'xburn 已结束（退出码 0）：日志未匹配到固定「完成」句式，但进程已正常退出。**请勿仅凭此处判定已成功**，请在板端确认刷写结果。';
  emitFlashProgress({ stage: 'done', message, percent: 100 });
}

async function sleepCancellable(ms) {
  const step = 250;
  let left = ms;
  while (left > 0) {
    if (cancelRequested) {
      throw Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED });
    }
    await new Promise((r) => setTimeout(r, Math.min(step, left)));
    left -= step;
  }
}

/* ── Windows：adb devices 与 reboot usb2（对齐 FlashBehavior `_rebootS100ToFastbootIfNeeded`）── */

function normalizeAdbTextNewlines(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseAdbDevicesOnlineSerials(text) {
  const serials = [];
  if (!text || typeof text !== 'string') return serials;
  const norm = normalizeAdbTextNewlines(text);
  for (const line of norm.split('\n')) {
    let t = line.trim();
    if (!t) continue;
    if (/^List of devices attached$/i.test(t)) continue;
    if (/^List of devices attached\b/i.test(t)) {
      t = t.replace(/^List of devices attached\s*/i, '').trim();
      if (!t) continue;
    }
    const m = t.match(/^(\S+)\s+device\b(?:\s|$)/);
    if (m) serials.push(m[1]);
  }
  return serials;
}

function formatAdbDevicesSnippetForUser(text, maxLen = 4096) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = normalizeAdbTextNewlines(text).trim();
  if (!trimmed) return '（无输出）';
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

function adbDevicesTextHints(text) {
  const t = normalizeAdbTextNewlines(text || '');
  return {
    unauthorized: /\bunauthorized\b/i.test(t),
    offline: /\boffline\b/i.test(t),
    noPermissions: /\bno permissions\b/i.test(t),
  };
}

function adbDevicesOutputHasNoDeviceLines(text) {
  const norm = normalizeAdbTextNewlines(text || '');
  for (const line of norm.split('\n')) {
    let t = line.trim();
    if (!t) continue;
    if (/^List of devices attached$/i.test(t)) continue;
    if (/^List of devices attached\b/i.test(t)) {
      t = t.replace(/^List of devices attached\s*/i, '').trim();
      if (!t) continue;
    }
    if (/^\S+\s+\S+/.test(t)) return false;
  }
  return true;
}

function sleepMsWindows(ms) {
  if (process.platform !== 'win32' || !ms) return;
  const n = Math.min(Math.max(0, ms), 12_000);
  try {
    execSync(`powershell -NoProfile -Command "Start-Sleep -Milliseconds ${n}"`, {
      stdio: 'ignore',
      timeout: n + 8000,
      shell: true,
    });
  } catch {
    /* ignore */
  }
}

function execFileResultAdb(adbExe, args) {
  return new Promise((resolve) => {
    execFile(adbExe, args, { maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const o = normalizeAdbTextNewlines(String(stdout || ''));
      const e = normalizeAdbTextNewlines(String(stderr || ''));
      const combined = [o, e].filter(Boolean).join('\n');
      if (err) {
        const errno = err.errno;
        const isEnoent =
          err.code === 'ENOENT'
          || errno === -4058
          || errno === -2
          || /ENOENT/i.test(String(err.message || ''));
        if (isEnoent) {
          resolve({ combined, status: null, spawnError: 'adb_not_found' });
          return;
        }
        resolve({
          combined,
          status: typeof err.code === 'number' ? err.code : -1,
          spawnError: null,
        });
        return;
      }
      resolve({ combined, status: 0, spawnError: null });
    });
  });
}

function spawnErrorUserMessage(se) {
  if (se === 'adb_not_found') {
    return '无法执行 adb：未找到完整的 platform-tools（需同目录含 adb.exe 与 fastboot.exe）。请检查安装与用户 Path，或重启 RDK Studio。';
  }
  return `无法执行 adb：${se}。请检查 platform-tools 与 Path。`;
}

async function adbDevicesPollProgressiveWin(adbExe, initialSleepMs, delaysMs) {
  sleepMsWindows(initialSleepMs);
  let adbDevicesOutput = '';
  const maxAttempts = 1 + delaysMs.length;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (cancelRequested) {
      throw Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED });
    }
    const listRes = await execFileResultAdb(adbExe, ['devices']);
    if (listRes.spawnError) {
      return { spawnError: listRes.spawnError, adbDevicesOutput, onlineSerials: [] };
    }
    adbDevicesOutput = listRes.combined;
    if (listRes.status !== 0 && listRes.status != null) {
      return { exitStatus: listRes.status, adbDevicesOutput: listRes.combined, onlineSerials: [] };
    }
    const onlineSerials = parseAdbDevicesOnlineSerials(listRes.combined);
    if (onlineSerials.length > 0) {
      return { adbDevicesOutput: listRes.combined, onlineSerials };
    }
    if (!adbDevicesOutputHasNoDeviceLines(listRes.combined)) {
      return { adbDevicesOutput: listRes.combined, onlineSerials: [] };
    }
    if (attempt < delaysMs.length) {
      sleepMsWindows(delaysMs[attempt]);
    }
  }
  return { adbDevicesOutput, onlineSerials: [] };
}

/**
 * 仅 Windows：烧写前 `adb reboot usb2 -f`；失败则不启动 xburn（与 Imager 一致）。
 * macOS 不调用此函数。
 */
async function runAdbRebootUsb2(adbExePath) {
  if (process.platform !== 'win32') return;

  const adbExe = adbExePath && fs.existsSync(adbExePath) ? adbExePath : 'adb';
  emitFlashProgress({ stage: 'preparing', message: '检测 adb 设备（渐进轮询）…', percent: 4 });

  let onlineSerials = [];
  let adbDevicesOutput = '';

  let phase = await adbDevicesPollProgressiveWin(adbExe, 320, ADB_DEVICES_SOFT_DELAYS_MS);
  if (phase.spawnError) {
    throw Object.assign(new Error(spawnErrorUserMessage(phase.spawnError)), { code: FlashErrorCode.TOOL_MISSING });
  }
  if (phase.exitStatus != null) {
    const combined = phase.adbDevicesOutput || '';
    throw Object.assign(
      new Error(`adb devices 失败（退出码 ${phase.exitStatus}）。\n${formatAdbDevicesSnippetForUser(combined)}`),
      { code: FlashErrorCode.WRITE_FAILED },
    );
  }
  onlineSerials = phase.onlineSerials;
  adbDevicesOutput = phase.adbDevicesOutput;

  if (onlineSerials.length === 0 && adbDevicesOutputHasNoDeviceLines(adbDevicesOutput)) {
    phase = await adbDevicesPollProgressiveWin(adbExe, 2200, ADB_DEVICES_HARD_DELAYS_MS);
    if (phase.spawnError) {
      throw Object.assign(new Error(spawnErrorUserMessage(phase.spawnError)), { code: FlashErrorCode.TOOL_MISSING });
    }
    if (phase.exitStatus != null) {
      const combined = phase.adbDevicesOutput || '';
      throw Object.assign(
        new Error(`adb devices 失败（退出码 ${phase.exitStatus}）。\n${formatAdbDevicesSnippetForUser(combined)}`),
        { code: FlashErrorCode.WRITE_FAILED },
      );
    }
    onlineSerials = phase.onlineSerials;
    adbDevicesOutput = phase.adbDevicesOutput;
  }

  if (onlineSerials.length === 0 && adbDevicesOutputHasNoDeviceLines(adbDevicesOutput)) {
    phase = await adbDevicesPollProgressiveWin(adbExe, 900, ADB_DEVICES_EXTRA_DELAYS_MS);
    if (phase.spawnError) {
      throw Object.assign(new Error(spawnErrorUserMessage(phase.spawnError)), { code: FlashErrorCode.TOOL_MISSING });
    }
    if (phase.exitStatus != null) {
      const combined = phase.adbDevicesOutput || '';
      throw Object.assign(
        new Error(`adb devices 失败（退出码 ${phase.exitStatus}）。\n${formatAdbDevicesSnippetForUser(combined)}`),
        { code: FlashErrorCode.WRITE_FAILED },
      );
    }
    onlineSerials = phase.onlineSerials;
    adbDevicesOutput = phase.adbDevicesOutput;
  }

  const envSerial = (process.env.ANDROID_SERIAL || '').trim();
  let targetSerial = null;
  if (envSerial) {
    if (!onlineSerials.includes(envSerial)) {
      throw Object.assign(
        new Error(
          `已设置环境变量 ANDROID_SERIAL=${envSerial}，但 adb devices 中无对应在线设备。请连接设备或修正 ANDROID_SERIAL 后重试。`,
        ),
        { code: FlashErrorCode.INVALID_PARAMS },
      );
    }
    targetSerial = envSerial;
  } else if (onlineSerials.length === 0) {
    const snippet = formatAdbDevicesSnippetForUser(adbDevicesOutput);
    const hints = adbDevicesTextHints(adbDevicesOutput);
    let extra = '';
    if (hints.unauthorized) {
      extra =
        '\n\n检测到 unauthorized：请在设备上点「允许 USB 调试」，并勾选「始终允许使用这台计算机进行调试」。';
    } else if (hints.offline) {
      extra = '\n\n检测到 offline：请重新插拔数据线、换口或换线后重试。';
    } else if (hints.noPermissions) {
      extra = '\n\n检测到 no permissions：请检查驱动或 udev，或以可访问设备的身份运行 adb。';
    }
    const elevateHint =
      '\n\n【权限】尽量避免「以管理员身份」运行 RDK Studio；管理员与普通用户下 adb 用户目录不同，易导致终端已授权而此处仍无设备。';
    const adbPathFooter = adbExe && adbExe !== 'adb' ? `\n\n【adb 路径】${adbExe}` : '';
    throw Object.assign(
      new Error(
        '未检测到可用的 ADB 设备，无法执行 reboot usb2。请连接设备、打开 USB 调试并授权；若仅在 fastboot/下载模式，请先按文档进入可通信模式。'
          + extra
          + adbPathFooter
          + elevateHint
          + `\n\n【adb devices 摘要】\n${snippet}`,
      ),
      { code: FlashErrorCode.DEVICE_NOT_FOUND },
    );
  } else if (onlineSerials.length > 1) {
    throw Object.assign(
      new Error(
        `检测到多台 ADB 在线设备（${onlineSerials.join(', ')}）。请只保留一块目标板，或设置环境变量 ANDROID_SERIAL 为其中一台序列号后再烧写。`,
      ),
      { code: FlashErrorCode.INVALID_PARAMS },
    );
  } else {
    targetSerial = onlineSerials[0];
  }

  emitFlashProgress({ stage: 'preparing', message: `执行 adb 进入烧录模式 (${targetSerial})…`, percent: 6 });
  const rebootRes = await execFileResultAdb(adbExe, ['-s', targetSerial, 'shell', 'reboot', 'usb2', '-f']);
  const rebootText = rebootRes.combined.trim();
  if (rebootRes.spawnError) {
    throw Object.assign(
      new Error(
        `执行 adb shell reboot usb2 -f 失败：${spawnErrorUserMessage(rebootRes.spawnError)}${rebootText ? `\n${rebootText}` : ''}`,
      ),
      { code: FlashErrorCode.WRITE_FAILED },
    );
  }
  if (rebootRes.status !== 0 && rebootRes.status != null) {
    throw Object.assign(
      new Error(
        `adb shell reboot usb2 -f 失败（退出码 ${rebootRes.status}）。请确认设备已开启调试并授权本机，或手动进入 fastboot 后再烧写。${
          rebootText ? `\n${rebootText}` : ''
        }`,
      ),
      { code: FlashErrorCode.WRITE_FAILED },
    );
  }

  emitFlashProgress({ stage: 'preparing', message: '设备将重启进入烧录模式，等待枚举…', percent: 8 });
  await sleepCancellable(ADB_REBOOT_WAIT_MS);
}

function spawnXburn(cliPath, imageDir) {
  const bundleDir = path.dirname(cliPath);
  const workDir = path.resolve(imageDir);
  const args = xburnCliArgs(imageDir);
  const pathEnv = `${bundleDir}${path.delimiter}${process.env.PATH || ''}`;
  /** 与终端一致：保留 HOME/TMPDIR/ANDROID_* 等；PATH 前置 xburn 所在目录。 */
  const baseEnv = { ...process.env, PATH: pathEnv };

  /**
   * cwd 使用镜像根（与 -i 一致）。Windows / macOS 共用本函数：相对 cwd 解析与 xburn-gui 对齐；
   * 旧逻辑 cwd=bundleDir 易导致「找不到文件」。
   */
  return spawn(cliPath, args, {
    cwd: workDir,
    env: baseEnv,
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * macOS：与 Imager FlashMac 对齐 — `sudo --askpass` + 内置 JXA（`sudo-askpass.osascript-*.js`）+ `sudo -E`；
 * `PATH` 从登录 shell（`/bin/zsh -lic`）读取后再前置 xburn 目录。
 * 日志仍重定向到文件 + 主进程轮询，供 analyzeXburnOutcome 使用。
 */
async function runMacAdminPrivilegesXburnChild(cliPath, imageDir, stagingBase, cleanupList, flashPathInfo = {}) {
  const bundleDir = path.dirname(cliPath);
  const workDir = path.resolve(imageDir);
  const args = xburnCliArgs(imageDir);
  emitFlashProgress({
    stage: 'preparing',
    message: '正在读取登录 shell 的 PATH（与终端 / Imager 烧录一致）…',
    percent: 9,
  });
  const loginPath = await getMacLoginShellPath();
  const pathEnv = mergeXburnMacPath(bundleDir, loginPath);
  const baseEnv = { ...process.env, PATH: pathEnv };

  const runDir = path.join(stagingBase, 'rdk-s100-stage', `admin-xburn-${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });
  cleanupList.push(runDir);

  const logPath = path.join(runDir, 'xburn.log');
  const exitPath = path.join(runDir, 'xburn.exit');
  const uidPath = path.join(runDir, 'run-as-uid.txt');
  const wrapperPath = path.join(runDir, 'run-xburn.sh');
  const askPassPath = getBundledSudoAskpassScriptPathOrThrow();
  try {
    fs.chmodSync(askPassPath, 0o755);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(logPath);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(exitPath);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(uidPath);
  } catch {
    /* ignore */
  }

  const argvLineDisplay = formatXburnArgvLine(cliPath, imageDir);
  writeMacXburnCliLogHeader(logPath, {
    imageDir,
    pickedImagePath: flashPathInfo.pickedImagePath,
    cliPath,
    argvLine: argvLineDisplay,
  });
  emitFlashProgress({
    stage: 'preparing',
    message: `[S100] 实际烧写命令: ${argvLineDisplay}`,
    percent: 10,
  });

  const exportLines = [];
  for (const [k, v] of Object.entries(baseEnv)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    if (v === undefined || v === null) continue;
    const sv = String(v);
    if (/\n|\r/.test(sv)) continue;
    exportLines.push(`export ${k}=${shSq(sv)}`);
  }

  const argvLine = [shSq(cliPath), ...args.map((a) => shSq(a))].join(' ');
  const wrapperBody = [
    '#!/bin/sh',
    'set +e',
    `/usr/bin/id -u >${shSq(uidPath)} 2>&1`,
    `cd ${shSq(workDir)}`,
    ...exportLines,
    `${argvLine} >>${shSq(logPath)} 2>&1`,
    `echo $? > ${shSq(exitPath)}`,
    '',
  ].join('\n');
  fs.writeFileSync(wrapperPath, wrapperBody, { mode: 0o700 });

  const absWrapper = path.resolve(wrapperPath);

  /**
   * 清除本用户 sudo 时间戳；开发可设 RDK_STUDIO_S100_SKIP_SUDO_K=1。
   */
  if (process.env.RDK_STUDIO_S100_SKIP_SUDO_K !== '1') {
    try {
      await execFileAsync('/usr/bin/sudo', ['-k']);
    } catch {
      /* ignore */
    }
  }

  await showMacSudoPasswordPreamble();

  emitFlashProgress({
    stage: 'preparing',
    message: '正在请求 sudo 密码（将弹出系统对话框）…',
    percent: 9,
  });

  await sudoAskpassValidateTicket(askPassPath, pathEnv);

  emitFlashProgress({
    stage: 'preparing',
    message: '管理员权限已通过，正在启动 xburn…',
    percent: 10,
  });

  const ringRef = { buf: '' };
  let smoothPct = 0;
  let lastEmit = 0;
  let readPos = 0;
  let elevationBad = false;

  const appendFromLogChunk = (chunk) => {
    if (!chunk) return;
    appendRing(ringRef, chunk);
    const p = parseProgressPercent(ringRef.buf);
    smoothPct = Math.max(smoothPct, p);
    const now = Date.now();
    const lines = chunk.trim().split(/\r?\n/).filter(Boolean);
    const tailLine = (lines.length ? lines[lines.length - 1] : '').trim() || 'xburn…';
    if (smoothPct > lastEmit || now - lastEmit > 400) {
      lastEmit = now;
      emitFlashProgress({
        stage: 'flashing',
        message: tailLine.length > 200 ? `${tailLine.slice(0, 200)}…` : tailLine,
        percent: smoothPct,
      });
    }
  };

  const child = spawn('/usr/bin/sudo', ['--askpass', '-E', '/bin/sh', absWrapper], {
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: pathEnv,
      SUDO_ASKPASS: askPassPath,
    },
  });
  activeXburnChild = child;

  const readLogGrowth = () => {
    try {
      if (!elevationBad && fs.existsSync(uidPath)) {
        const u = fs.readFileSync(uidPath, 'utf8').trim();
        if (u !== '' && u !== '0') {
          elevationBad = true;
          emitFlashProgress({
            stage: 'flashing',
            message: `检测到未获得 root（uid=${u}），已中止。请在 sudo 弹出的密码框中输入本机登录密码；若未见弹窗可尝试退出全屏或使用 ⌘Tab 查找。`,
            percent: Math.max(smoothPct, 5),
          });
          try {
            child.kill('SIGTERM');
          } catch {
            /* ignore */
          }
          return;
        }
      }
    } catch {
      /* ignore */
    }
    try {
      if (!fs.existsSync(logPath)) return;
      const st = fs.statSync(logPath);
      if (st.size <= readPos) return;
      const fd = fs.openSync(logPath, 'r');
      try {
        const len = st.size - readPos;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, readPos);
        readPos = st.size;
        appendFromLogChunk(buf.toString('utf8'));
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  };

  const poll = setInterval(readLogGrowth, 350);

  return new Promise((resolve, reject) => {
    let stderrAcc = '';
    child.stderr?.on('data', (d) => { stderrAcc += d.toString(); });
    child.on('error', (err) => {
      clearInterval(poll);
      activeXburnChild = null;
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearInterval(poll);
      activeXburnChild = null;
      readLogGrowth();
      try {
        if (fs.existsSync(logPath)) {
          const rest = fs.readFileSync(logPath, 'utf8');
          if (rest.length >= readPos) {
            appendRing(ringRef, rest.slice(readPos));
            readPos = rest.length;
          }
        }
      } catch {
        /* ignore */
      }
      if (cancelRequested) {
        reject(Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED }));
        return;
      }
      if (elevationBad) {
        reject(
          Object.assign(
            new Error(
              '未获得 root 权限（uid≠0），已在启动阶段中止。请确认 sudo 密码正确；若未见密码框，请退出全屏、用 ⌘Tab 查找对话框，或确认是否对当前账户配置了 sudo NOPASSWD。',
            ),
            { code: FlashErrorCode.TOOL_MISSING, logTail: ringRef.buf.slice(-8000) },
          ),
        );
        return;
      }
      let xburnCode = null;
      try {
        if (fs.existsSync(exitPath)) {
          const t = fs.readFileSync(exitPath, 'utf8').trim();
          const n = Number.parseInt(t, 10);
          if (!Number.isNaN(n)) xburnCode = n;
        }
      } catch {
        /* ignore */
      }
      if (code !== 0 && code != null) {
        const hint = stderrAcc.trim() || `sudo 退出码 ${code}`;
        reject(
          Object.assign(
            new Error(
              `无法通过 sudo 提权运行 xburn（可能取消密码或口令错误）。${
                /not authorized|authentication|canceled user|user canceled|incorrect password|sorry|a password is required|-\s*128\b|–\s*128\b|no tty|Askpass/i.test(hint) ? '请重试并输入本机登录密码，或检查 SUDO_ASKPASS / 自动化权限。' : ''
              }\n${hint.slice(0, 1200)}`,
            ),
            { code: FlashErrorCode.TOOL_MISSING, logTail: ringRef.buf.slice(-8000) },
          ),
        );
        return;
      }
      if (xburnCode === null) {
        reject(
          Object.assign(
            new Error('未写入 xburn 退出码（exit 文件缺失），请重试或在「活动监视器」中确认是否仍有 xburn 进程'),
            { code: FlashErrorCode.WRITE_FAILED, logTail: ringRef.buf.slice(-8000) },
          ),
        );
        return;
      }
      let runAsUid = '';
      try {
        if (fs.existsSync(uidPath)) runAsUid = fs.readFileSync(uidPath, 'utf8').trim();
      } catch {
        /* ignore */
      }
      if (runAsUid !== '0') {
        reject(
          Object.assign(
            new Error(
              runAsUid === ''
                ? '无法确认是否已通过 sudo 提权（uid 文件缺失）。请重试并在密码框中输入本机登录密码。'
                : `未以 root 运行 xburn（记录 uid=${runAsUid}）。请确认 sudo 密码正确，且 wrapper 以 sudo -E 执行成功。`,
            ),
            { code: FlashErrorCode.TOOL_MISSING, logTail: ringRef.buf.slice(-8000) },
          ),
        );
        return;
      }
      const outcome = analyzeXburnOutcome(xburnCode, signal ?? null, ringRef.buf);
      if (!outcome.ok) {
        const err = new Error(outcome.reason || 'xburn 烧录失败');
        err.logTail = ringRef.buf.slice(-8000);
        reject(err);
        return;
      }
      emitXburnCliFinishedProgress(outcome);
      resolve({ completedBurnEvidence: outcome.completedBurnEvidence === true });
    });
  });
}

/** 与参考 Studio 前置链对齐的占位步骤（不在此执行易误判的 -h 探测，避免误报） */
async function probeXburnCliIfPossible(_cliPath) {
  emitFlashProgress({ stage: 'preparing', message: '检查 xburn 环境…', percent: 2 });
}

async function runXburnChild(cliPath, imageDir, stagingBase, cleanupList, flashPathInfo = {}) {
  if (process.platform === 'darwin') {
    return runMacAdminPrivilegesXburnChild(cliPath, imageDir, stagingBase, cleanupList, flashPathInfo);
  }

  const ringRef = { buf: '' };
  let smoothPct = 0;
  let lastEmit = 0;

  const argvLineDisplay = formatXburnArgvLine(cliPath, imageDir);
  emitFlashProgress({
    stage: 'preparing',
    message: `[S100] 实际烧写命令: ${argvLineDisplay}`,
    percent: 10,
  });

  const child = spawnXburn(cliPath, imageDir);
  activeXburnChild = child;

  return new Promise((resolve, reject) => {
    const onData = (d) => {
      const s = d.toString();
      appendRing(ringRef, s);
      const p = parseProgressPercent(ringRef.buf);
      smoothPct = Math.max(smoothPct, p);
      const now = Date.now();
      if (smoothPct > lastEmit || now - lastEmit > 400) {
        lastEmit = now;
        const tailLine = s.trim().split(/\r?\n/).filter(Boolean).pop() || 'xburn…';
        emitFlashProgress({
          stage: 'flashing',
          message: tailLine.length > 200 ? `${tailLine.slice(0, 200)}…` : tailLine,
          percent: smoothPct,
        });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => {
      activeXburnChild = null;
      reject(err);
    });
    child.on('close', (code, signal) => {
      activeXburnChild = null;
      if (cancelRequested) {
        reject(Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED }));
        return;
      }
      const outcome = analyzeXburnOutcome(code, signal ?? null, ringRef.buf);
      if (!outcome.ok) {
        const err = new Error(outcome.reason || 'xburn 烧录失败');
        err.logTail = ringRef.buf.slice(-8000);
        reject(err);
        return;
      }
      emitXburnCliFinishedProgress(outcome);
      resolve({ completedBurnEvidence: outcome.completedBurnEvidence === true });
    });
  });
}

async function cleanupDirs(dirs) {
  for (const d of dirs) {
    try {
      await fs.promises.rm(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {object} opts
 * @param {string} opts.xburnGuiPath
 * @param {string} opts.imagePath  固件目录或 product.zip；非 ASCII 路径会复制到临时英文目录
 * @param {boolean} [opts.skipAdbReboot]
 * @param {string} opts.stagingBase  userData 等可写根（用于临时复制）
 * @param {string} [opts.adbExePath]  Windows：adb.exe 绝对路径（与 fastboot 同目录）
 */
export async function runS100XburnFlash(opts) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    throw Object.assign(new Error('S100 一键烧写仅支持 Windows 与 macOS'), { code: FlashErrorCode.UNSUPPORTED_PLATFORM });
  }

  const stagingBase = (opts.stagingBase && String(opts.stagingBase).trim())
    || path.join(os.tmpdir(), 'rdk-studio-flash');
  const imagePath = String(opts.imagePath || '').trim();
  if (!imagePath) {
    throw Object.assign(new Error('缺少镜像路径'), { code: FlashErrorCode.INVALID_PARAMS });
  }

  resetS100XburnSession();
  s100OpRunning = true;
  const cleanupList = [];

  try {
    if (cancelRequested) {
      throw Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED });
    }

    let cliPath;
    if (process.platform === 'darwin') {
      const resolved = await resolveMacS100XburnCliPath(opts.xburnGuiPath ?? '');
      if (!resolved) {
        throw Object.assign(
          new Error(
            '未检测到 xburn：请将 xburn-gui 安装到「应用程序」或确保终端中 which xburn 可找到，然后重启 RDK Studio',
          ),
          { code: FlashErrorCode.TOOL_MISSING },
        );
      }
      cliPath = resolved;
    } else {
      cliPath = resolveXburnCliPath(opts.xburnGuiPath);
    }
    emitFlashProgress({ stage: 'preparing', message: `xburn: ${cliPath}`, percent: 1 });
    await probeXburnCliIfPossible(cliPath);

    let imageRoot;
    const lower = imagePath.toLowerCase();
    if (lower.endsWith('.zip')) {
      const zipStage = path.join(stagingBase, 'rdk-s100-stage', `zip-${Date.now()}`);
      cleanupList.push(zipStage);
      emitFlashProgress({ stage: 'decompressing', message: '正在解压 zip…', percent: 3 });
      await extractZipToDir(imagePath, zipStage);
      imageRoot = normalizeS100ImageDirForCli(zipStage);
    } else {
      const st = fs.statSync(imagePath);
      if (!st.isDirectory()) {
        throw Object.assign(
          new Error('S100 请选择固件文件夹或 product.zip，不支持单文件 .img'),
          { code: FlashErrorCode.INVALID_PARAMS },
        );
      }
      imageRoot = normalizeS100ImageDirForCli(imagePath);
    }

    if (cancelRequested) {
      throw Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED });
    }

    const { imageDir, cleanupRoots } = await ensureAsciiImagePath(imageRoot, stagingBase);
    cleanupList.push(...cleanupRoots);

    if (process.platform === 'win32' && !opts.skipAdbReboot) {
      const adbPath = typeof opts.adbExePath === 'string' ? opts.adbExePath.trim() : '';
      await runAdbRebootUsb2(adbPath || undefined);
    }

    if (cancelRequested) {
      throw Object.assign(new Error('用户取消'), { code: FlashErrorCode.USER_CANCELLED });
    }

    const absI = path.resolve(imageDir);
    const absIDisplay = absI.length > 96 ? `${absI.slice(0, 93)}…` : absI;
    emitFlashProgress({
      stage: 'preparing',
      message: `[S100] xburn 工作目录(cwd): ${absIDisplay}（与 -i 镜像根一致，相对路径解析更接近 xburn-gui）`,
      percent: 10,
    });
    const xburnMsg =
      process.platform === 'darwin'
        ? `启动 xburn（-i: ${absIDisplay}）；sudo --askpass 与 Imager 一致。完整 -i 已写入日志文件开头。`
        : `启动 xburn 命令行烧录（-i: ${absIDisplay}）…`;
    emitFlashProgress({ stage: 'flashing', message: xburnMsg, percent: 10 });
    const burnMeta = await runXburnChild(cliPath, imageDir, stagingBase, cleanupList, {
      pickedImagePath: imagePath,
    });

    await cleanupDirs(cleanupList);
    return burnMeta ?? { completedBurnEvidence: true };
  } catch (e) {
    await cleanupDirs(cleanupList);
    throw e;
  } finally {
    s100OpRunning = false;
    activeXburnChild = null;
  }
}
