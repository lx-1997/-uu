import { useState, useEffect, useCallback } from 'react';
import { resolveApiUrl } from '../utils/apiBase';

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

let cachedState: {
  ssoEnabled: boolean;
  ssoRequired: boolean;
  ssoConfigured: boolean;
  user: SSOUser | null;
  loginUrl: string | null;
} | null = null;

export function useAuth(): AuthState {
  const [loading, setLoading] = useState(!cachedState);
  const [ssoEnabled, setSsoEnabled] = useState(cachedState?.ssoEnabled ?? false);
  const [ssoRequired, setSsoRequired] = useState(cachedState?.ssoRequired ?? false);
  const [ssoConfigured, setSsoConfigured] = useState(cachedState?.ssoConfigured ?? false);
  const [user, setUser] = useState<SSOUser | null>(cachedState?.user ?? null);
  const [loginUrl, setLoginUrl] = useState<string | null>(cachedState?.loginUrl ?? null);

  const refresh = useCallback(async () => {
    const [meRes, loginRes] = await Promise.all([
      fetch(resolveApiUrl('/api/sso/me'), { credentials: 'include' }),
      fetch(resolveApiUrl('/api/sso/login')),
    ]);
    const meData = (await meRes.json()) as { enabled?: boolean; required?: boolean; configured?: boolean; user?: SSOUser | null };
    const loginData = (await loginRes.json()) as { enabled?: boolean; required?: boolean; configured?: boolean; loginUrl?: string };

    const enabled = !!(meData.enabled || loginData.enabled);
    const required = !!(meData.required || loginData.required);
    const configured = !!(meData.configured || loginData.configured);
    const fetchedUser = meData.user ?? null;
    const fetchedLoginUrl = loginData.loginUrl ?? null;

    cachedState = { ssoEnabled: enabled, ssoRequired: required, ssoConfigured: configured, user: fetchedUser, loginUrl: fetchedLoginUrl };
    setSsoEnabled(enabled);
    setSsoRequired(required);
    setSsoConfigured(configured);
    setUser(fetchedUser);
    setLoginUrl(fetchedLoginUrl);
  }, []);

  useEffect(() => {
    if (cachedState) return;

    let cancelled = false;

    (async () => {
      try {
        await refresh();
      } catch {
        cachedState = { ssoEnabled: false, ssoRequired: false, ssoConfigured: false, user: null, loginUrl: null };
        setSsoEnabled(false);
        setSsoRequired(false);
        setSsoConfigured(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      const res = await fetch(resolveApiUrl('/api/sso/logout'), { method: 'POST', credentials: 'include' });
      const data = (await res.json()) as { logoutUrl?: string };
      cachedState = null;
      setUser(null);
      if (data.logoutUrl) {
        window.location.href = data.logoutUrl;
      } else {
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  }, []);

  return { loading, ssoEnabled, ssoRequired, ssoConfigured, user, loginUrl, refresh, logout };
}
