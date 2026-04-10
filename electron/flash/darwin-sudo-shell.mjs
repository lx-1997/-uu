/**
 * macOS：以与烧录相同的 `sudo --askpass` + 打包 JXA 执行任意 `/bin/sh -c` 脚本。
 * Type-C 配网等与 xburn/dd 共用 sudo 时间戳。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  getBundledSudoAskpassScriptPathOrThrow,
  getMacLoginShellPath,
  showMacSudoPasswordPreamble,
  sudoAskpassValidateTicket,
} from './sudo-mac.mjs';

const execFileAsync = promisify(execFile);

/**
 * @param {string} shellCmd 传给 `/bin/sh -c` 的完整脚本（已由调用方保证无注入）
 * @param {{
 *   title?: string,
 *   message?: string,
 *   detail?: string,
 *   timeoutMs?: number,
 *   skipPreamble?: boolean,
 *   skipValidateTicket?: boolean,
 * }} opts skipValidateTicket：仅当已在本会话前置 sudo -v 时使用
 */
export async function runDarwinSudoAskpassShell(shellCmd, opts = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('runDarwinSudoAskpassShell 仅适用于 macOS');
  }
  const askPassPath = getBundledSudoAskpassScriptPathOrThrow();
  const pathEnv = await getMacLoginShellPath();
  if (!opts.skipPreamble) {
    await showMacSudoPasswordPreamble({
      title: opts.title ?? '需要管理员权限',
      message: opts.message ?? '将通过 sudo 执行系统网络或磁盘操作。',
      detail: opts.detail,
    });
  }
  if (!opts.skipValidateTicket) {
    await sudoAskpassValidateTicket(askPassPath, pathEnv);
  }
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const env = {
    ...process.env,
    PATH: pathEnv,
    SUDO_ASKPASS: askPassPath,
  };
  try {
    const stdout = await execFileAsync(
      '/usr/bin/sudo',
      ['--askpass', '-E', '/bin/sh', '-c', shellCmd],
      { env, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
    );
    return String(stdout ?? '').trim();
  } catch (e) {
    const hint = [e?.stderr, e?.stdout, e?.message].filter(Boolean).join('\n').trim();
    if (/not authorized|authentication|canceled user|user canceled|incorrect password|sorry|a password is required|no tty|Askpass/i.test(hint)) {
      throw new Error(`sudo 认证失败或已取消。${hint ? `\n${hint.slice(0, 600)}` : ''}`);
    }
    throw Object.assign(new Error(hint.slice(0, 2000) || 'sudo 执行失败'), { cause: e });
  }
}
