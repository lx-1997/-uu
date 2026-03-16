import { useAppState } from '../hooks/useAppState';

export default function Sidebar() {
  const {
    devices, activeDevice, setActiveDevice, setActiveTab, activeTab,
    setShowAddDevice, setShowSettings, removeDevice,
  } = useAppState();

  return (
    <div className="app-sidebar">
      <div className="sidebar-brand" onClick={() => setActiveTab('dashboard')}>
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
                {dev.status === 'online' ? `${dev.ip}:${dev.port ?? 22}` : 'Disconnected'}
              </div>
            </div>
            <button
              className="device-delete-btn"
              title="删除设备"
              onClick={e => { e.stopPropagation(); removeDevice(dev.id); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
        ))}
        <button className="clean-btn outline-btn sidebar-add-btn" onClick={() => setShowAddDevice(true)}>
          + 扫描 / 添加设备
        </button>
      </div>

      <div className="section-label">基础工具</div>
      <div className="sidebar-tools">
        {([
          ['flasher', '💽', '系统烧录'],
          ['files', '📂', '文件管理'],
          ['terminal', '💻', '终端'],
          ['ide', '📝', '代码编辑'],
          ['vnc', '🖥️', '远程桌面'],
          ['hardware', '📊', '硬件状态'],
        ] as const).map(([tab, icon, label]) => (
          <button key={tab} className={`tool-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            <span className="tool-icon">{icon}</span> {label}
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="tool-btn" onClick={() => window.open('https://developer.d-robotics.cc/cloud', '_blank')}>
          <span className="tool-icon">☁️</span> <span className="tool-highlight">具身云平台</span>
        </button>
        <button className="tool-btn" onClick={() => window.open('https://developer.d-robotics.cc/', '_blank')}>
          <span className="tool-icon">🍠</span> <span className="tool-highlight">开发者社区</span>
        </button>
        <button className="tool-btn" onClick={() => setShowSettings(true)}>
          <span className="tool-icon">⚙️</span> 设置
        </button>
      </div>
    </div>
  );
}
