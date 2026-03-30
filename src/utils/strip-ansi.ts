/**
 * 与 server/utils/strip-ansi.ts 一致：Web 端展示 SSH 日志时去掉 ANSI 色码。
 */
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u009b\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, '');
}
