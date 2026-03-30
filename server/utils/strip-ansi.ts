/**
 * 去掉终端 ANSI CSI 转义（颜色、粗体等），供 Web UI 展示 SSH/PTY 流式日志。
 * 与常见 strip-ansi 实现一致，覆盖 truecolor（如 `38;2;255;77;77m`）。
 */
// eslint-disable-next-line no-control-regex -- intentional: match ESC / C1 CSI
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u009b\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, '');
}
