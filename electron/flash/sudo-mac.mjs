/**
 * macOS：`sudo --askpass` + 打包的 JXA（flash/darwin/sudo-askpass.osascript-*.js），
 * 与 Imager FlashMac / TF 卡直接写盘共用。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlashErrorCode } from './types.mjs';

export function execFileAsync(cmd, args, opts = {}) {
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

/**
 * 与 Imager FlashMac `getEnvCommand` 一致：从登录 shell 取 PATH。
 */
export async function getMacLoginShellPath() {
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

export function resolveFlashDarwinResourcesDir() {
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, 'flash', 'darwin')
    : '';
  if (packaged && fs.existsSync(packaged)) return packaged;
  const dev = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'flash', 'darwin');
  if (fs.existsSync(dev)) return dev;
  return '';
}

export function getBundledSudoAskpassScriptPathOrThrow() {
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

/**
 * 先弹应用内提示框，减少密码窗被挡在后的情况。
 * @param {{ title?: string, message?: string, detail?: string }} opts
 */
export async function showMacSudoPasswordPreamble(opts = {}) {
  if (process.env.RDK_STUDIO_S100_SKIP_SUDO_PREAMBLE === '1') return;
  const title = opts.title ?? '需要管理员权限';
  const message = opts.message ?? '接下来将通过 sudo 运行 xburn。';
  const detail = opts.detail ?? (
    '请先点「好」。随后会出现**系统密码框**（由 AppleScript/osascript 提供），请输入你的**本机登录密码**。'
    + ' 若长时间无弹窗，请 ⌘Tab 切换窗口或暂时退出全屏，并检查是否本机在 /etc/sudoers 中对当前用户配置了 NOPASSWD。'
  );
  try {
    const { dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    await dialog.showMessageBox(win ?? undefined, {
      type: 'info',
      title,
      message,
      detail,
      buttons: ['好'],
      defaultId: 0,
      noLink: true,
    });
  } catch {
    /* 非 Electron 主进程时忽略 */
  }
}

/**
 * 执行 `sudo --askpass -v`，强制唤起一次 SUDO_ASKPASS。
 */
export async function sudoAskpassValidateTicket(askPassExecutable, pathEnv) {
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

export async function invalidateMacSudoTimestamp() {
  if (process.env.RDK_STUDIO_S100_SKIP_SUDO_K === '1') return;
  try {
    await execFileAsync('/usr/bin/sudo', ['-k']);
  } catch {
    /* ignore */
  }
}
