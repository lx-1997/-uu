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
import Lowcode from './components/Lowcode';

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

  return (
    <div className="page-transition" key={activeTab}>
      {activeTab === 'dashboard' && <Dashboard />}
      {activeTab === 'flasher' && <Flasher />}
      {activeTab === 'terminal' && <Terminal />}
      {activeTab === 'files' && <Files />}
      {activeTab === 'vnc' && <Vnc />}
      {activeTab === 'ide' && <IDE />}
      {activeTab === 'openclaw' && <OpenClaw />}
      {activeTab === 'hardware' && <Hardware />}
      {activeTab === 'examples' && <Examples />}
      {activeTab === 'ros' && <Ros />}
      {activeTab === 'models' && <Models />}
      {activeTab === 'lowcode' && <Lowcode />}
    </div>
  );
}

function AppShell() {
  const { activeTab } = useAppState();
  return (
    <div className="canvas-shell">
      <div className="layout-container">
        <Sidebar />
        <div className="main-area">
          <TopToolbar />
          <div className={`canvas-viewport ${['terminal','ide','vnc','hardware','ros','lowcode'].includes(activeTab) ? 'viewport-terminal' : ''}`}>
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
