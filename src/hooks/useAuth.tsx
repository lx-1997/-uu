import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useSessionDailyActivePing, useGuestDailyActivePing } from '../analytics/useDailyActivePing';
import { resolveApiUrl, fetchApi } from '../utils/apiBase';

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

  const refresh = useCallback(async () => {
    const [meRes, loginRes] = await Promise.all([
      fetch(resolveApiUrl('/api/sso/me'), { credentials: 'include' }),
      fetchApi('/api/sso/login'),
    ]);
    const meData = (await meRes.json()) as {
      enabled?: boolean;
      required?: boolean;
      configured?: boolean;
      user?: SSOUser | null;
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
      const res = await fetch(resolveApiUrl('/api/sso/logout'), {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json()) as { logoutUrl?: string };
      setUser(null);
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k?.startsWith('rdk:daily-active-session:')) sessionStorage.removeItem(k);
        }
      } catch {
        /* ignore */
      }
      if (data.logoutUrl) {
        window.location.href = data.logoutUrl;
      } else {
        window.location.reload();
      }
    } catch {
      window.location.reload();
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
