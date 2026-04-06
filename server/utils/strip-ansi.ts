/**
 * 去掉终端 ANSI CSI / OSC 转义，供 Web UI 展示 SSH/PTY 流式日志。
 */
// eslint-disable-next-line no-control-regex -- intentional: match ESC / C1 CSI
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u009b\[[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
  return text
    .replace(ANSI_OSC, '')
    .replace(ANSI_CSI, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}
