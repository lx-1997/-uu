/**
 * S100 xburn 环境探测：与 Imager 主进程 CHECK_XBURN_S100_ENV 对齐。
 * 短跑 `-V info …` + 临时目录，25s 超时；区分「无设备扫描」与「产品配置损坏」。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { resolveMacS100XburnCliPath, resolveXburnCliPath } from './xburn-s100.mjs';

function xburnProbeConfigBroken(text) {
  if (!text || typeof text !== 'string') return false;
  if (/Product configuration file not found/i.test(text)) return true;
  if (/Valid product types are:\s*\[\s*\]/i.test(text)) return true;
  return false;
}

function xburnProbeLogLooksLikeDeviceWaitOnly(text) {
  if (!text || typeof text !== 'string' || text.length < 20) return false;
  if (xburnProbeConfigBroken(text)) return false;
  if (/DeviceScannerThread/i.test(text)) return true;
  if (/Scan ADB/i.test(text)) return true;
  if (/Scan\s+fastboot/i.test(text)) return true;
  if (/Wait for state ADB Mode timed out/i.test(text)) return true;
  if (/Executing\s+['']tools\/.*adb\.exe/i.test(text)) return true;
  return false;
}

/** Windows：未选手动路径时尝试 where + 常见安装目录，供主进程与探测共用 */
export function tryResolveWindowsXburnForProbe(xburnGuiPath) {
  const manual = String(xburnGuiPath || '').trim();
  if (manual) {
    try {
      return resolveXburnCliPath(manual);
    } catch {
      return null;
    }
  }
  try {
    const out = execSync('where xburn', { encoding: 'utf8', timeout: 10000, shell: true });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch {
    /* ignore */
  }
  const wellKnown = [
    path.join(process.env.LOCALAPPDATA || '', 'xburn-gui', 'xburn.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'xburn-gui', 'xburn.exe'),
    path.join(process.env.ProgramFiles || '', 'xburn-gui', 'xburn.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'xburn-gui', 'xburn.exe'),
  ];
  for (const exe of wellKnown) {
    if (exe.length > 12 && fs.existsSync(exe)) return exe;
  }
  return null;
}

async function resolveXburnExecutableForProbe(xburnGuiPath) {
  if (process.platform === 'darwin') {
    return resolveMacS100XburnCliPath(String(xburnGuiPath || '').trim());
  }
  if (process.platform === 'win32') {
    return tryResolveWindowsXburnForProbe(xburnGuiPath);
  }
  return null;
}

/**
 * @param {{ xburnGuiPath?: string }} opts
 * @returns {Promise<{
 *   ok: boolean;
 *   xburnPath: string | null;
 *   checks: Array<{ id?: string; pass?: boolean; scenario?: string; message?: string }>;
 *   rawLog: string;
 *   exitCode: number | null;
 *   timedOut: boolean;
 * }>}
 */
export async function checkS100XburnEnv(opts = {}) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return {
      ok: false,
      xburnPath: null,
      checks: [{ id: 'platform', pass: false, message: '当前平台不支持 S100 xburn 环境探测' }],
      rawLog: '',
      exitCode: null,
      timedOut: false,
    };
  }

  const xburnGuiPath = typeof opts.xburnGuiPath === 'string' ? opts.xburnGuiPath : '';
  const checks = [];
  const xburnPath = await resolveXburnExecutableForProbe(xburnGuiPath);

  if (!xburnPath) {
    checks.push({
      id: 'xburn_path',
      pass: false,
      scenario: process.platform === 'darwin' ? 'check_path_missing_darwin' : 'check_path_missing_win',
      message:
        process.platform === 'darwin'
          ? '未找到 xburn：请安装 xburn-gui（默认 /Applications）或确保终端中 which xburn 可用后重启 RDK Studio。'
          : '未在 PATH 中找到 xburn。请安装 xburn-gui，或将安装目录加入用户 Path 后重启 RDK Studio。',
    });
    return { ok: false, xburnPath: null, checks, rawLog: '', exitCode: null, timedOut: false };
  }

  checks.push({ id: 'xburn_path', pass: true, message: xburnPath });

  let tmpDir;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdk-xburn-check-'));
  } catch (e) {
    checks.push({ id: 'temp_dir', pass: false, message: `无法创建临时目录: ${e?.message || e}` });
    return { ok: false, xburnPath, checks, rawLog: '', exitCode: null, timedOut: false };
  }

  const args = [
    '-V',
    'info',
    '-p',
    'RDKS100',
    '-l',
    'usb',
    '-d',
    'fastboot',
    '--storage_type',
    'emmc',
    '--security_type',
    'secure',
    '-i',
    tmpDir,
    '--batch_num',
    '1',
    '--reboot',
  ];

  const probeMs = 25000;
  let logText = '';
  let timedOut = false;

  const closeInfo = await new Promise((resolve) => {
    const platform = process.platform;
    const shell = platform === 'win32';
    const xburnCwd = path.dirname(xburnPath);
    const child = spawn(xburnPath, args, {
      shell,
      windowsHide: true,
      cwd: fs.existsSync(xburnCwd) ? xburnCwd : undefined,
    });
    const append = (d) => {
      const s = d.toString();
      logText += s;
      if (logText.length > 180000) logText = logText.slice(-180000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    let timer;
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(payload);
    };
    child.on('error', (err) => {
      finish({ code: -1, signal: null, err: err?.message || String(err) });
    });
    child.on('close', (code, signal) => {
      finish({ code, signal, err: null });
    });
    timer = setTimeout(() => {
      timedOut = true;
      try {
        if (platform === 'win32' && child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        /* ignore */
      }
    }, probeMs);
  });

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  if (closeInfo?.err) {
    checks.push({
      id: 'xburn_spawn',
      pass: false,
      message: `无法启动 xburn: ${closeInfo.err}`,
    });
    return {
      ok: false,
      xburnPath,
      checks,
      rawLog: logText.trim().slice(-4000),
      exitCode: closeInfo.code ?? null,
      timedOut,
    };
  }

  if (timedOut && !xburnProbeConfigBroken(logText)) {
    const deviceWaitOnly = xburnProbeLogLooksLikeDeviceWaitOnly(logText);
    checks.push({
      id: 'xburn_timeout',
      pass: deviceWaitOnly,
      message: deviceWaitOnly
        ? 'xburn 已运行并在扫描 USB（ADB/fastboot）；当前未检测到板卡或未进入对应模式，25s 探测已停止。无硬件时属正常，接板、进烧写模式后再烧写即可。'
        : 'xburn 探测在 25s 内未结束（可能等待设备或被安全软件拦截）。可重试或检查任务管理器；仍要继续烧写可在下一步确认。',
    });
    return {
      ok: deviceWaitOnly,
      xburnPath,
      checks,
      rawLog: logText.trim().slice(-4000),
      exitCode: closeInfo?.code ?? null,
      timedOut: true,
    };
  }

  if (xburnProbeConfigBroken(logText)) {
    checks.push({
      id: 'product_config',
      pass: false,
      message:
        '未加载 S100 产品配置（例如 Product configuration file not found / Valid product types 为空）。请重装官方 xburn-gui、确认安装目录完整、镜像路径尽量使用纯英文，并重启 RDK Studio。',
    });
    return {
      ok: false,
      xburnPath,
      checks,
      rawLog: logText.trim().slice(-4000),
      exitCode: closeInfo?.code ?? null,
      timedOut,
    };
  }

  if (closeInfo?.code !== 0 && closeInfo?.code != null) {
    checks.push({
      id: 'xburn_exit',
      pass: true,
      message: `探测进程退出码 ${closeInfo.code}（常见于未连接 fastboot 设备等，产品配置已能加载时可继续尝试烧写）。`,
    });
  } else {
    checks.push({
      id: 'product_config',
      pass: true,
      message: '未发现产品配置缺失或支持列表为空；后续烧写仍取决于设备连接与镜像路径。',
    });
  }

  return {
    ok: true,
    xburnPath,
    checks,
    rawLog: logText.trim().slice(-2000),
    exitCode: closeInfo?.code ?? null,
    timedOut: false,
  };
}
