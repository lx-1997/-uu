/** 与 HttpOnly Cookie 并行：Electron file:// 或跨端口时 Cookie 偶发不带，用镜像头补传会话 id */
export const RDK_SSO_SESSION_MIRROR_KEY = 'rdk_sso_session_mirror';

const SESSION_HEADER = 'X-RDK-Sso-Session';

/** 将本地镜像的会话 id 写入 Headers（供 fetchApi / api.request 使用） */
export function applySsoMirrorToHeaders(headers: Headers): void {
  if (typeof window === 'undefined') return;
  try {
    if (headers.has(SESSION_HEADER)) return;
    const sid = window.localStorage.getItem(RDK_SSO_SESSION_MIRROR_KEY)?.trim();
    if (sid && /^[a-f0-9]{64}$/i.test(sid)) {
      headers.set(SESSION_HEADER, sid);
    }
  } catch {
    /* noop */
  }
}

/** 登录态刷新或登出时同步镜像（sessionId 为 64 位 hex） */
export function setSsoSessionMirror(sessionId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    const s = String(sessionId || '').trim();
    if (s && /^[a-f0-9]{64}$/i.test(s)) {
      window.localStorage.setItem(RDK_SSO_SESSION_MIRROR_KEY, s);
    } else {
      window.localStorage.removeItem(RDK_SSO_SESSION_MIRROR_KEY);
    }
  } catch {
    /* noop */
  }
}

/** 与 src/api.ts 中桌面端逻辑一致，供非 request() 场景的 fetch 使用 */
export function resolveApiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const apiBase = (window as unknown as { rdkDesktop?: { apiBase?: string } }).rdkDesktop?.apiBase;
  if (apiBase) return `${apiBase}${path}`;
  return path;
}

/**
 * 跨端口请求后端（如 localhost:5173 → :8787）时必须带 Cookie（SSO 会话），
 * 默认 credentials 为 include；并附带 X-RDK-Sso-Session 镜像（与 Cookie 二选一即可被服务端识别）。
 */
export function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  applySsoMirrorToHeaders(headers);
  return fetch(resolveApiUrl(path), {
    ...init,
    headers,
    credentials: init?.credentials ?? 'include',
  });
}
