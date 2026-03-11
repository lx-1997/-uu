import { useAppState } from '../hooks/useAppState';

export default function Sidebar() {
  const {
    devices, activeDevice, setActiveDevice, setActiveTab, activeTab,
    setShowAddDevice, setShowSettings, removeDevice,
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
        <button className="clean-btn outline-btn" style={{ marginTop: '10px', padding: '8px', fontSize: '0.85rem' }} onClick={() => setShowAddDevice(true)}>
          + 扫描 / 添加设备
        </button>
      </div>

      <div className="section-label">基础工具箱</div>
      <div className="sidebar-tools">
        {([
          ['flasher', '💽', '系统烧录'],
          ['files', '📂', '文件管理'],
          ['terminal', '💻', '终端'],
          ['vnc', '🖥️', '远程桌面'],
          ['lowcode', '🧩', '流程编排'],
          ['hardware', '📊', '硬件状态'],
        ] as const).map(([tab, icon, label]) => (
          <button key={tab} className={`tool-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            <span style={{ fontSize: '1.2rem', width: '24px', textAlign: 'center', display: 'inline-block' }}>{icon}</span> {label}
          </button>
        ))}
      </div>

      <div className="sidebar-footer" style={{ marginTop: 'auto', borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button className="tool-btn" onClick={() => window.open('https://developer.horizon.cc/cloud', '_blank')}>
          <span style={{ fontSize: '1.2rem', width: '24px', textAlign: 'center', display: 'inline-block' }}>☁️</span> <span style={{ color: '#ff6b00', fontWeight: 'bold' }}>具身云平台</span>
        </button>
        <button className="tool-btn" onClick={() => window.open('https://developer.horizon.cc/', '_blank')}>
          <span style={{ fontSize: '1.2rem', width: '24px', textAlign: 'center', display: 'inline-block' }}>🍠</span> <span style={{ color: '#ff6b00', fontWeight: 'bold' }}>开发者社区</span>
        </button>
        <button className="tool-btn" onClick={() => setShowSettings(true)}>
          <span style={{ fontSize: '1.2rem', width: '24px', textAlign: 'center', display: 'inline-block' }}>⚙️</span> 设置
        </button>
      </div>
    </div>
  );
}
