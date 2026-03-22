import { useState, useEffect, useCallback } from 'react';

export interface SSOUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

interface AuthState {
  loading: boolean;
  ssoEnabled: boolean;
  user: SSOUser | null;
  loginUrl: string | null;
  logout: () => Promise<void>;
}

let cachedState: { ssoEnabled: boolean; user: SSOUser | null; loginUrl: string | null } | null = null;

export function useAuth(): AuthState {
  const [loading, setLoading] = useState(!cachedState);
  const [ssoEnabled, setSsoEnabled] = useState(cachedState?.ssoEnabled ?? false);
  const [user, setUser] = useState<SSOUser | null>(cachedState?.user ?? null);
  const [loginUrl, setLoginUrl] = useState<string | null>(cachedState?.loginUrl ?? null);

  useEffect(() => {
    if (cachedState) return;

    let cancelled = false;

    (async () => {
      try {
        const [meRes, loginRes] = await Promise.all([
          fetch('/api/sso/me', { credentials: 'include' }),
          fetch('/api/sso/login'),
        ]);

        if (cancelled) return;

        const meData = (await meRes.json()) as { enabled?: boolean; user?: SSOUser | null };
        const loginData = (await loginRes.json()) as { enabled?: boolean; loginUrl?: string };

        const enabled = !!meData.enabled;
        const fetchedUser = meData.user ?? null;
        const fetchedLoginUrl = loginData.loginUrl ?? null;

        cachedState = { ssoEnabled: enabled, user: fetchedUser, loginUrl: fetchedLoginUrl };
        setSsoEnabled(enabled);
        setUser(fetchedUser);
        setLoginUrl(fetchedLoginUrl);
      } catch {
        cachedState = { ssoEnabled: false, user: null, loginUrl: null };
        setSsoEnabled(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const logout = useCallback(async () => {
    try {
      const res = await fetch('/api/sso/logout', { method: 'POST', credentials: 'include' });
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

  return { loading, ssoEnabled, user, loginUrl, logout };
}
