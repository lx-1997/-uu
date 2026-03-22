/**
 * D-Robotics SSO Integration
 *
 * OAuth2 Authorization Code flow with sso.d-robotics.cc
 */
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const SSO_BASE = process.env.SSO_BASE_URL || 'https://sso.d-robotics.cc';
const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const SSO_CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
const SSO_CALLBACK_PATH = '/api/sso/callback';

const TOKEN_COOKIE = 'rdk_sso_token';
const SESSION_COOKIE = 'rdk_sso_session';
const TOKEN_EXPIRY_MS = 8 * 60 * 60 * 1000; // 8h

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

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAt < now) sessions.delete(key);
  }
}, 60_000);

export function isSSOEnabled(): boolean {
  return !!(SSO_CLIENT_ID && SSO_CLIENT_SECRET);
}

function buildCallbackUrl(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8787');
  return `${proto}://${host}${SSO_CALLBACK_PATH}`;
}

function buildLoginUrl(req: Request, state: string): string {
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

export function ssoAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isSSOEnabled()) {
    next();
    return;
  }

  if (req.path.startsWith('/api/sso/') || req.path.startsWith('/api/health')) {
    next();
    return;
  }

  const sessionId = parseCookie(req.headers.cookie || '', SESSION_COOKIE);
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    if (session.expiresAt > Date.now()) {
      (req as any).ssoUser = session.user;
      next();
      return;
    }
    sessions.delete(sessionId);
  }

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'unauthorized', ssoLoginUrl: buildLoginUrl(req, 'api') });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  res.redirect(302, buildLoginUrl(req, state));
}

export function registerSSORoutes(app: any): void {
  app.get('/api/sso/login', (req: Request, res: Response) => {
    if (!isSSOEnabled()) {
      res.json({ enabled: false });
      return;
    }
    const state = crypto.randomBytes(16).toString('hex');
    res.json({ enabled: true, loginUrl: buildLoginUrl(req, state) });
  });

  app.get(SSO_CALLBACK_PATH, async (req: Request, res: Response) => {
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

      let user: SSOUser = { id: '', name: '', email: '' };
      try {
        const userRes = await fetch(`${SSO_BASE}/oauth2/userinfo`, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (userRes.ok) {
          const userData = (await userRes.json()) as Record<string, unknown>;
          user = {
            id: String(userData.sub || userData.id || userData.user_id || ''),
            name: String(userData.name || userData.username || userData.nickname || ''),
            email: String(userData.email || ''),
            avatar: typeof userData.picture === 'string' ? userData.picture : undefined,
          };
        }
      } catch (err) {
        console.warn('[SSO] userinfo fetch failed, using token claims');
        if (tokenData.id_token) {
          try {
            const [, payload] = tokenData.id_token.split('.');
            const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
            user = {
              id: String(claims.sub || ''),
              name: String(claims.name || claims.preferred_username || ''),
              email: String(claims.email || ''),
            };
          } catch { /* ignore */ }
        }
      }

      if (!user.id) user.id = `sso-${crypto.randomBytes(8).toString('hex')}`;

      const sessionId = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
      sessions.set(sessionId, {
        user,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
      });

      res.setHeader('Set-Cookie', [
        `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TOKEN_EXPIRY_MS / 1000)}`,
      ]);

      res.redirect(302, `/?sso=ok`);
    } catch (err) {
      console.error('[SSO] callback error:', err instanceof Error ? err.message : err);
      res.status(500).send('SSO authentication failed');
    }
  });

  app.get('/api/sso/me', (req: Request, res: Response) => {
    if (!isSSOEnabled()) {
      res.json({ enabled: false, user: null });
      return;
    }
    const sessionId = parseCookie(req.headers.cookie || '', SESSION_COOKIE);
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.expiresAt > Date.now()) {
        res.json({ enabled: true, user: session.user });
        return;
      }
      sessions.delete(sessionId);
    }
    res.json({ enabled: true, user: null });
  });

  app.post('/api/sso/logout', (req: Request, res: Response) => {
    const sessionId = parseCookie(req.headers.cookie || '', SESSION_COOKIE);
    if (sessionId) sessions.delete(sessionId);
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
