import { useEffect } from 'react';
import './styles.css';
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

// 需要保持状态的 tab（切换时不卸载组件）
const PERSISTENT_TABS = ['vnc', 'ide', 'terminal'];

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

  // 非持久化 tab：按需渲染
  if (!PERSISTENT_TABS.includes(activeTab)) {
    return (
      <div className="page-transition">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'flasher' && <Flasher />}
        {activeTab === 'files' && <Files />}
        {activeTab === 'openclaw' && <OpenClaw />}
        {activeTab === 'hardware' && <Hardware />}
        {activeTab === 'examples' && <Examples />}
        {activeTab === 'ros' && <Ros />}
        {activeTab === 'models' && <Models />}
      </div>
    );
  }

  // 持久化 tab：始终挂载，用 CSS display 控制可见性，保留连接状态
  return (
    <>
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
  return (
    <div className="canvas-shell">
      <div className="layout-container">
        <Sidebar />
        <div className="main-area">
          <TopToolbar />
          <div className={`canvas-viewport ${['terminal','ide','vnc','hardware','ros'].includes(activeTab) ? 'viewport-terminal' : ''}`}>
            <MainContent />
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
