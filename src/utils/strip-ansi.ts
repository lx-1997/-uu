/**
 * 与 server/utils/strip-ansi.ts 一致：Web 端展示 SSH/PTY 日志时去掉 ANSI 色码与 OSC。
 */
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u009b\[[0-?]*[ -/]*[@-~]/g;
/** OSC（含超链接、标题等），以 BEL 或 ST 结束 */
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_OSC, '').replace(ANSI_CSI, '');
}

/**
 * 终端行展示用：在 stripAnsi 后再去掉 ESC 丢失时残留的 SGR 片段（如裸 `[0m`、`[1m`），并清理替换字符。
 */
const LOOSE_SGR_FRAGMENT = /\[(?:\d{1,4};)*\d{1,4}m/g;

export function sanitizeTerminalLineForDisplay(line: string): string {
  let s = stripAnsi(line).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\uFFFD/g, '');
  s = s.replace(LOOSE_SGR_FRAGMENT, '');
  // 终端里常见的 C0 控制符（除 \t）在浏览器中常显示为「豆腐块」
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return s;
}
