import { useEffect, useRef } from 'react';
import { resolveApiUrl } from '../utils/apiBase';

const STORAGE_ANON = 'rdk:studio-anon-id';
const STORAGE_GUEST_DAY = 'rdk:studio-daily-active-utc-day';

function utcDayString() {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateAnonymousId(): string {
  try {
    let id = localStorage.getItem(STORAGE_ANON)?.trim();
    if (id && id.length >= 16) return id;
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_ANON, id);
    return id;
  } catch {
    return `fallback-${Date.now()}`;
  }
}

async function postDailyActive(body: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch(resolveApiUrl('/api/analytics/daily-active'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    let data: { persisted?: boolean } = {};
    try {
      data = (await res.json()) as { persisted?: boolean };
    } catch {
      return false;
    }
    return data.persisted !== false;
  } catch {
    return false;
  }
}

/**
 * SSO 验证通过、存在 user 后上报；使用 Cookie 会话，服务端写入登录展示名。
 * 切换账号（user.id 变化）会再上报一条；同一会话内用 sessionStorage 防重复请求。
 */
export function useSessionDailyActivePing(loading: boolean, user: { id: string } | null) {
  const sentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;

    const today = utcDayString();
    const sessionKey = `rdk:daily-active-session:${user.id}:${today}`;
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey)) return;
    } catch {
      /* ignore */
    }
    if (sentKeyRef.current === sessionKey) return;

    const appVersion = import.meta.env.VITE_APP_VERSION || '';

    void (async () => {
      const ok = await postDailyActive({ appVersion });
      if (ok) {
        sentKeyRef.current = sessionKey;
        try {
          sessionStorage.setItem(sessionKey, '1');
        } catch {
          /* ignore */
        }
      }
    })();
  }, [loading, user?.id]);
}

/**
 * 未强制 SSO、且未登录时：按浏览器匿名 id 上报（本地开发等）。
 */
export function useGuestDailyActivePing(
  loading: boolean,
  ssoRequired: boolean,
  user: { id: string } | null,
) {
  const sentRef = useRef(false);

  useEffect(() => {
    if (loading || ssoRequired || user) return;
    if (sentRef.current) return;
    sentRef.current = true;

    const today = utcDayString();
    try {
      const last = localStorage.getItem(STORAGE_GUEST_DAY);
      if (last === today) return;
    } catch {
      /* ignore */
    }

    const anonymousId = getOrCreateAnonymousId();
    const appVersion = import.meta.env.VITE_APP_VERSION || '';

    void (async () => {
      const ok = await postDailyActive({ anonymousId, appVersion });
      if (ok) {
        try {
          localStorage.setItem(STORAGE_GUEST_DAY, today);
        } catch {
          /* ignore */
        }
      }
    })();
  }, [loading, ssoRequired, user]);
}
