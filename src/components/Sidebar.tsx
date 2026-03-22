import type { Tab } from '../app-types';
import { useAppState } from '../hooks/useAppState';

const Icons: Record<string, React.ReactNode> = {
  dashboard: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="2"></rect>
      <rect x="14" y="3" width="7" height="4" rx="2"></rect>
      <rect x="14" y="10" width="7" height="11" rx="2"></rect>
      <rect x="3" y="13" width="7" height="8" rx="2"></rect>
    </svg>
  ),
  terminal: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5"></polyline>
      <line x1="12" y1="19" x2="20" y2="19"></line>
    </svg>
  ),
  ide: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6"></polyline>
      <polyline points="8 6 2 12 8 18"></polyline>
    </svg>
  ),
  files: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
  ),
  vnc: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
      <line x1="8" y1="21" x2="16" y2="21"></line>
      <line x1="12" y1="17" x2="12" y2="21"></line>
    </svg>
  ),
  hardware: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="20" x2="18" y2="10"></line>
      <line x1="12" y1="20" x2="12" y2="4"></line>
      <line x1="6" y1="20" x2="6" y2="14"></line>
    </svg>
  ),
  flasher: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"></circle>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  ),
  ros: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
    </svg>
  ),
  models: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
      <line x1="12" y1="22.08" x2="12" y2="12"></line>
    </svg>
  ),
  skills: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
    </svg>
  ),
  openclaw: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M8 5h8"></path>
      <path d="M6 9h12"></path>
      <path d="M5 13h14"></path>
      <path d="M8 17h8"></path>
    </svg>
  ),
  examples: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M12 20V10"></path>
      <path d="M18 20V4"></path>
      <path d="M6 20v-6"></path>
    </svg>
  ),
};

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{ tab: Tab; label: string; hint: string }>;
}> = [
  {
    title: '工作台',
    items: [
      { tab: 'dashboard', label: '总览', hint: '新手流程与设备主控台' },
      { tab: 'openclaw', label: 'OpenClaw', hint: 'AI 网关、渠道与技能中心' },
      { tab: 'skills', label: '技能与策略', hint: '技能目录、权限与联网策略' },
    ],
  },
  {
    title: '连接控制',
    items: [
      { tab: 'terminal', label: '终端', hint: '直接执行命令与排障' },
      { tab: 'files', label: '文件', hint: '上传、编辑、同步设备文件' },
      { tab: 'vnc', label: '远程桌面', hint: '图形界面访问与调试' },
      { tab: 'ide', label: '代码编辑', hint: '远程 code-server 工作区' },
    ],
  },
  {
    title: '能力与交付',
    items: [
      { tab: 'hardware', label: '硬件监控', hint: 'CPU/BPU/温度与健康态' },
      { tab: 'flasher', label: '烧录与备份', hint: '镜像写盘、校验、备份' },
      { tab: 'examples', label: 'NodeHub', hint: '应用安装、运行与生态同步' },
      { tab: 'models', label: 'ModelZoo', hint: '模型部署、运行与扩展' },
      { tab: 'ros', label: 'ROS 可视化', hint: 'Webviz 与 rosbridge 调试' },
    ],
  },
];

function isOnline(status: string) {
  return status === 'online' || status === 'connected';
}

export default function Sidebar() {
  const {
    devices,
    activeDevice,
    currentDevice,
    setActiveDevice,
    setActiveTab,
    activeTab,
    setShowAddDevice,
    setShowSettings,
    removeDevice,
  } = useAppState();

  const onlineCount = devices.filter((dev) => isOnline(dev.status)).length;

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand-shell">
        <button type="button" className="sidebar-brand" onClick={() => setActiveTab('dashboard')}>
          <span className="sidebar-brand-mark">R</span>
          <span className="sidebar-brand-copy">
            <strong>RDK Studio</strong>
            <span>Apple 风桌面工作区</span>
          </span>
        </button>
        <button
          type="button"
          className="sidebar-settings-trigger"
          onClick={() => setShowSettings(true)}
          title="打开设置"
        >
          <span className="material-symbols-outlined">settings</span>
        </button>
      </div>

      <div className="sidebar-summary-card">
        <div className="sidebar-summary-kicker">当前工作区</div>
        <div className="sidebar-summary-title">
          {currentDevice ? currentDevice.name : '未选择设备'}
        </div>
        <div className="sidebar-summary-meta">
          <span className={`sidebar-summary-pill ${currentDevice && isOnline(currentDevice.status) ? 'online' : ''}`}>
            <span className="status-dot" />
            {currentDevice ? (isOnline(currentDevice.status) ? '设备在线' : '等待连接') : '需要先连接设备'}
          </span>
          <span className="sidebar-summary-pill">{devices.length} 台设备</span>
          <span className="sidebar-summary-pill">{onlineCount} 台在线</span>
        </div>
      </div>

      <div className="sidebar-section-head">
        <div>
          <div className="section-label">设备</div>
          <div className="sidebar-section-copy">选择当前开发板或添加新设备</div>
        </div>
        <button className="sidebar-inline-action" type="button" onClick={() => setShowAddDevice(true)}>
          添加
        </button>
      </div>

      <div className="device-list">
        {devices.length === 0 && (
          <div className="sidebar-empty-state">
            <div className="sidebar-empty-title">还没有设备</div>
            <div className="sidebar-empty-desc">先添加一台 RDK 设备，所有工作区都会自动联动。</div>
          </div>
        )}
        {devices.map((dev) => (
          <div
            key={dev.id}
            className={`device-item ${activeDevice === dev.id ? 'active' : ''}`}
            onClick={() => {
              setActiveDevice(dev.id);
              setActiveTab('dashboard');
            }}
          >
            <div className="device-icon">{Icons.dashboard}</div>
            <div className="device-info">
              <h4 className="device-name">{dev.name}</h4>
              <div className="device-status">
                <span className={`status-dot ${isOnline(dev.status) ? '' : 'offline'}`}></span>
                {isOnline(dev.status) ? `${dev.ip}:${dev.port ?? 22}` : '未连接'}
              </div>
            </div>
            <button
              type="button"
              className="device-delete-btn"
              title="删除设备"
              onClick={(event) => {
                event.stopPropagation();
                removeDevice(dev.id);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        ))}
        <button className="clean-btn outline-btn sidebar-add-btn" type="button" onClick={() => setShowAddDevice(true)}>
          + 扫描 / 添加设备
        </button>
      </div>

      <div className="sidebar-groups">
        {NAV_GROUPS.map((group) => (
          <section key={group.title} className="sidebar-nav-group">
            <div className="section-label">{group.title}</div>
            <div className="sidebar-tools">
              {group.items.map((item) => (
                <button
                  key={item.tab}
                  type="button"
                  className={`tool-btn ${activeTab === item.tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.tab)}
                >
                  <span className="tool-icon">{Icons[item.tab]}</span>
                  <span className="tool-copy">
                    <span className="tool-label">{item.label}</span>
                    <span className="tool-hint">{item.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="tool-btn" type="button" onClick={() => window.open('https://developer.d-robotics.cc/cloud', '_blank')}>
          <span className="material-symbols-outlined nav-icon">cloud</span>
          <span className="tool-copy">
            <span className="tool-label">具身云平台</span>
            <span className="tool-hint">查看远程云端工作流</span>
          </span>
        </button>
        <button className="tool-btn" type="button" onClick={() => window.open('https://developer.d-robotics.cc/', '_blank')}>
          <span className="tool-icon">🍠</span>
          <span className="tool-copy">
            <span className="tool-label">开发者社区</span>
            <span className="tool-hint">文档、镜像、生态资源入口</span>
          </span>
        </button>
        <button className="tool-btn" type="button" onClick={() => setShowSettings(true)}>
          <span className="material-symbols-outlined nav-icon">settings</span>
          <span className="tool-copy">
            <span className="tool-label">客户端设置</span>
            <span className="tool-hint">AI、飞书、连接与体验</span>
          </span>
        </button>
      </div>
    </aside>
  );
}
