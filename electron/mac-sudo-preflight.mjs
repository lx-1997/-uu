/**
 * 可选：应用启动时执行一次 `sudo --askpass -v`，与烧录/Type-C 共用 sudo 时间戳。
 * 默认关闭，避免每次启动都弹密码。启用：环境变量 RDK_STUDIO_MAC_PREFLIGHT_SUDO_V=1
 */
import {
  getBundledSudoAskpassScriptPathOrThrow,
  getMacLoginShellPath,
  showMacSudoPasswordPreamble,
  sudoAskpassValidateTicket,
} from './flash/sudo-mac.mjs';

export async function runMacDesktopSudoPreflight() {
  if (process.platform !== 'darwin') return;
  const silent = String(process.env.RDK_STUDIO_MAC_PREFLIGHT_SUDO_SILENT || '').trim() === '1';
  const askPassPath = getBundledSudoAskpassScriptPathOrThrow();
  const pathEnv = await getMacLoginShellPath();
  if (!silent) {
    await showMacSudoPasswordPreamble({
      title: '预授权 sudo',
      message: '将在启动时完成一次 sudo 认证。',
      detail:
        '认证通过后，在系统默认时间内进行烧录、Type-C 配网等操作时，可减少重复输入本机登录密码。'
        + ' 若不需要，可取消环境变量 RDK_STUDIO_MAC_PREFLIGHT_SUDO_V。',
    });
  }
  await sudoAskpassValidateTicket(askPassPath, pathEnv);
}
