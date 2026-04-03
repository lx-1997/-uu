/**
 * Default Socket.IO client options: gentler reconnect backoff so DevTools
 * is not flooded when the API is briefly down or restarting.
 */
export const socketIoClientOptions = {
  transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
  /** 与 fetch credentials:'include' 一致，便于携带 SSO Cookie（轮询降级时经 Express） */
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
 * 浏览器 + Vite 开发（如 localhost:5173）：与页面同源，经 Vite 代理到后端（见 vite.config proxy）。
 * Electron file://：使用 preload 注入的 apiBase（通常为 http://localhost:8787）。
 * 生产 Web：使用页面 origin。
 */
export function resolveSocketUrl(): string {
  if (isViteBrowserDev()) {
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
