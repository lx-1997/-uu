/**
 * Default Socket.IO client options: gentler reconnect backoff so DevTools
 * is not flooded when the API is briefly down or restarting.
 */
export const socketIoClientOptions = {
  transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
  /** 与 fetch credentials:'include' 一致；开发态直连后端时依赖 Express Socket.IO 的 CORS */
  withCredentials: true,
  reconnection: true,
  reconnectionAttempts: 25,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 15000,
  timeout: 15000,
};

function isViteBrowserDev(): boolean {
  if (!(import.meta as any).env?.DEV) return false;
  if (typeof window === 'undefined') return false;
  const { protocol } = window.location;
  if (protocol === 'file:') return false;
  return protocol === 'http:' || protocol === 'https:';
}

/**
 * Resolve the Socket.IO / API base URL.
 *
 * 浏览器 + Vite 开发：优先 VITE_SOCKET_URL（vite.config 注入为 http://localhost:PORT），直连后端 Socket.IO，
 * 避免仅经 :5173 代理时 WebSocket 握手失败；/api 仍可用相对路径走代理。
 * Electron file://：使用 preload 注入的 apiBase（通常为 http://localhost:8787）。
 * 生产 Web：使用页面 origin。
 */
export function resolveSocketUrl(): string {
  if (isViteBrowserDev()) {
    const direct = (import.meta.env.VITE_SOCKET_URL as string | undefined)?.trim();
    if (direct) return direct;
    return window.location.origin;
  }

  const apiBase = (window as any).rdkDesktop?.apiBase as string | undefined;
  if (apiBase) {
    try {
      const url = new URL(apiBase);
      return `${url.protocol}//${url.host}`;
    } catch { /* fall through */ }
  }

  return window.location.origin;
}
