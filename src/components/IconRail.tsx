import { useState } from 'react';
import type { Tab } from '../app-types';
import { useAppState } from '../hooks/useAppState';

interface NavItem {
  tab: Tab;
  label: string;
  desc: string;
  paths: string[];
}

const NAV_ITEMS: NavItem[] = [
  { tab: 'dashboard', label: '工作台', desc: '设备总览与快捷操作',
    paths: ['M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4'] },
  { tab: 'openclaw', label: 'OpenClaw', desc: '板端 AI Agent 管理',
    paths: [
      'M8 5c0-1.5 1.8-3 4-3s4 1.5 4 3',
      'M7 8c-2-1-4 0-4 2s1 3 2 3',
      'M17 8c2-1 4 0 4 2s-1 3-2 3',
      'M5 13l3 2 4 6 4-6 3-2',
      'M9.5 7a1 1 0 100-2 1 1 0 000 2z',
      'M14.5 7a1 1 0 100-2 1 1 0 000 2z',
    ] },
  { tab: 'skills', label: '技能工坊', desc: 'OpenClaw 技能生成与部署',
    paths: ['M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z'] },
];

const CONNECT_ITEMS: NavItem[] = [
  { tab: 'terminal', label: '终端', desc: 'SSH 远程命令行',
    paths: ['M6.75 7.5l3 2.25-3 2.25m4.5 0h3M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5z'] },
  { tab: 'files', label: '文件', desc: '设备文件管理器',
    paths: ['M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z'] },
  { tab: 'vnc', label: '远程桌面', desc: 'noVNC 可视化桌面连接',
    paths: ['M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25h-13.5A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25'] },
  { tab: 'ide', label: 'IDE', desc: '在线代码编辑器',
    paths: ['M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5'] },
];

const CAPABILITY_ITEMS: NavItem[] = [
  { tab: 'hardware', label: '硬件', desc: 'GPIO / 传感器管理',
    paths: ['M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z'] },
  { tab: 'flasher', label: '烧录/备份', desc: '系统镜像烧录与备份',
    paths: ['M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3'] },
  { tab: 'ros', label: 'ROS', desc: 'ROS2 话题与节点管理',
    paths: ['M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0', 'M12 4.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z', 'M20 12a1.5 1.5 0 110-3 1.5 1.5 0 010 3z', 'M12 20a1.5 1.5 0 110-3 1.5 1.5 0 010 3z', 'M4 12a1.5 1.5 0 110-3 1.5 1.5 0 010 3z'] },
];

function NavIcon({ paths }: { paths: string[] }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

export default function IconRail() {
  const {
    activeTab, setActiveTab,
    devices, activeDevice, currentDevice,
    setActiveDevice, setShowAddDevice,
    removeDevice,
    setShowSettings,
    theme, toggleTheme,
    railExpanded, setRailExpanded,
    obReturnStep, setObReturnStep,
  } = useAppState();

  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const deviceOnline = !!currentDevice && currentDevice.status !== 'offline' && currentDevice.status !== 'disconnected';

  const renderGroup = (items: NavItem[]) =>
    items.map((item) => (
      <button
        key={item.tab}
        className={`rail-btn ${activeTab === item.tab ? 'active' : ''}`}
        data-tooltip={!railExpanded ? `${item.label} · ${item.desc}` : undefined}
        onClick={() => setActiveTab(item.tab)}
      >
        <NavIcon paths={item.paths} />
        {railExpanded && <span className="rail-label">{item.label}</span>}
      </button>
    ));

  return (
    <>
      <nav className={`icon-rail ${railExpanded ? 'expanded' : ''}`}>
        <button className="rail-logo" onClick={() => setActiveTab('dashboard')} title="RDK Studio">
          R
        </button>

        <div className="rail-nav">
          {renderGroup(NAV_ITEMS)}
          <div className="rail-separator" />
          {renderGroup(CONNECT_ITEMS)}
          <div className="rail-separator" />
          {renderGroup(CAPABILITY_ITEMS)}
        </div>

        <div className="rail-footer">
          {obReturnStep && (
            <button
              className="rail-btn rail-return-guide"
              data-tooltip={!railExpanded ? '返回新手引导' : undefined}
              onClick={() => { setActiveTab('dashboard'); setObReturnStep(null); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
              </svg>
              {railExpanded && <span className="rail-label">返回引导</span>}
            </button>
          )}
          <button
            className="rail-btn"
            data-tooltip={!railExpanded ? (currentDevice ? currentDevice.name : '选择设备') : undefined}
            onClick={() => setShowDevicePanel(!showDevicePanel)}
          >
            <span className={`rail-device-dot ${deviceOnline ? 'online' : ''}`} />
            {railExpanded && <span className="rail-label">{currentDevice ? currentDevice.name : '设备'}</span>}
          </button>

          <button
            className="rail-theme-toggle"
            onClick={toggleTheme}
            data-tooltip={!railExpanded ? (
              theme === 'aurora' ? '切换到奶咖模式' :
              theme === 'cozy'  ? '切换到赛博模式' :
                                  '切换到极光模式'
            ) : undefined}
          >
            {theme === 'aurora' ? '🍪' : theme === 'cozy' ? '🌙' : '☀️'}
          </button>

          <button
            className="rail-btn"
            data-tooltip={!railExpanded ? '设置' : undefined}
            onClick={() => setShowSettings(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {railExpanded && <span className="rail-label">设置</span>}
          </button>

          <button
            className="rail-expand-btn"
            onClick={() => setRailExpanded(!railExpanded)}
            data-tooltip={!railExpanded ? '展开导航' : undefined}
            aria-label={railExpanded ? '收起导航' : '展开导航'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: railExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </nav>

      {showDevicePanel && (
        <>
          <div className="device-panel-overlay" onClick={() => setShowDevicePanel(false)} />
          <div className="device-panel">
            <div className="device-panel-title">设备列表</div>
            {devices.length === 0 && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '12px 0' }}>
                还没有设备，请先添加一台 RDK 开发板。
              </div>
            )}
            {devices.map((dev) => (
              <div
                key={dev.id}
                className={`device-panel-item ${activeDevice === dev.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveDevice(dev.id);
                  setActiveTab('dashboard');
                  setShowDevicePanel(false);
                }}
                style={{ cursor: 'pointer' }}
              >
                <span className={`status-dot ${dev.status === 'connected' || dev.status === 'online' ? 'online' : 'offline'}`} />
                <div className="device-panel-item-info">
                  <div className="device-panel-item-name">{dev.name}</div>
                  <div className="device-panel-item-addr">{dev.ip}</div>
                </div>
                <button
                  type="button"
                  className="btn-icon"
                  title="删除设备"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDevice(dev.id);
                  }}
                  style={{ marginLeft: 'auto', flexShrink: 0, width: 24, height: 24, opacity: 0.5 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              className="device-panel-add-btn"
              onClick={() => { setShowAddDevice(true); setShowDevicePanel(false); }}
            >
              + 扫描 / 添加设备
            </button>
          </div>
        </>
      )}
    </>
  );
}
