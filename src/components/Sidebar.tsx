import { useAppState } from '../hooks/useAppState';

export default function Sidebar() {
  const {
    devices, activeDevice, setActiveDevice, setActiveTab, activeTab,
    setShowAddDevice, setShowSettings,
  } = useAppState();

  return (
    <div className="app-sidebar">
      <div className="sidebar-brand cursor-pointer" onClick={() => setActiveTab('dashboard')} style={{ cursor: 'pointer' }}>
        RDK Studio
      </div>

      <div className="section-label">我的设备</div>
      <div className="device-list">
        {devices.map(dev => (
          <div
            key={dev.id}
            className={`device-item ${activeDevice === dev.id ? 'active' : ''}`}
            onClick={() => { setActiveDevice(dev.id); setActiveTab('dashboard'); }}
          >
            <div className="device-icon">🖧</div>
            <div className="device-info">
              <h4 className="device-name">{dev.name}</h4>
              <div className="device-status">
                <span className={`status-dot ${dev.status === 'offline' ? 'offline' : ''}`}></span>
                {dev.status === 'online' ? dev.ip : 'Disconnected'}
              </div>
            </div>
          </div>
        ))}
        <button className="clean-btn outline-btn" style={{ marginTop: '10px', padding: '8px', fontSize: '0.85rem' }} onClick={() => setShowAddDevice(true)}>
          + 扫描 / 添加设备
        </button>
      </div>

      <div className="section-label">基础工具箱</div>
      <div className="sidebar-tools">
        {([
          ['flasher', '💽', '镜像烧录'],
          ['files', '📁', '文件资源'],
          ['terminal', '💻', 'SSH 终端'],
          ['vnc', '🖥️', '远程桌面'],
          ['lowcode', '🧩', '流程编排'],
          ['hardware', '🏥', '硬件诊断'],
        ] as const).map(([tab, icon, label]) => (
          <button key={tab} className={`tool-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            <span style={{ fontSize: '1.2rem', width: '24px', textAlign: 'center', display: 'inline-block' }}>{icon}</span> {label}
          </button>
        ))}
      </div>

      <div className="sidebar-footer" style={{ marginTop: 'auto', borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button className="tool-btn" onClick={() => window.open('https://developer.horizon.cc/', '_blank')}>
          <span style={{ fontSize: '1.2rem', width: '24px', textAlign: 'center', display: 'inline-block' }}>🍠</span> <span style={{ color: '#ff6b00', fontWeight: 'bold' }}>地瓜开发者社区</span>
        </button>
        <button className="tool-btn" onClick={() => setShowSettings(true)}>
          <span style={{ fontSize: '1.2rem', width: '24px', textAlign: 'center', display: 'inline-block' }}>⚙️</span> 客户端设置
        </button>
      </div>
    </div>
  );
}
