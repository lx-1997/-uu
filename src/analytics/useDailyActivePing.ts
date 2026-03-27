import { useEffect, useRef } from 'react';
import { fetchApi } from '../utils/apiBase';

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

/**
 * 同一文档生命周期内、同一 markKey 只执行一次（避免 Strict Mode 双次 effect 双条 PV）。
 * markKey 需随「登入轮次」变化（见 useSessionDailyActivePing），否则同页退出再登录不会记新 PV。
 * 整页刷新后 timeOrigin 变，仍会记新 PV。
 */
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
    const res = await fetchApi('/api/analytics/daily-active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
 * SSO 验证通过、存在 user 后上报 PV。
 * 每次「从登出到再次登入」或「换账号」spell 递增，与整页刷新一样可产生多条（同页退出再登录也会一条新 PV）。
 */
export function useSessionDailyActivePing(loading: boolean, user: { id: string } | null) {
  const prevUserIdRef = useRef<string | null>(null);
  const spellRef = useRef(0);

  useEffect(() => {
    if (loading) return;
    const id = user?.id ?? null;
    if (!id) {
      prevUserIdRef.current = null;
      return;
    }
    if (prevUserIdRef.current !== id) {
      spellRef.current += 1;
    }
    prevUserIdRef.current = id;
    const markKey = `sso:${id}:s${spellRef.current}`;
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

/**
 * @deprecated 日活 PV 已迁至 `AuthProvider`（`useSessionDailyActivePing` / `useGuestDailyActivePing`）。
 * 保留同名空 hook，避免旧代码或 Vite HMR 缓存仍 `import { useDailyActivePing }` 时整页模块加载失败，
 * 进而触发「useAuth 不在 AuthProvider 内」等连锁报错。
 */
export function useDailyActivePing(): void {
  /* no-op */
}
