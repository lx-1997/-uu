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

/** 下一次由对话意图触发的 IDE 连接成功后，浏览器端默认浮出悬浮窗（不依赖 toolbar 轮询） */
let ideConnectPreferFloatNext = false;

export function setIdeConnectPreferFloatOnNext(v: boolean): void {
  ideConnectPreferFloatNext = v;
}

/** 读取并清除「下次连接成功后是否浮出」；仅应在 IDE handleConnect 成功路径或丢弃意图时调用 */
export function consumeIdeConnectPreferFloat(): boolean {
  const v = ideConnectPreferFloatNext;
  ideConnectPreferFloatNext = false;
  return v;
}
