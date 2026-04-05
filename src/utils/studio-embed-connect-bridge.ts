/**
 * 由 Vnc / IDE 页面注册「一键连接」入口，供对话意图在**不切换 Tab** 时触发（与页面按钮同源）。
 */

let vncConnect: (() => void) | null = null;
let ideConnect: (() => void) | null = null;

export function registerVncRemoteConnect(fn: (() => void) | null): void {
  vncConnect = fn;
}

export function registerIdeRemoteConnect(fn: (() => void) | null): void {
  ideConnect = fn;
}

/** 与远程桌面页「连接」按钮相同逻辑 */
export function requestVncRemoteConnect(): void {
  vncConnect?.();
}

/** 与 IDE 页「打开 code-server」相同逻辑 */
export function requestIdeRemoteConnect(): void {
  ideConnect?.();
}
