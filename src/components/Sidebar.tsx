import { useAppState } from '../hooks/useAppState';

export default function Sidebar() {

const Icons: Record<string, React.ReactNode> = {
  terminal: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>,
  ide: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>,
  files: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>,
  vnc: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>,
  hardware: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>,
  flasher: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>,
  ros: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>,
  models: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
};

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
            <div className="device-icon material-symbols-outlined" style={{ fontSize: "28px" }}>🖧</div>
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

      <div className="section-label">开发工具</div>
      <div className="sidebar-tools">
        {([
  ['terminal', '终端'],
  ['ide', '代码编辑'],
  ['files', '文件管理'],
  ['vnc', '远程桌面'],
  ['hardware', '硬件监控'],
  ['flasher', '系统烧录'],
] as const).map(([tab, label]) => (
          <button key={tab} className={`tool-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            <span className="tool-icon" style={{display:"flex",alignItems:"center",justifyContent:"center"}}>{Icons[tab]}</span> <span style={{marginLeft:"8px"}}>{label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="tool-btn" onClick={() => window.open('https://developer.d-robotics.cc/cloud', '_blank')}>
          <span className="material-symbols-outlined nav-icon" style={{fontSize:"18px"}}>cloud</span> <span className="tool-highlight">具身云平台</span>
        </button>
        <button className="tool-btn" onClick={() => window.open('https://developer.d-robotics.cc/', '_blank')}>
          <span className="tool-icon material-symbols-outlined" style={{ fontSize: "20px", display: "inline-block", verticalAlign: "middle" }}>🍠</span> <span className="tool-highlight">开发者社区</span>
        </button>
        <button className="tool-btn" onClick={() => setShowSettings(true)}>
          <span className="material-symbols-outlined nav-icon" style={{fontSize:"18px"}}>settings</span> 设置
        </button>
      </div>
    </div>
  );
}
