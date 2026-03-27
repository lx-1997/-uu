/** 与 src/api.ts 中桌面端逻辑一致，供非 request() 场景的 fetch 使用 */
export function resolveApiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const apiBase = (window as unknown as { rdkDesktop?: { apiBase?: string } }).rdkDesktop?.apiBase;
  if (apiBase) return `${apiBase}${path}`;
  return path;
}

/**
 * 跨端口请求后端（如 localhost:5173 → :8787）时必须带 Cookie（SSO 会话），
 * 默认 credentials 为 include；与 rdkstudio_frontend-master 在桌面存 token 不同，本站用 HttpOnly 会话。
 */
export function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  return fetch(resolveApiUrl(path), {
    ...init,
    credentials: init?.credentials ?? 'include',
  });
}
