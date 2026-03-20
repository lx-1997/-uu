import { useEffect } from 'react';
import './styles.css';
import './styles/openclaw.css';
import './styles/nodehub.css';
import './styles/models.css';
import './styles/ros.css';
import './styles/skills.css';
import { AppProvider, useAppState } from './hooks/useAppState';
import Sidebar from './components/Sidebar';
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

function MainContent() {
  const { isLoading, loadingMsg, activeTab } = useAppState();

  if (isLoading) {
    return (
      <div className="center-stage">
        <div className="loading-stage">
          <div className="spinner"></div>
          <div className="loading-msg">{loadingMsg}</div>
          <div className="loading-skeleton">
            <div className="skeleton-line wide"></div>
            <div className="skeleton-line medium"></div>
            <div className="skeleton-row">
              <div className="skeleton-card"></div>
              <div className="skeleton-card"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 持久化组件（terminal/vnc/ide）始终挂载，用 CSS display 控制可见性，保留连接状态
  // 非持久化组件按需渲染
  return (
    <>
      {/* 非持久化 tab */}
      {activeTab === 'dashboard' && <div className="page-transition"><Dashboard /></div>}
      {activeTab === 'flasher' && <div className="page-transition"><Flasher /></div>}
      {activeTab === 'files' && <div className="page-transition"><Files /></div>}
      {activeTab === 'openclaw' && <div className="page-transition"><OpenClaw /></div>}
      {activeTab === 'hardware' && <div className="page-transition"><Hardware /></div>}
      {activeTab === 'examples' && <div className="page-transition"><Examples /></div>}
      {activeTab === 'ros' && <div className="page-transition"><Ros /></div>}
      {activeTab === 'models' && <div className="page-transition"><Models /></div>}
      {activeTab === 'skills' && <div className="page-transition"><SkillBrowser /></div>}
      {/* 持久化 tab：始终挂载 */}
      <div style={{ display: activeTab === 'terminal' ? 'contents' : 'none' }}><Terminal /></div>
      <div style={{ display: activeTab === 'vnc' ? 'contents' : 'none' }}><Vnc /></div>
      <div style={{ display: activeTab === 'ide' ? 'contents' : 'none' }}><IDE /></div>
    </>
  );
}

/* ── 桌面端 tab 切换时同步 WebContentsView 可见性 ── */
function useDesktopTabSync(activeTab: string) {
  useEffect(() => {
    const rdk = (window as any).rdkDesktop;
    if (!rdk?.setActiveUrl) return;
    // VNC 和 IDE tab 有可能存在活跃的嵌入视图，其他 tab 时全部隐藏
    if (activeTab !== 'vnc' && activeTab !== 'ide') {
      rdk.setActiveUrl(null);
    }
    // VNC/IDE 自身组件会在 connect 时调用 openUrl，这里只处理离开时隐藏
  }, [activeTab]);
}

function AppShell() {
  const { activeTab } = useAppState();
  useDesktopTabSync(activeTab);

  useEffect(() => {
    const rdk = window.rdkDesktop;
    if (!rdk?.updateViewBounds) return;

    let rafId = 0;
    const reportBounds = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const viewport = document.querySelector('.canvas-viewport') as HTMLElement | null;
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

  return (
    <div className="canvas-shell">
      <div className="layout-container">
        <Sidebar />
        <div className="main-area">
          <TopToolbar />
          <div
            className={`canvas-viewport ${['terminal','ide','vnc','hardware','ros','openclaw'].includes(activeTab) ? 'viewport-terminal' : ''} ${activeTab === 'vnc' ? 'viewport-vnc' : ''} ${activeTab === 'ide' ? 'viewport-ide' : ''} ${activeTab === 'flasher' ? 'viewport-flasher' : ''}`}
          >
            <ErrorBoundary>
              <MainContent />
            </ErrorBoundary>
          </div>
          <AIDock />
        </div>
      </div>
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
