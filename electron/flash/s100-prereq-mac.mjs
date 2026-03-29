/**
 * macOS S100 前置链路（顺序与本次会话绑定，取消即中止）：
 * 1. 检查 adb / fastboot / dfu-util（PATH 临时附加上 Homebrew 常见目录，减轻「访达启动读不到 brew」）；
 *    若缺失则尝试 `brew install android-platform-tools dfu-util`，失败或不具备 brew 时再提示手动安装。
 * 2. 未检测到 xburn-cli 时下载官方 DMG 并装入 ~/Applications
 *
 * 注：当前 Mac 一键流程不执行 Windows 的 adb reboot usb2 与 18s 等待；需要进下载模式时请按官方文档操作。
 * 烧录阶段 xburn 使用 sudo -A + 登录 shell PATH（见 xburn-s100.mjs），与 Imager FlashMac 对齐。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { execFile } from 'node:child_process';
import { emitFlashProgress } from './progress.mjs';
import { FlashErrorCode } from './types.mjs';

/** 与前端 Flasher 设备表里 toolDmgUrl 保持一致 */
const DEFAULT_XBURN_DMG_URL =
  'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_universal.dmg';

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
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

/** Homebrew 常见路径优先于当前进程 PATH，便于 GUI 启动时仍能解析 brew 安装的 CLI */
function buildMacFlashAugmentedPath() {
  const raw = process.env.PATH || '';
  const extra = ['/opt/homebrew/bin', '/usr/local/bin'];
  const parts = [...extra, ...raw.split(path.delimiter).filter(Boolean)];
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.join(path.delimiter);
}

const REQUIRED_MAC_S100_CLI_TOOLS = ['adb', 'fastboot', 'dfu-util'];

/** @param {NodeJS.ProcessEnv} env */
async function listMissingMacS100CliTools(env) {
  const missing = [];
  for (const name of REQUIRED_MAC_S100_CLI_TOOLS) {
    try {
      await execFileAsync('/usr/bin/which', [name], { env });
    } catch {
      missing.push(name);
    }
  }
  return missing;
}

/** 固定路径优先，避免 GUI 进程下 `which brew` 不稳定。 */
function macBrewCandidatePaths() {
  return ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
}

/** @param {NodeJS.ProcessEnv} env */
async function resolveMacHomebrewExe(env) {
  for (const p of macBrewCandidatePaths()) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* continue */
    }
  }
  try {
    const out = await execFileAsync('/usr/bin/which', ['brew'], { env });
    const line = String(out || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (line && fs.existsSync(line)) return line;
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * @param {string} brewPath
 * @param {NodeJS.ProcessEnv} env
 */
async function tryBrewInstallAndroidPlatformToolsAndDfuUtil(brewPath, env) {
  const brewEnv = {
    ...env,
    HOMEBREW_NONINTERACTIVE: '1',
  };
  await execFileAsync(brewPath, ['install', 'android-platform-tools', 'dfu-util'], {
    env: brewEnv,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 900_000,
  });
}

function buildToolMissingUserMessage({ missingList, triedBrew, noBrew }) {
  const list = missingList.join('、');
  const head = noBrew
    ? `未在 PATH 中找到：${list}，且未检测到 Homebrew（/opt/homebrew、/usr/local 或 PATH 中的 brew）。`
    : triedBrew
      ? `未在 PATH 中找到：${list}。已尝试通过 Homebrew 自动安装仍未就绪。`
      : `未在 PATH 中找到：${list}。`;
  return [
    head,
    'S100 一键烧写（macOS）需要 adb、fastboot（android-platform-tools）与 dfu-util。',
    '请在终端执行：',
    '  brew update',
    '  brew install android-platform-tools',
    '  brew install dfu-util',
    '若从访达启动本应用，可能读不到 Homebrew 的 PATH；检测时已优先加入 /opt/homebrew/bin 与 /usr/local/bin。若已安装仍报错，请从终端启动应用或将工具所在目录加入 PATH。',
  ].join('\n');
}

/**
 * 若缺少任一则先尝试 brew 安装，仍缺则拒绝继续烧写（在 xburn 下载/安装之前执行）。
 */
export async function ensureMacS100FlashCliTools() {
  const pathAugmented = buildMacFlashAugmentedPath();
  const env = { ...process.env, PATH: pathAugmented };
  emitFlashProgress({ stage: 'preparing', message: '检查 adb、fastboot、dfu-util…', percent: 2 });
  let missing = await listMissingMacS100CliTools(env);
  if (missing.length === 0) return;

  const brewPath = await resolveMacHomebrewExe(env);
  let triedBrew = false;
  const noBrew = !brewPath;

  if (brewPath) {
    emitFlashProgress({
      stage: 'preparing',
      message: '缺少 adb/fastboot 或 dfu-util，正通过 Homebrew 安装（可能需要几分钟）…',
      percent: 3,
    });
    try {
      await tryBrewInstallAndroidPlatformToolsAndDfuUtil(brewPath, env);
      triedBrew = true;
    } catch (e) {
      triedBrew = true;
      const reason = e?.stderr || e?.stdout || e?.message || String(e);
      const tail = String(reason).trim().split(/\r?\n/).slice(-6).join('\n');
      emitFlashProgress({
        stage: 'preparing',
        message: `Homebrew 自动安装未成功${tail ? `：${tail.slice(0, 280)}` : ''}`,
        percent: 3,
      });
    }
    missing = await listMissingMacS100CliTools(env);
  }

  if (missing.length === 0) {
    emitFlashProgress({ stage: 'preparing', message: 'adb、fastboot、dfu-util 已就绪', percent: 4 });
    return;
  }

  const msg = buildToolMissingUserMessage({ missingList: missing, triedBrew, noBrew });
  throw Object.assign(new Error(msg), { code: FlashErrorCode.TOOL_MISSING });
}

function downloadFileWithRedirect(url, destPath, onProgress) {
  const client = url.startsWith('https://') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        resolve(downloadFileWithRedirect(next, destPath, onProgress));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载失败: HTTP ${res.statusCode || 'unknown'}`));
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let done = 0;
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const writer = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        done += chunk.length;
        if (onProgress) onProgress(done, total);
      });
      res.pipe(writer);
      writer.on('finish', () => {
        writer.close(() => resolve());
      });
      writer.on('error', reject);
    });
    req.on('error', reject);
  });
}

function collectAppBundles(dir, depth, acc) {
  if (depth > 4) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.toLowerCase().endsWith('.app')) acc.push(full);
      else collectAppBundles(full, depth + 1, acc);
    }
  }
}

/**
 * 若系统已有 xburn（/Applications、~/Applications、PATH）则立即返回；
 * 否则下载 DMG、挂载、将 xburn-gui.app 复制到 ~/Applications。
 *
 * @param {{ userData: string }} opts
 */
export async function ensureMacXburnGuiInstalled({ userData }) {
  const { macXburnCliExistsSync, whichMacXburnCli } = await import('./xburn-s100.mjs');
  if (macXburnCliExistsSync()) return;
  const w = await whichMacXburnCli();
  if (w) return;

  const cacheDir = path.join(userData, 'rdk-s100-cache');
  const dmgPath = path.join(cacheDir, 'xburn-gui_universal.dmg');
  const needDownload = !(fs.existsSync(dmgPath) && fs.statSync(dmgPath).size > 512 * 1024);

  if (needDownload) {
    emitFlashProgress({ stage: 'downloading', message: '正在下载 xburn-gui（macOS）…', percent: 8 });
    let lastPct = -1;
    await downloadFileWithRedirect(DEFAULT_XBURN_DMG_URL, dmgPath, (done, total) => {
      if (total > 0) {
        const pct = Math.min(35, 8 + Math.round((done / total) * 27));
        if (pct !== lastPct) {
          lastPct = pct;
          emitFlashProgress({
            stage: 'downloading',
            message: `下载 xburn-gui ${(done / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB`,
            percent: pct,
          });
        }
      }
    });
  }

  emitFlashProgress({ stage: 'preparing', message: '正在挂载 DMG 并安装 xburn-gui…', percent: 38 });
  let volumePath = '';
  try {
    const attachOut = await execFileAsync('hdiutil', ['attach', '-nobrowse', dmgPath]);
    const m = attachOut.match(/\/Volumes\/[^\t\r\n]+/);
    if (!m) {
      throw new Error('无法解析 DMG 挂载路径，请手动安装 xburn-gui');
    }
    volumePath = m[0].trim();
    const apps = [];
    collectAppBundles(volumePath, 0, apps);
    const xburnApp = apps.find((a) => /xburn-gui/i.test(path.basename(a))) || apps[0];
    if (!xburnApp) {
      throw new Error('DMG 内未找到 xburn-gui.app');
    }
    const userApps = path.join(os.homedir(), 'Applications');
    fs.mkdirSync(userApps, { recursive: true });
    const destApp = path.join(userApps, path.basename(xburnApp));
    emitFlashProgress({ stage: 'preparing', message: '正在复制到「应用程序」…', percent: 42 });
    await execFileAsync('ditto', ['-rsrc', xburnApp, destApp]);
  } finally {
    if (volumePath) {
      try {
        await execFileAsync('hdiutil', ['detach', volumePath, '-force']);
      } catch {
        /* ignore */
      }
    }
  }

  if (!macXburnCliExistsSync() && !(await whichMacXburnCli())) {
    throw Object.assign(
      new Error('自动安装 xburn-gui 后仍未检测到 xburn，请重启 RDK Studio 或将 xburn 加入 PATH'),
      { code: FlashErrorCode.TOOL_MISSING },
    );
  }
}
