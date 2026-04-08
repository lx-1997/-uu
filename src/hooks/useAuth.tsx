import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useSessionDailyActivePing, useGuestDailyActivePing } from '../analytics/useDailyActivePing';
import { ssoTranslate as st } from '../i18n/sso-translate';
import { isStudioLoginRequired } from '../utils/studio-auth-gate';
import { fetchApi, getSsoSessionMirrorId, setSsoSessionMirror } from '../utils/apiBase';

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

/** 服务端在未启用 SSO 时返回 logoutUrl: '/'；整页 replace 会造成文档切换期浏览器白屏，改为软登出 */
function isSameAppSoftLogoutTarget(url: string): boolean {
  const t = url.trim();
  if (!t || t === '/') return true;
  try {
    const u = new URL(t, window.location.href);
    return (
      u.origin === window.location.origin
      && (u.pathname === '/' || u.pathname === '')
      && u.search === ''
      && u.hash === ''
    );
  } catch {
    return false;
  }
}

/**
 * 浏览器：整页跳统一认证登出端点。
 * Electron（file://）：主窗口内 location.replace 常被拦或把整个应用导航走；改用系统浏览器打开 SSO 登出后再 reload。
 */
function navigateAfterSsoLogout(logoutUrl: string): void {
  const url = logoutUrl.trim();
  const desk = typeof window !== 'undefined' ? window.rdkDesktop : undefined;
  afterNextPaint(() => {
    if (desk?.openSsoExternal && /^https:\/\//i.test(url)) {
      void Promise.resolve(desk.openSsoExternal(url)).finally(() => {
        window.location.reload();
      });
      return;
    }
    window.location.replace(url);
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
  refresh: (opts?: { signal?: AbortSignal }) => Promise<void>;
  /** 桌面环回 /api/sso/bootstrap 成功后立即写入，避免紧随其后的 refresh 因 Cookie/镜像时序误清会话 */
  adoptBootstrapSession: (user: SSOUser, sessionId: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** 仅存展示字段（非密钥）；须与 localStorage 会话镜像同时存在才在冷启动时恢复，避免误显登录态 */
const SSO_USER_SNAPSHOT_KEY = 'rdk_sso_user_snapshot';

function readUserSnapshotIfMirrored(): SSOUser | null {
  if (!getSsoSessionMirrorId()) return null;
  try {
    const raw = sessionStorage.getItem(SSO_USER_SNAPSHOT_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as SSOUser;
    if (u && typeof u.id === 'string') return u;
  } catch {
    /* noop */
  }
  return null;
}

function writeUserSnapshot(user: SSOUser | null): void {
  try {
    if (user?.id) {
      sessionStorage.setItem(SSO_USER_SNAPSHOT_KEY, JSON.stringify(user));
    } else {
      sessionStorage.removeItem(SSO_USER_SNAPSHOT_KEY);
    }
  } catch {
    /* noop */
  }
}

function clearUserSnapshot(): void {
  try {
    sessionStorage.removeItem(SSO_USER_SNAPSHOT_KEY);
  } catch {
    /* noop */
  }
}

/** 合并 AbortSignal：任一 abort 则返回的 signal 触发 abort（Chromium 有 AbortSignal.any 时优先使用） */
function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any === 'function') {
    return (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([a, b]);
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (a.aborted || b.aborted) {
    ctrl.abort();
    return ctrl.signal;
  }
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return ctrl.signal;
}

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
  /** 上次由 /api/sso/me 确认的用户；用于避免瞬时网络/丢 Cookie 导致误清登录态（内存 + 冷启动时从 snapshot 回补） */
  const lastConfirmedUserRef = useRef<SSOUser | null>(null);
  /**
   * 并发/超时取消：每次新 refresh 或 adoptBootstrapSession 会递增；过期的 refresh 不再 setState，
   * 避免首屏 boot 超时后仍把界面写回「已登录」或卡在验证态。
   */
  const refreshGenRef = useRef(0);
  /** 桌面环回 /api/sso/bootstrap 成功时刻，供 refresh 宽限期判断 */
  const lastBootstrapAtRef = useRef(0);

  const adoptBootstrapSession = useCallback((nextUser: SSOUser, sessionId: string) => {
    refreshGenRef.current += 1;
    lastBootstrapAtRef.current = Date.now();
    lastConfirmedUserRef.current = nextUser;
    writeUserSnapshot(nextUser);
    setSsoSessionMirror(sessionId);
    setUser(nextUser);
    setSsoEnabled(true);
    setSsoRequired(true);
  }, []);

  const refresh = useCallback(async (opts?: { signal?: AbortSignal }) => {
    const gen = (refreshGenRef.current += 1);
    const stale = () => gen !== refreshGenRef.current;
    const bootSignal = opts?.signal;

    if (!lastConfirmedUserRef.current) {
      const snap = readUserSnapshotIfMirrored();
      if (snap) lastConfirmedUserRef.current = snap;
    }

    /** 单次请求上限；首屏另传 bootSignal，总时长由 boot 的 AbortController 截断 */
    const SSO_FETCH_MS = 10_000;
    const PAIR_RETRIES = 3;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const fetchSso = (path: string) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SSO_FETCH_MS);
      const signal = bootSignal ? mergeAbortSignals(ctrl.signal, bootSignal) : ctrl.signal;
      return fetchApi(path, { signal }).finally(() => clearTimeout(timer));
    };

    const parseMeLoginPair = async () => {
      if (stale()) throw new Error('SSO refresh superseded');
      const [meRes, loginRes] = await Promise.all([fetchSso('/api/sso/me'), fetchSso('/api/sso/login')]);
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
      return { meData, loginData };
    };

    let pair: Awaited<ReturnType<typeof parseMeLoginPair>> | null = null;
    for (let attempt = 0; attempt < PAIR_RETRIES; attempt++) {
      try {
        pair = await parseMeLoginPair();
        break;
      } catch (err) {
        if (stale()) return;
        if (err instanceof Error && err.name === 'AbortError') {
          throw err;
        }
        if (attempt < PAIR_RETRIES - 1) {
          await wait(350 * (attempt + 1));
          continue;
        }
        if (lastConfirmedUserRef.current) {
          if (!stale()) setUser((prev) => prev ?? lastConfirmedUserRef.current);
          return;
        }
        const mirrorOnly = !!getSsoSessionMirrorId();
        if (mirrorOnly) {
          try {
            const loginRes = await fetchSso('/api/sso/login');
            const loginData = (await loginRes.json()) as {
              enabled?: boolean;
              required?: boolean;
              configured?: boolean;
              loginUrl?: string;
            };
            if (!stale()) {
              setSsoEnabled(!!loginData.enabled);
              setSsoRequired(!!loginData.required);
              setSsoConfigured(!!loginData.configured);
              setLoginUrl(loginData.loginUrl ?? null);
            }
          } catch {
            /* keep prior flags */
          }
          return;
        }
        throw new Error('SSO refresh failed');
      }
    }

    if (!pair) return;
    if (stale()) return;

    const { meData, loginData } = pair;
    const enabled = !!(meData.enabled || loginData.enabled);
    const required = !!(meData.required || loginData.required);
    const configured = !!(meData.configured || loginData.configured);
    const fetchedLoginUrl = loginData.loginUrl ?? null;
    let fetchedUser = meData.user ?? null;

    if (!stale()) {
      setSsoEnabled(enabled);
      setSsoRequired(required);
      setSsoConfigured(configured);
      setLoginUrl(fetchedLoginUrl);
    }

    if (fetchedUser) {
      lastConfirmedUserRef.current = fetchedUser;
      writeUserSnapshot(fetchedUser);
      if (!stale()) {
        setUser(fetchedUser);
        if (meData.sessionId) {
          setSsoSessionMirror(meData.sessionId);
        }
      }
      return;
    }

    const stickySession =
      lastConfirmedUserRef.current !== null
      || !!getSsoSessionMirrorId();

    if (stickySession) {
      /** 首次与 /api/sso/me 并发返回空常见（Cookie 刚写入）；先立即重试，避免固定 320ms 起步等待 */
      const stickyDelaysMs = [0, 120, 280, 450];
      for (let i = 0; i < stickyDelaysMs.length; i++) {
        if (stale()) return;
        if (stickyDelaysMs[i] > 0) await wait(stickyDelaysMs[i]);
        try {
          const meRes = await fetchSso('/api/sso/me');
          const md = (await meRes.json()) as {
            user?: SSOUser | null;
            sessionId?: string;
          };
          if (md.user) {
            fetchedUser = md.user;
            lastConfirmedUserRef.current = fetchedUser;
            writeUserSnapshot(fetchedUser);
            if (!stale()) {
              setUser(fetchedUser);
              if (md.sessionId) {
                setSsoSessionMirror(md.sessionId);
              }
            }
            return;
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            throw err;
          }
          /* next retry */
        }
      }
    }

    /**
     * 禁止在此处用 lastConfirmedUserRef「补回」界面用户：
     * 服务端已明确返回无 user（会话过期、鉴权失败）时，若仍写回快照，会出现 Toast/接口 401
     * 与「仍显示已登录并进入主界面」不一致。粘滞重试仅用于 Cookie/镜像尚未生效的前几秒。
     *
     * 例外：刚完成桌面环回 bootstrap 后，紧随其后的 refresh 可能与 Cookie/镜像头竞态，/api/sso/me 偶发空；
     * 此时勿秒清会话，否则表现「登录成功却进不了主界面」。
     */
    const bootstrapGraceMs = 12_000;
    if (
      lastBootstrapAtRef.current > 0
      && Date.now() - lastBootstrapAtRef.current < bootstrapGraceMs
      && lastConfirmedUserRef.current
      && getSsoSessionMirrorId()
    ) {
      if (!stale()) {
        setUser(lastConfirmedUserRef.current);
      }
      return;
    }

    lastConfirmedUserRef.current = null;
    clearUserSnapshot();
    if (!stale()) {
      setUser(null);
      setSsoSessionMirror(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    /** 首屏总超时：中止所有 SSO fetch，避免挂起导致永远「正在验证身份…」 */
    const bootRefreshMs = 28_000;
    const bootAbort = new AbortController();
    const bootTimer = setTimeout(() => bootAbort.abort(), bootRefreshMs);
    (async () => {
      try {
        await refresh({ signal: bootAbort.signal });
      } catch {
        if (!cancelled) {
          setSsoEnabled(false);
          /* 拉取失败时勿「放行」：否则未登录也能进主界面，仅接口 401（与产品门禁一致） */
          setSsoRequired(true);
          setSsoConfigured(false);
          setUser(null);
          setLoginUrl(null);
        }
      } finally {
        clearTimeout(bootTimer);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      bootAbort.abort();
      refreshGenRef.current += 1;
    };
  }, [refresh]);

  /** 业务 API 返回 401 unauthorized 时与界面「仍显示已登录」对齐：清会话并回到登录门禁 */
  useEffect(() => {
    const onSessionLost = () => {
      refreshGenRef.current += 1;
      lastConfirmedUserRef.current = null;
      clearUserSnapshot();
      setSsoSessionMirror(null);
      setUser(null);
    };
    window.addEventListener('rdk-sso-session-lost', onSessionLost);
    return () => window.removeEventListener('rdk-sso-session-lost', onSessionLost);
  }, []);

  const logout = useCallback(async () => {
    lastConfirmedUserRef.current = null;
    clearUserSnapshot();
    try {
      const res = await fetchApi('/api/sso/logout', {
        method: 'POST',
      });
      const data = (await res.json().catch(() => ({}))) as { logoutUrl?: string };
      const logoutUrl = data.logoutUrl?.trim() ?? '';
      setSsoSessionMirror(null);

      if (!res.ok) {
        flushSync(() => {
          setUser(null);
          setLogoutUiPhase('reload');
        });
        afterNextPaint(() => {
          window.location.reload();
        });
        return;
      }

      if (logoutUrl && isSameAppSoftLogoutTarget(logoutUrl)) {
        flushSync(() => {
          setLogoutUiPhase('reload');
        });
        try {
          await refresh();
        } finally {
          setLogoutUiPhase(null);
        }
        return;
      }

      flushSync(() => {
        setUser(null);
        setLogoutUiPhase(logoutUrl ? 'redirect' : 'reload');
      });
      if (logoutUrl) {
        navigateAfterSsoLogout(logoutUrl);
      } else {
        afterNextPaint(() => {
          window.location.reload();
        });
      }
    } catch {
      flushSync(() => {
        setLogoutUiPhase('reload');
      });
      afterNextPaint(() => {
        window.location.reload();
      });
    }
  }, [refresh]);

  const value = useMemo(
    () => ({
      loading,
      ssoEnabled,
      ssoRequired,
      ssoConfigured,
      user,
      loginUrl,
      refresh,
      adoptBootstrapSession,
      logout,
    }),
    [loading, ssoEnabled, ssoRequired, ssoConfigured, user, loginUrl, refresh, adoptBootstrapSession, logout],
  );

  return (
    <AuthContext.Provider value={value}>
      <AuthDailyActiveHost />
      {children}
      {logoutUiPhase ? <LogoutTransitionOverlay phase={logoutUiPhase} /> : null}
    </AuthContext.Provider>
  );
}

/** 身份就绪后上报日活（SSO：登录展示名；仅 VITE_ALLOW_ANONYMOUS 时匿名 PV） */
function AuthDailyActiveHost() {
  const { loading, user, ssoRequired } = useAuth();
  const loginRequired = isStudioLoginRequired(ssoRequired);
  useSessionDailyActivePing(loading, user);
  useGuestDailyActivePing(loading, loginRequired, user);
  return null;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
