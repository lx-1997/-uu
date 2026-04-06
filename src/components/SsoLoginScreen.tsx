import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, type SSOUser } from '../hooks/useAuth';
import { useToastStore } from '../hooks/useToastStore';
import { useI18n } from '../i18n/use-i18n';
import { ssoTranslate as st } from '../i18n/sso-translate';
import LegalDocumentModal, { type LegalDocKind } from './LegalDocumentModal';
import { fetchApi, setSsoSessionMirror } from '../utils/apiBase';

type Phase = 'preparing' | 'ready' | 'error';

/** 内嵌页就绪前的极短过渡，过长会拖慢「可点登录」的体感 */
const READY_DELAY_MS = 80;
const FALLBACK_SSO = 'https://sso.d-robotics.cc/';

export default function SsoLoginScreen() {
  const { ssoConfigured, loginUrl, refresh, adoptBootstrapSession } = useAuth();
  const { t } = useI18n();
  const [legalKind, setLegalKind] = useState<LegalDocKind | null>(null);

  /** 浏览器内嵌：服务端 OAuth URL；缺失时仍展示官方 SSO 门户 */
  const displayLoginUrl = loginUrl || FALLBACK_SSO;
  const { addToast } = useToastStore();
  const [phase, setPhase] = useState<Phase>('preparing');
  const [loadError, setLoadError] = useState('');
  const [embedLoadFailed, setEmbedLoadFailed] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [prepareBump, setPrepareBump] = useState(0);
  const [authStatus, setAuthStatus] = useState<'idle' | 'checking' | 'failed'>('idle');
  const [desktopSsoUrl, setDesktopSsoUrl] = useState('');
  const readyTimerRef = useRef(0);
  const webviewRef = useRef<HTMLElement | null>(null);

  const desktopCapable = typeof window !== 'undefined' && !!window.rdkDesktop?.prepareSsoEmbedded;

  const loginFrameUrl = useMemo(() => {
    if (!displayLoginUrl) return '';
    if (displayLoginUrl.includes('redirect=') || displayLoginUrl.includes('redirectUrl=')) {
      return displayLoginUrl;
    }
    const sep = displayLoginUrl.includes('?') ? '&' : '?';
    return `${displayLoginUrl}${sep}embed=1`;
  }, [displayLoginUrl]);

  const scheduleReady = useCallback(() => {
    window.clearTimeout(readyTimerRef.current);
    setPhase('preparing');
    readyTimerRef.current = window.setTimeout(() => {
      setPhase('ready');
    }, READY_DELAY_MS);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(readyTimerRef.current);
  }, []);

  /* 浏览器：内嵌 SSO 门户（有 OAuth 配置时 loginUrl 为 authorize 或带 redirect 的门户链接） */
  useEffect(() => {
    if (desktopCapable) return;
    if (!displayLoginUrl) {
      setPhase('error');
      setLoadError(st('sso.embedFailed', '无法启动登录回调服务，请重试。'));
      return;
    }
    setEmbedLoadFailed(false);
    setLoadError('');
    scheduleReady();
  }, [displayLoginUrl, scheduleReady, prepareBump, desktopCapable, st]);

  /* 桌面端：主进程起 127.0.0.1 回调，与 rdkstudio_frontend-master 一致 */
  useEffect(() => {
    if (!desktopCapable) return;
    let cancelled = false;
    setPhase('preparing');
    setLoadError('');
    setEmbedLoadFailed(false);
    setDesktopSsoUrl('');

    void (async () => {
      try {
        const res = await window.rdkDesktop!.prepareSsoEmbedded!();
        if (cancelled) return;
        if (!res?.ok || !res?.ssoUrl) {
          setLoadError(String(res?.error || st('sso.embedFailed', '无法启动登录回调服务，请重试。')));
          setPhase('error');
          return;
        }
        setDesktopSsoUrl(res.ssoUrl);
        scheduleReady();
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : st('sso.embedFailed', '无法启动登录回调服务，请重试。'));
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      void window.rdkDesktop?.stopSsoEmbedded?.();
      setDesktopSsoUrl('');
    };
  }, [desktopCapable, scheduleReady, prepareBump, st]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        if (!cancelled) setAuthStatus('checking');
        await refresh();
        if (!cancelled) setAuthStatus('idle');
      } catch {
        if (!cancelled) setAuthStatus('failed');
      }
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  /* 桌面：环回 token → 后端 bootstrap → HttpOnly 会话 */
  useEffect(() => {
    if (!desktopCapable || !window.rdkDesktop?.onSsoToken) return;
    const unsub = window.rdkDesktop.onSsoToken(async (payload: { token?: string }) => {
      const token = payload?.token;
      if (!token) return;
      try {
        const r = await fetchApi('/api/sso/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: token }),
        });
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          code?: string;
          sessionId?: string;
          user?: SSOUser;
        };
        if (!r.ok || !data?.ok) {
          if (data?.code === 'SSO_CLIENT_NOT_CONFIGURED') {
            addToast(
              st(
                'sso.bootstrapNeedConfig',
                '您已在 SSO 登录成功，但本应用尚未在服务端完成 OAuth 对接。请联系管理员配置 SSO_CLIENT_ID 与 SSO_CLIENT_SECRET。',
              ),
              'error',
            );
          } else {
            addToast(data?.error || st('sso.bootstrapFail', '会话建立失败'), 'error');
          }
          return;
        }
        const sid = String(data.sessionId || '').trim();
        if (data.user && sid) {
          adoptBootstrapSession(data.user, sid);
        } else if (sid) {
          setSsoSessionMirror(sid);
        }
        addToast(st('sso.loginSuccess', '登录成功'), 'success');
        void window.rdkDesktop?.stopSsoEmbedded?.();
        /** adoptBootstrapSession 已写入 user；勿 await refresh，避免与 /api/sso/me 粘滞重试叠加阻塞首帧进入主界面 */
        void refresh();
      } catch {
        addToast(st('sso.bootstrapFail', '会话建立失败'), 'error');
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [desktopCapable, refresh, addToast]);

  const openSsoPopup = useCallback(() => {
    if (window.rdkDesktop?.openSsoLoginWindow) {
      void window.rdkDesktop.openSsoLoginWindow();
      return;
    }
    const url = loginUrl || FALLBACK_SSO;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [loginUrl]);

  const retryEmbedded = async () => {
    setEmbedLoadFailed(false);
    setLoadError('');
    try {
      await refresh();
      if (desktopCapable) {
        void window.rdkDesktop?.stopSsoEmbedded?.();
        setDesktopSsoUrl('');
        setPrepareBump((b) => b + 1);
      } else {
        setIframeKey((k) => k + 1);
        setPrepareBump((b) => b + 1);
      }
    } catch {
      setPhase('error');
      setLoadError(st('sso.embedFailed', '无法启动登录回调服务，请重试。'));
    }
  };

  const errorMessage = useMemo(() => {
    if (embedLoadFailed) {
      return st(
        'sso.embedLoadFailed',
        '内嵌登录页无法加载（可能被站点策略拦截）。请使用独立窗口登录，或联系管理员。',
      );
    }
    return loadError || st('sso.embedFailed', '无法启动登录回调服务，请重试。');
  }, [embedLoadFailed, loadError, st]);

  const configBannerText = !ssoConfigured
    ? st(
        'sso.configMissing',
        '当前为浏览器内嵌登录：在下方完成 D-Robotics 账号认证后，若无法进入工作台，需在本服务器配置 SSO_CLIENT_ID / SSO_CLIENT_SECRET（授权码回调）。桌面客户端使用环回 token，无需此项。',
      )
    : '';

  const showErrorLayer = phase === 'error' || embedLoadFailed;
  const showPreparingLayer = phase === 'preparing' && !showErrorLayer;

  const showDesktopWebview = desktopCapable && phase === 'ready' && !embedLoadFailed && !!desktopSsoUrl;
  const showBrowserIframe = !desktopCapable && phase === 'ready' && !embedLoadFailed && !!loginFrameUrl;
  /** 桌面环回 token 与参考工程一致，不依赖服务端 OAuth 客户端；横幅仅提示纯浏览器内嵌时的限制 */
  const showConfigBanner = !!configBannerText && showBrowserIframe;

  useEffect(() => {
    if (!showDesktopWebview) return;
    const el = webviewRef.current;
    if (!el) return;

    const onNewWindow = (e: Event & { readonly url?: string; preventDefault?: () => void }) => {
      e.preventDefault?.();
      const next = e.url;
      if (next && 'src' in el) (el as HTMLElement & { src: string }).src = next;
    };
    const onFailLoad = (e: Event & { isMainFrame?: boolean; validatedURL?: string; errorCode?: number }) => {
      if (e?.isMainFrame === false) return;
      const u = e?.validatedURL || '';
      if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return;
      if (e?.errorCode === -3) return;
      setEmbedLoadFailed(true);
      setPhase('error');
    };

    el.addEventListener('new-window', onNewWindow as EventListener);
    el.addEventListener('did-fail-load', onFailLoad as EventListener);
    return () => {
      el.removeEventListener('new-window', onNewWindow as EventListener);
      el.removeEventListener('did-fail-load', onFailLoad as EventListener);
    };
  }, [showDesktopWebview, desktopSsoUrl]);

  return (
    <div className="sso-login-root">
      {showConfigBanner && (
        <p className="sso-login-config-banner" role="status">
          {configBannerText}
        </p>
      )}
      {showPreparingLayer && (
        <div className="sso-login-state">
          <div className="sso-login-spinner" aria-hidden />
          <p className="sso-login-state-text">{st('sso.embedPreparing', '正在加载统一登录页…')}</p>
        </div>
      )}

      {showErrorLayer && (
        <div className="sso-login-state sso-login-error">
          <p className="sso-login-state-text">{errorMessage}</p>
          <div className="sso-login-actions">
            <button type="button" className="sso-login-btn-primary" onClick={() => { void retryEmbedded(); }}>
              {st('sso.retryEmbed', '重试内嵌')}
            </button>
            <button type="button" className="sso-login-btn-secondary" onClick={openSsoPopup}>
              {st('sso.openSsoInWindow', '独立窗口登录')}
            </button>
          </div>
        </div>
      )}

      {showDesktopWebview && (
        <webview
          ref={webviewRef as React.RefObject<HTMLElement>}
          key={desktopSsoUrl}
          className="sso-login-iframe"
          src={desktopSsoUrl}
          partition="persist:sso"
          {...({ allowpopups: 'true' } as React.HTMLAttributes<HTMLElement>)}
          webpreferences={'contextIsolation=yes,nodeIntegration=no' as never}
        />
      )}

      {showBrowserIframe && (
        <>
          <iframe
            key={iframeKey}
            title={st('sso.iframeTitle', 'D-Robotics SSO')}
            className="sso-login-iframe"
            src={loginFrameUrl}
            onError={() => {
              setEmbedLoadFailed(true);
              setPhase('error');
            }}
          />
          <div className="sso-login-ready-footer">
            <span
              className={`sso-login-footer-hint${authStatus === 'failed' ? ' is-failed' : ''}`}
            >
              {authStatus === 'checking' && st('sso.statusChecking', '正在检查登录状态…')}
              {authStatus === 'failed' && st('sso.statusFailed', '登录状态检查失败，请重试或检查网络。')}
              {authStatus === 'idle' && st('sso.statusIdle', '登录成功后将自动进入工作台。')}
            </span>
            <button
              type="button"
              className="sso-login-footer-btn"
              onClick={async () => {
                try {
                  setAuthStatus('checking');
                  await refresh();
                  setAuthStatus('idle');
                } catch {
                  setAuthStatus('failed');
                }
              }}
            >
              {st('sso.refreshStatus', '刷新状态')}
            </button>
            <button type="button" className="sso-login-footer-btn" onClick={openSsoPopup}>
              {st('sso.openSsoInWindow', '独立窗口登录')}
            </button>
          </div>
        </>
      )}

      <div className="sso-login-legal" role="note">
        <span>{t('login.legal.prefix', '登录即表示您已阅读并同意')}</span>{' '}
        <button type="button" className="sso-login-legal-link" onClick={() => setLegalKind('terms')}>
          {t('legal.terms', '用户协议')}
        </button>
        <span>{t('login.legal.mid', '与')}</span>{' '}
        <button type="button" className="sso-login-legal-link" onClick={() => setLegalKind('privacy')}>
          {t('legal.privacy', '隐私政策')}
        </button>
      </div>

      {legalKind && <LegalDocumentModal kind={legalKind} onClose={() => setLegalKind(null)} />}
    </div>
  );
}
