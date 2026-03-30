/**
 * D-Robotics SSO Integration
 *
 * OAuth2 Authorization Code flow with sso.d-robotics.cc
 */
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import { getSsoSessionsFilePath } from './storage.js';
import { ForumAuthStore } from './rdkclaw/forum-auth-store.js';
import { scheduleForumSyncFromSso, clearForumAuthOnAppSsoLogout } from './agent/tools/forum-tools.js';

const SSO_BASE = process.env.SSO_BASE_URL || 'https://sso.d-robotics.cc';
const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const SSO_CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
// 默认要求先登录再使用平台；本地开发可设 SSO_REQUIRED=0 关闭门禁。
const SSO_REQUIRED = process.env.SSO_REQUIRED !== '0';
const SSO_CALLBACK_PATH = '/api/sso/callback';

const TOKEN_COOKIE = 'rdk_sso_token';
const SESSION_COOKIE = 'rdk_sso_session';
/** 与 Cookie 等价：Electron file:// 或跨源时 Cookie 偶发不带，客户端用 localStorage 镜像后通过此头补传 */
const SESSION_HEADER = 'x-rdk-sso-session';
/** 默认 14 天；可通过环境变量 SSO_SESSION_MAX_AGE_MS（毫秒）调整 */
const TOKEN_EXPIRY_MS = (() => {
  const n = Number(process.env.SSO_SESSION_MAX_AGE_MS);
  return Number.isFinite(n) && n >= 60_000 ? n : 14 * 24 * 60 * 60 * 1000;
})();

export interface SSOUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

const sessions = new Map<string, {
  user: SSOUser;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}>();

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersistSsoSessions(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushSsoSessionsToDisk();
  }, 400);
}

async function flushSsoSessionsToDisk(): Promise<void> {
  const filePath = getSsoSessionsFilePath();
  try {
    const now = Date.now();
    const obj: Record<string, {
      user: SSOUser;
      accessToken: string;
      refreshToken?: string;
      expiresAt: number;
    }> = {};
    for (const [k, v] of sessions.entries()) {
      if (v.expiresAt > now) obj[k] = v;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ v: 1, sessions: obj }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[SSO] persist sessions failed:', err instanceof Error ? err.message : err);
  }
}

/** 启动时调用：恢复 Cookie 对应的会话（否则仅重启后端也会被迫重新登录） */
export async function restoreSsoSessionsFromDisk(): Promise<void> {
  const filePath = getSsoSessionsFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as {
      v?: number;
      sessions?: Record<string, {
        user?: SSOUser;
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
      }>;
    };
    if (data.v !== 1 || !data.sessions || typeof data.sessions !== 'object') return;
    const now = Date.now();
    let n = 0;
    for (const [id, s] of Object.entries(data.sessions)) {
      if (
        s?.user?.id
        && typeof s.accessToken === 'string'
        && typeof s.expiresAt === 'number'
        && s.expiresAt > now
      ) {
        sessions.set(id, {
          user: {
            id: String(s.user.id),
            name: String(s.user.name || ''),
            email: String(s.user.email || ''),
            avatar: typeof s.user.avatar === 'string' ? s.user.avatar : undefined,
          },
          accessToken: s.accessToken,
          refreshToken: typeof s.refreshToken === 'string' ? s.refreshToken : undefined,
          expiresAt: s.expiresAt,
        });
        n += 1;
      }
    }
    if (n > 0) console.log(`[SSO] restored ${n} session(s) from disk`);
  } catch (err: NodeJS.ErrnoException | unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    console.warn('[SSO] restore sessions failed:', err instanceof Error ? err.message : err);
  }
}

setInterval(() => {
  const now = Date.now();
  let removed = false;
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(key);
      removed = true;
    }
  }
  if (removed) schedulePersistSsoSessions();
}, 60_000);

export function isSSOEnabled(): boolean {
  return !!(SSO_CLIENT_ID && SSO_CLIENT_SECRET);
}

export function isSSORequired(): boolean {
  return SSO_REQUIRED;
}

function buildCallbackUrl(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8787');
  return `${proto}://${host}${SSO_CALLBACK_PATH}`;
}

function buildLoginUrl(req: Request, state: string): string {
  if (!isSSOEnabled()) {
    const redirectUri = `${String(req.headers['x-forwarded-proto'] || req.protocol || 'http')}://${String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8787')}`;
    return `${SSO_BASE}/?redirect=${encodeURIComponent(redirectUri)}`;
  }
  const redirectUri = buildCallbackUrl(req);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SSO_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
  });
  return `${SSO_BASE}/oauth2/authorize?${params.toString()}`;
}

/**
 * 用 access_token 拉 userinfo / JWT 声明，供 OAuth 回调与桌面内嵌 token 引导入会话。
 * @param strictUserinfo401 为 true 时（bootstrap）userinfo 返回 401 直接拒绝，避免接受伪造 token。
 * @param allowSyntheticId 为 false 时（bootstrap）若仍无法解析出用户 id 则拒绝，禁止随机占位 id。
 */
async function resolveSSOUser(
  accessToken: string,
  idToken?: string,
  strictUserinfo401 = false,
  allowSyntheticId = true,
): Promise<SSOUser> {
  let user: SSOUser = { id: '', name: '', email: '' };
  try {
    const userRes = await fetch(`${SSO_BASE}/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userRes.ok) {
      const userData = (await userRes.json()) as Record<string, unknown>;
      user = {
        id: String(userData.sub || userData.id || userData.user_id || ''),
        name: String(userData.name || userData.username || userData.nickname || ''),
        email: String(userData.email || ''),
        avatar: typeof userData.picture === 'string' ? userData.picture : undefined,
      };
    } else if (userRes.status === 401 && strictUserinfo401) {
      throw Object.assign(new Error('invalid_token'), { code: 'INVALID_TOKEN' });
    }
  } catch (err) {
    if (err && typeof err === 'object' && (err as any).code === 'INVALID_TOKEN') throw err;
    console.warn('[SSO] userinfo fetch failed, trying token claims');
  }

  if (!user.id && idToken) {
    try {
      const [, payload] = idToken.split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      user = {
        id: String(claims.sub || ''),
        name: String(claims.name || claims.preferred_username || ''),
        email: String(claims.email || ''),
      };
    } catch { /* ignore */ }
  }

  if (!user.id) {
    try {
      const parts = accessToken.split('.');
      if (parts.length === 3) {
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        user = {
          id: String(claims.sub || claims.user_id || claims.userId || ''),
          name: String(claims.name || claims.preferred_username || ''),
          email: String(claims.email || ''),
        };
      }
    } catch { /* ignore */ }
  }

  if (!user.id) {
    if (!allowSyntheticId) {
      throw Object.assign(new Error('invalid_token'), { code: 'INVALID_TOKEN' });
    }
    user.id = `sso-${crypto.randomBytes(8).toString('hex')}`;
  }
  return user;
}

function parseJwtPayloadSegment(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 桌面环回 token（对齐 rdkstudio_frontend-master）：先解析 access_token JWT，再可选请求 userinfo。
 * 避免「服务端请求 userinfo 返回 401」时从未执行到 JWT 分支而导致无法登录。
 */
function userFromAccessTokenJwt(accessToken: string): SSOUser | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  const claims = parseJwtPayloadSegment(parts[1]);
  if (!claims) return null;
  const exp = claims.exp;
  if (typeof exp === 'number' && exp * 1000 < Date.now() - 120_000) return null;
  const id = String(claims.sub || claims.user_id || claims.userId || '');
  if (!id) return null;
  return {
    id,
    name: String(claims.name || claims.preferred_username || ''),
    email: String(claims.email || ''),
    avatar: typeof claims.picture === 'string' ? claims.picture : undefined,
  };
}

async function tryEnrichUserFromUserinfo(accessToken: string, base: SSOUser): Promise<SSOUser> {
  try {
    const userRes = await fetch(`${SSO_BASE}/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return base;
    const userData = (await userRes.json()) as Record<string, unknown>;
    return {
      id: String(userData.sub || userData.id || userData.user_id || base.id),
      name: String(userData.name || userData.username || userData.nickname || base.name),
      email: String(userData.email || base.email),
      avatar: typeof userData.picture === 'string' ? userData.picture : base.avatar,
    };
  } catch {
    return base;
  }
}

async function resolveUserForDesktopBootstrap(accessToken: string): Promise<SSOUser> {
  const fromJwt = userFromAccessTokenJwt(accessToken);
  if (fromJwt) {
    return tryEnrichUserFromUserinfo(accessToken, fromJwt);
  }
  return await resolveSSOUser(accessToken, undefined, true, false);
}

/**
 * 对话归档 `sso_user_name` 列（语义为展示名）：优先 SSO 姓名 → 邮箱前缀 → 账户 id（`SSO·…`）；
 * 未登录或未启用 SSO 时，用前端 Stable userId（`Studio·…`），避免整列为 NULL。
 */
export function formatConversationArchiveUserName(
  ssoUser: SSOUser | undefined,
  clientUserId?: string,
): string | undefined {
  if (ssoUser) {
    const name = String(ssoUser.name || '').trim();
    if (name) return name;
    const email = String(ssoUser.email || '').trim();
    const at = email.indexOf('@');
    const fromEmail = at > 0 ? email.slice(0, at) : email;
    if (fromEmail) return fromEmail;
    const id = String(ssoUser.id || '').trim();
    if (id) return id.length > 28 ? `SSO·${id.slice(0, 12)}…${id.slice(-8)}` : `SSO·${id}`;
  }
  const uid = String(clientUserId ?? '').trim();
  if (uid) return `Studio·${uid}`;
  return undefined;
}

/**
 * 从请求 Cookie 解析当前 SSO 会话用户。
 * 供先于 ssoAuthMiddleware 注册的 API（如 /api/analytics/daily-active）使用。
 */
function getSessionIdFromRequest(req: Request): string {
  const fromCookie = parseCookie(req.headers.cookie || '', SESSION_COOKIE);
  if (fromCookie && /^[a-f0-9]{64}$/i.test(fromCookie)) return fromCookie;
  const raw = req.headers[SESSION_HEADER];
  const h = Array.isArray(raw) ? raw[0] : raw;
  const s = String(h || '').trim();
  if (s && /^[a-f0-9]{64}$/i.test(s)) return s;
  /** EventSource 无法设置自定义头；Electron file:// 直连 :8787 时 Cookie 常丢失。允许与前端 localStorage 镜像同源的 query 传会话 id */
  const q = req.query?.rdk_sso_session;
  const qs = typeof q === 'string' ? q : Array.isArray(q) ? String(q[0] ?? '') : '';
  if (qs && /^[a-f0-9]{64}$/i.test(qs)) return qs;
  return '';
}

export function getSessionSsoUser(req: Request): SSOUser | null {
  const sessionId = getSessionIdFromRequest(req);
  return sessionId ? getSsoUserBySessionId(sessionId) : null;
}

function getSsoUserBySessionId(sessionId: string): SSOUser | null {
  if (!sessionId || !sessions.has(sessionId)) return null;
  const session = sessions.get(sessionId)!;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    schedulePersistSsoSessions();
    return null;
  }
  return session.user;
}

/** WebSocket `upgrade` 无 Express req：从 Cookie / 头 / query 解析会话（与 getSessionSsoUser 对齐）。 */
export function getSessionSsoUserFromIncomingMessage(req: IncomingMessage): SSOUser | null {
  const sessionId = getSessionIdFromIncomingMessage(req);
  return sessionId ? getSsoUserBySessionId(sessionId) : null;
}

function getSessionIdFromIncomingMessage(req: IncomingMessage): string {
  const fromCookie = parseCookie(req.headers.cookie || '', SESSION_COOKIE);
  if (fromCookie && /^[a-f0-9]{64}$/i.test(fromCookie)) return fromCookie;
  const raw = req.headers[SESSION_HEADER];
  const h = Array.isArray(raw) ? raw[0] : raw;
  const s = String(h || '').trim();
  if (s && /^[a-f0-9]{64}$/i.test(s)) return s;
  try {
    const u = new URL(req.url || '', 'http://localhost');
    const qs = u.searchParams.get('rdk_sso_session') || '';
    if (qs && /^[a-f0-9]{64}$/i.test(qs)) return qs;
  } catch {
    /* noop */
  }
  return '';
}

/** 写入 forum-auth 展示用用户名（与 forum-tools 中 derive 逻辑对齐） */
function forumUsernameHintFromSsoUser(user: SSOUser): string | undefined {
  const name = String(user.name || '').trim();
  if (name) return name;
  const email = String(user.email || '').trim();
  const at = email.indexOf('@');
  if (at > 0) return email.slice(0, at);
  if (email) return email;
  const id = String(user.id || '').trim();
  return id || undefined;
}

function commitSSOSession(res: Response, user: SSOUser, accessToken: string, refreshToken?: string): string {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  sessions.set(sessionId, {
    user,
    accessToken,
    refreshToken,
    expiresAt,
  });
  schedulePersistSsoSessions();
  new ForumAuthStore().saveAppSsoAccessToken(accessToken, forumUsernameHintFromSsoUser(user));
  scheduleForumSyncFromSso(accessToken, user);
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TOKEN_EXPIRY_MS / 1000)}`,
  ]);
  return sessionId;
}

export function ssoAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isSSORequired()) {
    next();
    return;
  }

  /**
   * 微信扫码预览图：img 标签请求无法带自定义 Header，且部分部署下路由顺序可能变化。
   * 显式放行，避免返回 401 JSON 被当成图片解码失败。
   */
  if (req.method === 'GET' && req.path.startsWith('/api/rdkclaw/weixin/qr-preview')) {
    next();
    return;
  }

  if (req.path.startsWith('/api/sso/') || req.path.startsWith('/api/health')) {
    next();
    return;
  }

  /**
   * noVNC 静态资源（/vnc/*）：与 Studio 账号无关；RFB 由板端 VNC 口令与 websockify 私网目标校验约束。
   * 若要求 SSO，内嵌 WebView 常不携带 Cookie，会误跳统一认证页。
   */
  if (
    (req.method === 'GET' || req.method === 'HEAD')
    && (req.path === '/vnc' || req.path.startsWith('/vnc/'))
  ) {
    next();
    return;
  }

  /**
   * 仅同步「当前 UI 会话 / 设备」到飞书适配器内存，无敏感数据。
   * 开发态常见 localhost 跨端口，Cookie 偶发未带上会导致 401，干扰对话侧体验（与论坛凭据无关）。
   */
  if (
    req.method === 'POST'
    && (req.path === '/api/rdkclaw/session/active' || req.path === '/api/rdkclaw/device/active')
  ) {
    next();
    return;
  }

  /** 匿名行为埋点，不含聊天正文；便于未登录/跨源场景上报 */
  if (req.method === 'POST' && req.path === '/api/analytics/events') {
    next();
    return;
  }

  const sessionId = getSessionIdFromRequest(req);
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    if (session.expiresAt > Date.now()) {
      (req as any).ssoUser = session.user;
      next();
      return;
    }
    sessions.delete(sessionId);
    schedulePersistSsoSessions();
  }

  if (req.path.startsWith('/api/')) {
    res.status(401).json({
      error: 'unauthorized',
      required: true,
      configured: isSSOEnabled(),
      ssoLoginUrl: buildLoginUrl(req, 'api'),
    });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  res.redirect(302, buildLoginUrl(req, state));
}

export function registerSSORoutes(app: any): void {
  app.get('/api/sso/login', (req: Request, res: Response) => {
    if (!isSSORequired()) {
      res.json({ enabled: false, required: false, configured: isSSOEnabled() });
      return;
    }
    const state = crypto.randomBytes(16).toString('hex');
    res.json({ enabled: true, required: true, configured: isSSOEnabled(), loginUrl: buildLoginUrl(req, state) });
  });

  app.get(SSO_CALLBACK_PATH, async (req: Request, res: Response) => {
    if (!isSSOEnabled()) {
      res.status(503).send('SSO callback unavailable: missing client credentials');
      return;
    }
    const code = String(req.query.code || '');
    if (!code) {
      res.status(400).send('Missing authorization code');
      return;
    }

    try {
      const redirectUri = buildCallbackUrl(req);
      const tokenRes = await fetch(`${SSO_BASE}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: SSO_CLIENT_ID,
          client_secret: SSO_CLIENT_SECRET,
        }).toString(),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => '');
        console.error('[SSO] token exchange failed:', tokenRes.status, errText.slice(0, 200));
        res.status(502).send('SSO token exchange failed');
        return;
      }

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
      };

      if (!tokenData.access_token) {
        res.status(502).send('SSO returned no access token');
        return;
      }

      const user = await resolveSSOUser(tokenData.access_token, tokenData.id_token, false, true);
      commitSSOSession(res, user, tokenData.access_token, tokenData.refresh_token);

      res.redirect(302, `/?sso=ok`);
    } catch (err) {
      console.error('[SSO] callback error:', err instanceof Error ? err.message : err);
      res.status(500).send('SSO authentication failed');
    }
  });

  /**
   * 桌面端环回 token → HttpOnly 会话（对齐 rdkstudio_frontend-master）：
   * 不依赖 SSO_CLIENT_ID/SECRET；优先 JWT claims，userinfo 仅补充。
   */
  app.post('/api/sso/bootstrap', async (req: Request, res: Response) => {
    let raw = String(req.body?.accessToken ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim()
      || String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    if (!raw) {
      res.status(400).json({ ok: false, error: 'missing access token' });
      return;
    }
    try {
      const user = await resolveUserForDesktopBootstrap(raw);
      const sessionId = commitSSOSession(res, user, raw, undefined);
      res.json({ ok: true, user, sessionId });
    } catch (err) {
      console.warn('[SSO] bootstrap failed:', err instanceof Error ? err.message : err);
      res.status(401).json({ ok: false, error: 'invalid or expired token' });
    }
  });

  app.get('/api/sso/me', (req: Request, res: Response) => {
    if (!isSSORequired()) {
      res.json({ enabled: false, required: false, configured: isSSOEnabled(), user: null });
      return;
    }
    const sessionId = getSessionIdFromRequest(req);
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.expiresAt > Date.now()) {
        res.json({
          enabled: true,
          required: true,
          configured: isSSOEnabled(),
          user: session.user,
          sessionId,
        });
        return;
      }
      sessions.delete(sessionId);
      schedulePersistSsoSessions();
    }
    res.json({ enabled: true, required: true, configured: isSSOEnabled(), user: null });
  });

  app.post('/api/sso/logout', (req: Request, res: Response) => {
    const sessionId = getSessionIdFromRequest(req);
    if (sessionId) {
      sessions.delete(sessionId);
      schedulePersistSsoSessions();
    }
    clearForumAuthOnAppSsoLogout();
    res.setHeader('Set-Cookie', [
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    ]);
    const logoutUrl = isSSOEnabled() ? `${SSO_BASE}/oauth2/logout?client_id=${SSO_CLIENT_ID}` : '/';
    res.json({ ok: true, logoutUrl });
  });
}

function parseCookie(cookieHeader: string, name: string): string {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}
