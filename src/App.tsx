import { useEffect, type ReactNode } from 'react';
import { AppProvider, useAppState } from './hooks/useAppState';
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

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
