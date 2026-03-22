import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppProvider, useAppState } from './hooks/useAppState';
import { useAuth } from './hooks/useAuth';
import IconRail from './components/IconRail';
import TopToolbar from './components/TopToolbar';
import AIDock from './components/AIDock';
import Toasts from './components/Toasts';
import AddDeviceModal from './components/AddDeviceModal';
import SettingsPanel from './components/SettingsPanel';
import ConfirmDialog from './components/ConfirmDialog';
import Dashboard from './components/Dashboard';
import Flasher from './components/Flasher';
import Terminal from './components/Terminal';
import Files from './components/Files';
import Vnc from './components/Vnc';
import IDE from './components/IDE';
import OpenClaw from './components/OpenClaw';
import Hardware from './components/Hardware';
import Examples from './components/Examples';
import Ros from './components/Ros';
import Models from './components/Models';
import SkillBrowser from './components/SkillBrowser';
import ErrorBoundary from './components/ErrorBoundary';

const TAB_NAMES: Record<string, string> = {
  dashboard: '工作台',
  openclaw: 'OpenClaw',
  skills: 'RDKClaw 技能',
  terminal: '终端',
  files: '文件',
  vnc: '远程桌面',
  ide: 'IDE',
  hardware: '硬件监控',
  flasher: '烧录工具',
  
  ros: 'ROS',
};

function MainContent() {
  const { isLoading, loadingMsg, activeTab } = useAppState();

  if (isLoading) {
    return (
      <div className="loading-overlay">
        <div className="spinner-lg" />
        <span style={{ marginTop: 12, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{loadingMsg}</span>
      </div>
    );
  }

  const standardViews: Record<string, ReactNode> = {
    dashboard: <Dashboard />,
    flasher: <Flasher />,
    files: <Files />,
    openclaw: <OpenClaw />,
    hardware: <Hardware />,
    ros: <Ros />,
    skills: <SkillBrowser />,
  };

  return (
    <>
      {standardViews[activeTab] && (
        <div className="page-slot page-enter">
          {standardViews[activeTab]}
        </div>
      )}
      <div className={`persistent-pane ${activeTab === 'terminal' ? 'is-active' : 'is-hidden'}`}>
        <Terminal />
      </div>
      <div className={`persistent-pane ${activeTab === 'vnc' ? 'is-active' : 'is-hidden'}`}>
        <Vnc />
      </div>
      <div className={`persistent-pane ${activeTab === 'ide' ? 'is-active' : 'is-hidden'}`}>
        <IDE />
      </div>
    </>
  );
}

function useDesktopTabSync(activeTab: string) {
  useEffect(() => {
    const rdk = (window as any).rdkDesktop;
    if (!rdk?.setActiveUrl) return;
    if (activeTab !== 'vnc' && activeTab !== 'ide') {
      rdk.setActiveUrl(null);
    }
  }, [activeTab]);
}

function useDesktopViewBounds(activeTab: string) {
  useEffect(() => {
    const rdk = (window as any).rdkDesktop;
    if (!rdk?.updateViewBounds) return;

    let rafId = 0;
    const reportBounds = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const viewport = document.querySelector('.content-area') as HTMLElement | null;
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        rdk.updateViewBounds?.({
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      });
    };

    reportBounds();
    const delayTimer = window.setTimeout(reportBounds, 80);
    window.addEventListener('resize', reportBounds);

    return () => {
      window.clearTimeout(delayTimer);
      window.removeEventListener('resize', reportBounds);
      cancelAnimationFrame(rafId);
    };
  }, [activeTab]);
}

function useThemeSync() {
  const { theme } = useAppState();
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
}

function AppShell() {
  const { activeTab, currentDevice, theme } = useAppState();
  useDesktopTabSync(activeTab);
  useDesktopViewBounds(activeTab);
  useThemeSync();

  const deviceOnline = !!currentDevice && currentDevice.status !== 'offline' && currentDevice.status !== 'disconnected';

  return (
    <div className="app-shell">
      <IconRail />

      <header className="top-bar">
        <div className="topbar-left">
          <span className="topbar-page-name">{TAB_NAMES[activeTab] || activeTab}</span>
        </div>
        <div className="topbar-right">
          {currentDevice && (
            <div className="topbar-device-chip">
              <span className={`status-dot ${deviceOnline ? 'online' : 'offline'}`} />
              <span className="mono truncate" style={{ maxWidth: 180 }}>
                {currentDevice.name} · {currentDevice.ip}
              </span>
            </div>
          )}
          <TopToolbar />
        </div>
      </header>

      <main className="content-area">
        <ErrorBoundary>
          <MainContent />
        </ErrorBoundary>
        <AIDock />
      </main>

      <Toasts />
      <AddDeviceModal />
      <SettingsPanel />
      <ConfirmDialog />
    </div>
  );
}

function SSOGate({ children }: { children: ReactNode }) {
  const { loading, ssoEnabled, ssoRequired, ssoConfigured, user, loginUrl, refresh } = useAuth();
  const [authStatus, setAuthStatus] = useState<'idle' | 'checking' | 'failed'>('idle');

  useEffect(() => {
    if (!(ssoRequired || ssoEnabled) || user) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        if (!cancelled) setAuthStatus('checking');
        await refresh();
        if (!cancelled) setAuthStatus('idle');
      } catch {
        if (!cancelled) setAuthStatus('failed');
      }
    }, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh, ssoEnabled, ssoRequired, user]);

  const loginFrameUrl = useMemo(() => {
    if (!loginUrl) return '';
    if (loginUrl.includes('redirect=')) return loginUrl;
    const sep = loginUrl.includes('?') ? '&' : '?';
    return `${loginUrl}${sep}embed=1`;
  }, [loginUrl]);

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner-lg" />
        <span style={{ marginTop: 12, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          正在验证身份...
        </span>
      </div>
    );
  }

  if ((ssoRequired || ssoEnabled) && !user) {
    return (
      <div className="loading-overlay">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            width: 'min(540px, 92vw)',
            textAlign: 'center',
            padding: 24,
            borderRadius: 14,
            border: '1px solid var(--line)',
            background: 'var(--panel-bg)',
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          <h2 style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}>请先登录 D-Robotics 账号</h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            本平台与地瓜机器人社区使用相同 SSO 登录体系：
            <br />
            <a href="https://sso.d-robotics.cc/" target="_blank" rel="noreferrer noopener">
              https://sso.d-robotics.cc/
            </a>
          </p>
          {loginUrl && ssoConfigured ? (
            <>
              <div
                style={{
                  width: '100%',
                  minHeight: 520,
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--line)',
                  background: 'var(--surface-1)',
                }}
              >
                <iframe
                  title="D-Robotics SSO"
                  src={loginFrameUrl || loginUrl}
                  style={{ width: '100%', height: 520, border: 0, background: '#fff' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '0.8125rem', color: authStatus === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {authStatus === 'checking' && '正在检查登录状态...'}
                  {authStatus === 'failed' && '登录状态检查失败，请重试或检查网络。'}
                  {authStatus === 'idle' && '请在上方输入用户名和密码，成功后将自动进入平台。'}
                </span>
                <button
                  className="btn-secondary"
                  type="button"
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
                  刷新状态
                </button>
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => { window.open(loginUrl, '_blank', 'noopener,noreferrer'); }}
                >
                  新窗口登录
                </button>
              </div>
            </>
          ) : (
            <p style={{ fontSize: '0.8125rem', color: 'var(--danger)' }}>
              当前服务端未完成 SSO 客户端配置（缺少 `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET`），请先配置后再登录。
            </p>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <SSOGate>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </SSOGate>
  );
}
