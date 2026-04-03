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

/** 读取 localStorage 中的会话镜像 id（与 fetch 头逻辑一致） */
export function getSsoSessionMirrorId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const sid = window.localStorage.getItem(RDK_SSO_SESSION_MIRROR_KEY)?.trim();
    if (sid && /^[a-f0-9]{64}$/i.test(sid)) return sid;
  } catch {
    /* noop */
  }
  return '';
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

function useSameOriginApiInDev(): boolean {
  if (!(import.meta as any).env?.DEV) return false;
  if (typeof window === 'undefined') return false;
  const { protocol } = window.location;
  if (protocol === 'file:') return false;
  return protocol === 'http:' || protocol === 'https:';
}

/**
 * 供 fetchApi 使用：相对 `/api/...` 原样返回；已是绝对 URL 时只取 pathname+search，
 * 以便与 resolveMediaUrl 拼出的 http(s) 地址兼容。
 */
export function apiPathForFetch(pathOrUrl: string): string {
  const s = String(pathOrUrl || '').trim();
  if (!s) return s;
  if (s.startsWith('/')) return s;
  try {
    const u = new URL(s);
    return `${u.pathname}${u.search}`;
  } catch {
    return s;
  }
}

/** 与 src/api.ts 中桌面端逻辑一致，供非 request() 场景的 fetch 使用 */
export function resolveApiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const apiBase = (window as unknown as { rdkDesktop?: { apiBase?: string } }).rdkDesktop?.apiBase;
  /** 避免误用 apiBase 直连 :8787 导致与 Vite 不同源 CORS（浏览器开发态应走 /api 代理） */
  if (apiBase && !useSameOriginApiInDev()) {
    return `${apiBase}${path}`;
  }
  return path;
}

/**
 * 将相对 `/api/...`（可含 query）解析为绝对 http(s) URL：与当前页同源（如 dev :5173），
 * `file://` 或 Electron 无 host 时用 `rdkDesktop.apiBase`。
 * 勿用裸 `http://localhost` 作 base（会落到默认 :80）。
 */
export function resolveUrlBaseForRelativeApi(): string {
  if (typeof window === 'undefined') return 'http://localhost:8787';
  const { protocol, host } = window.location;
  if (protocol === 'file:' || !host) {
    const apiBase = (window as unknown as { rdkDesktop?: { apiBase?: string } }).rdkDesktop?.apiBase?.replace(/\/$/, '');
    return apiBase || 'http://localhost:8787';
  }
  return window.location.origin;
}

/**
 * `resolveApiUrl` 在浏览器开发态常返回相对路径；EventSource、Electron loadURL、带 SSO query 的拼接等需要绝对 URL。
 */
export function resolveApiUrlAbsolute(pathOrUrl: string): string {
  const s = String(pathOrUrl || '').trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (!s.startsWith('/')) return s;
  try {
    return new URL(s, resolveUrlBaseForRelativeApi()).href;
  } catch {
    return s;
  }
}

/**
 * iframe / Electron WebContentsView `loadURL` 等场景必须用绝对 URL；开发态 `resolveApiUrl` 仍可能是 `/api/...` 相对路径。
 * 桌面端存在 `rdkDesktop.apiBase` 时一律拼到后端根（与 preload 一致，如 http://localhost:8787）。
 */
export function resolveApiUrlForEmbed(path: string): string {
  if (!path.startsWith('/')) return path;
  const raw = (window as unknown as { rdkDesktop?: { apiBase?: string } }).rdkDesktop?.apiBase?.trim();
  const apiBase = raw?.replace(/\/$/, '');
  if (apiBase) {
    return `${apiBase}${path}`;
  }
  return resolveApiUrlAbsolute(path);
}

/**
 * Electron 打包后页面为 file://，<img> 请求 :8787 常不带 Cookie；与 EventSource 一样用 query 补会话（见 sso getSessionIdFromRequest）。
 */
function appendSsoSessionToLocalFilesUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  if (!url.includes('/api/local-files/')) return url;
  try {
    const sid = window.localStorage.getItem(RDK_SSO_SESSION_MIRROR_KEY)?.trim();
    if (!sid || !/^[a-f0-9]{64}$/i.test(sid)) return url;
    const u = new URL(url, resolveUrlBaseForRelativeApi());
    if (u.searchParams.has('rdk_sso_session')) return url;
    u.searchParams.set('rdk_sso_session', sid);
    return u.toString();
  } catch {
    return url;
  }
}

const MEDIA_EXT_FOR_LOCAL_FILES =
  /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|mp4|webm|mov|avi|mkv)$/i;

/**
 * 将 file://、本机绝对路径、或纯文件名（如 liyanhong.jpg）映射为 /api/local-files/basename，
 * 与后端在 downloads、workspace/downloads、及（媒体扩展名时）项目根目录的查找一致。
 */
function mapToLocalFilesApiPath(s: string): string | null {
  let p = s.trim();
  if (!p || p.includes('..')) return null;

  if (p.startsWith('file:')) {
    try {
      let rest = p.replace(/^file:\/\//i, '');
      if (/^\/[A-Za-z]:/i.test(rest)) rest = rest.slice(1);
      p = decodeURI(rest);
    } catch {
      return null;
    }
  }

  if (!p.includes('/') && !p.includes('\\')) {
    if (MEDIA_EXT_FOR_LOCAL_FILES.test(p) && !/^https?:/i.test(p)) {
      return `/api/local-files/${encodeURIComponent(p)}`;
    }
    return null;
  }

  if (!p.startsWith('/')) return null;
  const noQuery = (p.split('?')[0] ?? p).trim();
  const lastSlash = noQuery.lastIndexOf('/');
  const base = lastSlash >= 0 ? noQuery.slice(lastSlash + 1) : noQuery;
  if (!base || !MEDIA_EXT_FOR_LOCAL_FILES.test(base)) return null;
  if (noQuery.startsWith('/api/')) return null;
  return `/api/local-files/${encodeURIComponent(base)}`;
}

/**
 * 对话里图片/视频等 src：桌面端补 apiBase；data/blob 原样返回；http(s) 与相对路径均会补全并在需 SSO 时为 local-files 附加 rdk_sso_session。
 */
export function resolveMediaUrl(src: string): string {
  const s = String(src || '').trim();
  if (!s) return s;
  if (s.startsWith('data:') || s.startsWith('blob:')) return s;
  if (/^https?:\/\//i.test(s)) {
    return appendSsoSessionToLocalFilesUrl(s);
  }
  if (s.startsWith('//') && typeof window !== 'undefined') {
    return appendSsoSessionToLocalFilesUrl(`${window.location.protocol}${s}`);
  }
  const localFiles = mapToLocalFilesApiPath(s);
  if (localFiles) {
    return appendSsoSessionToLocalFilesUrl(resolveApiUrl(localFiles));
  }
  const urlPath = s.startsWith('/') ? s : `/${s.replace(/^\.\//, '')}`;
  return appendSsoSessionToLocalFilesUrl(resolveApiUrl(urlPath));
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
  return resolveApiUrlAbsolute(base);
}

export function resolveApiWsUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const apiBase = (window as unknown as { rdkDesktop?: { apiBase?: string } }).rdkDesktop?.apiBase;
  if (apiBase && !useSameOriginApiInDev()) {
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
