import { useEffect } from 'react';
import { resolveApiUrl } from '../utils/apiBase';

const STORAGE_ANON = 'rdk:studio-anon-id';

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

/** 同一文档生命周期内只执行一次（避免 React Strict Mode 开发态双次 effect 产生双条 PV）；整页刷新 timeOrigin 变，仍会记新 PV。 */
function tryMarkPvOnceThisDocument(markKey: string): boolean {
  try {
    const key = `rdk:pv:${performance.timeOrigin}:${markKey}`;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return true;
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
 * SSO 验证通过、存在 user 后上报 PV（每次整页加载进入已登录态一条；换账号会再记）。
 */
export function useSessionDailyActivePing(loading: boolean, user: { id: string } | null) {
  useEffect(() => {
    if (loading || !user) return;
    const markKey = `sso:${user.id}`;
    if (!tryMarkPvOnceThisDocument(markKey)) return;
    const appVersion = import.meta.env.VITE_APP_VERSION || '';
    void postDailyActive({ appVersion });
  }, [loading, user?.id]);
}

/**
 * 未强制 SSO、且未登录时：访客每次整页加载一条 PV。
 */
export function useGuestDailyActivePing(
  loading: boolean,
  ssoRequired: boolean,
  user: { id: string } | null,
) {
  useEffect(() => {
    if (loading || ssoRequired || user) return;
    if (!tryMarkPvOnceThisDocument('guest')) return;
    const anonymousId = getOrCreateAnonymousId();
    const appVersion = import.meta.env.VITE_APP_VERSION || '';
    void postDailyActive({ anonymousId, appVersion });
  }, [loading, ssoRequired, user]);
}
