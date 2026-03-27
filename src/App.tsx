import { useEffect, useMemo, type ReactNode } from 'react';
import { AppProvider, useAppState } from './hooks/useAppState';
import { useI18n } from './i18n/use-i18n';
import { AuthProvider, useAuth } from './hooks/useAuth';
import SsoLoginScreen from './components/SsoLoginScreen';
import { ssoTranslate as st } from './i18n/sso-translate';
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
import Ros from './components/Ros';
import SkillBrowser from './components/SkillBrowser';
import Examples from './components/Examples';
import Models from './components/Models';
import LowcodeStub from './components/lowcode-stub';
import ErrorBoundary from './components/ErrorBoundary';
import OpenClawDeployPollHost from './components/OpenClawDeployPollHost';

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
    hardware: <Hardware />,
    ros: <Ros />,
    skills: <SkillBrowser />,
    examples: <Examples />,
    models: <Models />,
    lowcode: <LowcodeStub />,
  };

  return (
    <>
      {standardViews[activeTab] && (
        <div className="page-slot page-enter">
          {standardViews[activeTab]}
        </div>
      )}
      <div className={`persistent-pane ${activeTab === 'openclaw' ? 'is-active' : 'is-hidden'}`}>
        <OpenClaw />
      </div>
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
  const { activeTab, currentDevice, theme, railExpanded, obStep } = useAppState();
  const { t } = useI18n();
  useDesktopTabSync(activeTab);
  useDesktopViewBounds(activeTab);
  useThemeSync();

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
      ros: t('tabs.ros', 'ROS'),
      examples: t('tabs.examples', 'NodeHub'),
      models: t('tabs.models', 'ModelZoo'),
      lowcode: t('tabs.lowcode', '低代码'),
    };
    return names[activeTab] ?? activeTab;
  }, [activeTab, t]);

  const deviceOnline = !!currentDevice && currentDevice.status !== 'offline' && currentDevice.status !== 'disconnected';
  const onboardingActive = obStep !== 'done';

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
        {!onboardingActive && <AIDock />}
      </main>

      <Toasts />
      <AddDeviceModal />
      <SettingsPanel />
      <ConfirmDialog />
    </div>
  );
}

function SSOGate({ children }: { children: ReactNode }) {
  const { loading, ssoEnabled, ssoRequired, user } = useAuth();

  if (loading) {
    return (
      <div className="sso-login-root">
        <div className="sso-login-state">
          <div className="sso-login-spinner" aria-hidden />
          <p className="sso-login-state-text">{st('sso.verifying', '正在验证身份…')}</p>
        </div>
      </div>
    );
  }

  if ((ssoRequired || ssoEnabled) && !user) {
    return <SsoLoginScreen />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <SSOGate>
          <AppShell />
        </SSOGate>
      </AppProvider>
    </AuthProvider>
  );
}
