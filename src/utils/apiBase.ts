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
 * 与 resolveApiUrl 对齐的 WebSocket 基址：桌面端直连 apiBase；浏览器开发态与页面同 host（走 Vite 代理到 8787）。
 */
/** 一键部署日志 SSE：与 fetchApi 一样附带 rdk_sso_session，避免跨端口/iframe 下无 Cookie。 */
export function resolveOpenClawDeployStreamUrl(deviceId: string, jobId: string): string {
  let base = resolveApiUrl(
    `/api/devices/${encodeURIComponent(deviceId)}/openclaw/deploy/stream?jobId=${encodeURIComponent(jobId)}`,
  );
  try {
    const sid = window.localStorage.getItem(RDK_SSO_SESSION_MIRROR_KEY)?.trim();
    if (sid && /^[a-f0-9]{64}$/i.test(sid)) {
      const sep = base.includes('?') ? '&' : '?';
      base = `${base}${sep}rdk_sso_session=${encodeURIComponent(sid)}`;
    }
  } catch {
    /* ignore */
  }
  return base;
}

export function resolveApiWsUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const apiBase = (window as unknown as { rdkDesktop?: { apiBase?: string } }).rdkDesktop?.apiBase;
  if (apiBase) {
    try {
      const u = new URL(apiBase);
      const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${u.host}${path}`;
    } catch {
      return path;
    }
  }
  const loc = window.location;
  const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${loc.host}${path}`;
}

/** Webviz iframe 内发起的 rosbridge WebSocket 需带会话 query（与 EventSource 一致），否则 iframe 跨源不带 Cookie。 */
export function resolveRosbridgeWsUrlForDevice(deviceId: string): string {
  const basePath = `/api/rosbridge-ws?deviceId=${encodeURIComponent(deviceId)}`;
  let wsUrl = resolveApiWsUrl(basePath);
  try {
    const sid = window.localStorage.getItem(RDK_SSO_SESSION_MIRROR_KEY)?.trim();
    if (sid && /^[a-f0-9]{64}$/i.test(sid)) {
      wsUrl += `&rdk_sso_session=${encodeURIComponent(sid)}`;
    }
  } catch {
    /* noop */
  }
  return wsUrl;
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
