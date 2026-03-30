import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useSessionDailyActivePing, useGuestDailyActivePing } from '../analytics/useDailyActivePing';
import { ssoTranslate as st } from '../i18n/sso-translate';
import { fetchApi, setSsoSessionMirror } from '../utils/apiBase';

type LogoutUiPhase = null | 'redirect' | 'reload';

function LogoutTransitionOverlay({ phase }: { phase: Exclude<LogoutUiPhase, null> }) {
  const msg =
    phase === 'redirect'
      ? st('sso.logoutRedirecting', '正在退出登录，即将跳转统一认证…')
      : st('sso.logoutReloading', '正在刷新页面…');
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: 'linear-gradient(135deg, #0f0f14 0%, #1a1a24 50%, #0f0f14 100%)',
        color: 'rgba(255,255,255,0.9)',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          border: '3px solid rgba(255,255,255,0.2)',
          borderTopColor: '#ff6b00',
          borderRadius: '50%',
          animation: 'rdk-boot-spin 0.75s linear infinite',
        }}
        aria-hidden
      />
      <p style={{ margin: 0, fontSize: 14, textAlign: 'center', padding: '0 24px', maxWidth: 400 }}>
        {msg}
      </p>
    </div>
  );
}

/** 双 rAF：避免 setState 后立刻改 location，首帧仍是白屏 */
function afterNextPaint(cb: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(cb);
  });
}

export interface SSOUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

interface AuthState {
  loading: boolean;
  ssoEnabled: boolean;
  ssoRequired: boolean;
  ssoConfigured: boolean;
  user: SSOUser | null;
  loginUrl: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * 必须在 App 根部包裹，使 SSOGate 与 SsoLoginScreen 共享同一套 user；
 * 否则登录页内 refresh() 只更新本组件 state，门禁一直认为未登录。
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoRequired, setSsoRequired] = useState(false);
  const [ssoConfigured, setSsoConfigured] = useState(false);
  const [user, setUser] = useState<SSOUser | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [logoutUiPhase, setLogoutUiPhase] = useState<LogoutUiPhase>(null);

  const refresh = useCallback(async () => {
    const SSO_FETCH_MS = 12_000;
    const fetchSso = (path: string) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SSO_FETCH_MS);
      return fetchApi(path, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    };
    const [meRes, loginRes] = await Promise.all([
      fetchSso('/api/sso/me'),
      fetchSso('/api/sso/login'),
    ]);
    const meData = (await meRes.json()) as {
      enabled?: boolean;
      required?: boolean;
      configured?: boolean;
      user?: SSOUser | null;
      sessionId?: string;
    };
    const loginData = (await loginRes.json()) as {
      enabled?: boolean;
      required?: boolean;
      configured?: boolean;
      loginUrl?: string;
    };

    const enabled = !!(meData.enabled || loginData.enabled);
    const required = !!(meData.required || loginData.required);
    const configured = !!(meData.configured || loginData.configured);
    const fetchedUser = meData.user ?? null;
    const fetchedLoginUrl = loginData.loginUrl ?? null;

    setSsoEnabled(enabled);
    setSsoRequired(required);
    setSsoConfigured(configured);
    setUser(fetchedUser);
    setLoginUrl(fetchedLoginUrl);
    if (fetchedUser && meData.sessionId) {
      setSsoSessionMirror(meData.sessionId);
    } else if (!fetchedUser) {
      setSsoSessionMirror(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch {
        if (!cancelled) {
          setSsoEnabled(false);
          setSsoRequired(false);
          setSsoConfigured(false);
          setUser(null);
          setLoginUrl(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      const res = await fetchApi('/api/sso/logout', {
        method: 'POST',
      });
      const data = (await res.json()) as { logoutUrl?: string };
      setUser(null);
      setSsoSessionMirror(null);
      const logoutUrl = data.logoutUrl?.trim();
      if (logoutUrl) {
        setLogoutUiPhase('redirect');
        afterNextPaint(() => {
          window.location.replace(logoutUrl);
        });
      } else {
        setLogoutUiPhase('reload');
        afterNextPaint(() => {
          window.location.reload();
        });
      }
    } catch {
      setLogoutUiPhase('reload');
      afterNextPaint(() => {
        window.location.reload();
      });
    }
  }, []);

  const value = useMemo(
    () => ({
      loading,
      ssoEnabled,
      ssoRequired,
      ssoConfigured,
      user,
      loginUrl,
      refresh,
      logout,
    }),
    [loading, ssoEnabled, ssoRequired, ssoConfigured, user, loginUrl, refresh, logout],
  );

  return (
    <AuthContext.Provider value={value}>
      <AuthDailyActiveHost />
      {children}
      {logoutUiPhase ? <LogoutTransitionOverlay phase={logoutUiPhase} /> : null}
    </AuthContext.Provider>
  );
}

/** 身份就绪后上报日活（SSO：登录展示名；非强制 SSO 且无用户：匿名） */
function AuthDailyActiveHost() {
  const { loading, user, ssoRequired } = useAuth();
  useSessionDailyActivePing(loading, user);
  useGuestDailyActivePing(loading, ssoRequired, user);
  return null;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
