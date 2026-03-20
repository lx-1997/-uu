/**
 * Resolve the Socket.IO / API base URL.
 *
 * In dev mode we always connect to the local dev server.
 * In desktop (Electron) mode the renderer may be loaded from file://,
 * so we derive the host from the preload-injected apiBase.
 * In production web mode we use the page origin.
 */
export function resolveSocketUrl(): string {
  if ((import.meta as any).env?.DEV) return 'http://localhost:8787';

  const apiBase = (window as any).rdkDesktop?.apiBase as string | undefined;
  if (apiBase) {
    try {
      const url = new URL(apiBase);
      return `${url.protocol}//${url.host}`;
    } catch { /* fall through */ }
  }

  return window.location.origin;
}
