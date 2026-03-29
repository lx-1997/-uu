import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { initAnalyticsFlushListeners } from './analytics/client';
import { useStudioPresence } from './analytics/useStudioPresence';
import { useAppState } from './hooks/useAppState';
import { useI18n } from './i18n/use-i18n';
import { useAuth } from './hooks/useAuth';
import SsoLoginScreen from './components/SsoLoginScreen';
import { ssoTranslate as st } from './i18n/sso-translate';
import IconRail from './components/IconRail';
import TopToolbar from './components/TopToolbar';
import AIDock from './components/AIDock';
import Toasts from './components/Toasts';
import AddDeviceModal from './components/AddDeviceModal';
import SettingsPanel from './components/SettingsPanel';
import ConfirmDialog from './components/ConfirmDialog';
import ErrorBoundary from './components/ErrorBoundary';
import OpenClawDeployPollHost from './components/OpenClawDeployPollHost';
import StudioBrowserCaptureBridge from './components/StudioBrowserCaptureBridge';
import { isDeviceSshConnected } from './utils/device-connection';
import type { Tab } from './app-types';

const Dashboard = lazy(() => import('./components/Dashboard'));
const Flasher = lazy(() => import('./components/Flasher'));
const Terminal = lazy(() => import('./components/Terminal'));
const Files = lazy(() => import('./components/Files'));
const Vnc = lazy(() => import('./components/Vnc'));
const IDE = lazy(() => import('./components/IDE'));
const OpenClaw = lazy(() => import('./components/OpenClaw'));
const Hardware = lazy(() => import('./components/Hardware'));
const SkillBrowser = lazy(() => import('./components/SkillBrowser'));

/**
 * 路由分包加载占位。不得使用 useAppState/useI18n 等依赖 AppStateContext 的 hook：
 * Suspense fallback 在部分并发渲染路径下可能拿不到上层 Context，会触发
 * 「useAppState must be used within AppProvider」。
 */
function RouteFallback() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '52vh',
        gap: 12,
        color: '#64748b',
        fontSize: 13,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          border: '3px solid #e2e8f0',
          borderTopColor: '#ff6b00',
          borderRadius: '50%',
          animation: 'rdk-boot-spin 0.75s linear infinite',
        }}
      />
      <span>加载页面…</span>
    </div>
  );
}

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
    files: <Files />,
    hardware: <Hardware />,
    skills: <SkillBrowser />,
  };

  /* 各区域独立 Suspense，避免「一个 chunk 未好则整页 fallback」并错开并行请求 */
  return (
    <>
      {standardViews[activeTab] && (
        <Suspense fallback={<RouteFallback />}>
          <div className="page-slot page-enter">
            {standardViews[activeTab]}
          </div>
        </Suspense>
      )}
      <div className={`persistent-pane ${activeTab === 'openclaw' ? 'is-active' : 'is-hidden'}`}>
        <Suspense fallback={null}>
          <OpenClaw />
        </Suspense>
      </div>
      <div className={`persistent-pane ${activeTab === 'flasher' ? 'is-active' : 'is-hidden'}`}>
        <Suspense fallback={null}>
          <Flasher />
        </Suspense>
      </div>
      <div className={`persistent-pane ${activeTab === 'terminal' ? 'is-active' : 'is-hidden'}`}>
        <Suspense fallback={null}>
          <Terminal />
        </Suspense>
      </div>
      <div className={`persistent-pane ${activeTab === 'vnc' ? 'is-active' : 'is-hidden'}`}>
        <Suspense fallback={null}>
          <Vnc />
        </Suspense>
      </div>
      <div className={`persistent-pane ${activeTab === 'ide' ? 'is-active' : 'is-hidden'}`}>
        <Suspense fallback={null}>
          <IDE />
        </Suspense>
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

function useDesktopViewBounds(activeTab: string, railExpanded: boolean) {
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
  }, [activeTab, railExpanded]);
}

function useThemeSync() {
  const { theme } = useAppState();
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
}

function AppShell() {
  const {
    activeTab, currentDevice, theme, railExpanded,
    setChatExpanded, setActiveTab, addToast,
  } = useAppState();
  const { t } = useI18n();
  useStudioPresence(activeTab);
  useDesktopTabSync(activeTab);
  useDesktopViewBounds(activeTab, railExpanded);
  useThemeSync();

  useEffect(() => {
    const rdk = window.rdkDesktop;
    if (!rdk?.onFloatingBallActivate) return;
    return rdk.onFloatingBallActivate(() => {
      setChatExpanded(true);
    });
  }, [setChatExpanded]);

  useEffect(() => {
    const rdk = window.rdkDesktop;
    if (!rdk?.onFloatingBallMenu) return;
    return rdk.onFloatingBallMenu((payload: { action: string; tab?: string }) => {
      if (payload.action === 'navigate-tab' && payload.tab) {
        setActiveTab(payload.tab as Tab);
      }
      if (payload.action === 'screenshot-ask') {
        setChatExpanded(true);
        addToast(t('dock.floatingBall.screenshotHint', '已展开 AI 对话：可粘贴截图或使用附件发送图片'), 'info');
      }
    });
  }, [setActiveTab, setChatExpanded, addToast, t]);

  const tabTitle = useMemo(() => {
    const names: Record<string, string> = {
      dashboard: t('tabs.dashboard', '工作台'),
      openclaw: t('tabs.openclaw', 'OpenClaw'),
      skills: t('tabs.skills', '技能工坊'),
      terminal: t('tabs.terminal', '终端'),
      files: t('tabs.files', '文件'),
      vnc: t('tabs.vnc', '远程桌面'),
      ide: t('tabs.ide', 'IDE'),
      hardware: t('tabs.hardware', '硬件监控'),
      flasher: t('tabs.flasher', '烧录工具'),
    };
    return names[activeTab] ?? activeTab;
  }, [activeTab, t]);

  const deviceOnline = !!currentDevice && isDeviceSshConnected(currentDevice.status);

  return (
    <div className={`app-shell ${railExpanded ? 'rail-expanded' : ''}`}>
      <OpenClawDeployPollHost />
      <IconRail />

      <header className="top-bar">
        <div className="topbar-left">
          <span className="topbar-page-name">{tabTitle}</span>
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
        {/* 引导期间也需挂载：第 5 步「发送」会展开 Dock 并提交表单；若此处不渲染则 .dock-input 不存在 */}
        <AIDock />
      </main>

      <Toasts />
      <AddDeviceModal />
      <SettingsPanel />
      <ConfirmDialog />
      <StudioBrowserCaptureBridge />
    </div>
  );
}

function SSOGate({ children }: { children: ReactNode }) {
  const { loading, ssoRequired, user } = useAuth();

  if (loading) {
    /* 内联样式：在 index.css 尚未应用前也能呈现，避免验证阶段闪纯白 */
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
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
        <p style={{ margin: 0, fontSize: 14 }}>{st('sso.verifying', '正在验证身份…')}</p>
      </div>
    );
  }

  /** 仅「强制 SSO」时拦截；与 server ssoAuthMiddleware（!isSSORequired 则放行）一致 */
  if (ssoRequired && !user) {
    return <SsoLoginScreen />;
  }

  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    initAnalyticsFlushListeners();
    /* 默认工作台分包预热，缩短首进工作台的等待 */
    void import('./components/Dashboard');
  }, []);
  return (
    <ErrorBoundary>
      <SSOGate>
        <AppShell />
      </SSOGate>
    </ErrorBoundary>
  );
}
