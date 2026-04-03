import { useCallback } from 'react';
import type { Tab } from '../app-types';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import { fillTemplate } from '../i18n/en-extras';
import { isDeviceShownOnline } from '../utils/device-connection';
import { useConfirmRemoveDevice } from '../hooks/useConfirmRemoveDevice';

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
  'ai-chat-hub': (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </svg>
  ),
};

const NAV_GROUP_DEFS: Array<{ titleKey: string; titleZh: string; tabs: Tab[] }> = [
  { titleKey: 'sidebar.group.workspace', titleZh: '工作台', tabs: ['dashboard', 'ai-chat-hub', 'openclaw', 'skills'] },
  { titleKey: 'sidebar.group.connect', titleZh: '连接控制', tabs: ['terminal', 'files', 'vnc', 'ide'] },
  { titleKey: 'sidebar.group.capabilities', titleZh: '能力与交付', tabs: ['hardware', 'flasher'] },
];

/** 中文默认文案（英文走 en-extras sidebar.nav.* / sidebar.hint.*） */
const SIDEBAR_TAB_ZH: Record<Tab, { nav: string; hint: string }> = {
  dashboard: { nav: '总览', hint: '新手流程与设备主控台' },
  'ai-chat-hub': { nav: 'AI 对话', hint: '左侧切换本机已存会话，右侧与 Dock 同步继续聊' },
  openclaw: { nav: 'OpenClaw', hint: 'AI 网关、渠道与技能中心' },
  skills: { nav: '技能工坊', hint: '生成 OpenClaw 技能并部署到板端' },
  terminal: { nav: '终端', hint: '直接执行命令与排障' },
  files: { nav: '文件', hint: '上传、编辑、同步设备文件' },
  vnc: { nav: '远程桌面', hint: '图形界面访问与调试' },
  ide: { nav: '代码编辑', hint: '远程 code-server 工作区' },
  hardware: { nav: '硬件监控', hint: 'CPU/BPU/温度与健康态' },
  flasher: { nav: '烧录与备份', hint: '镜像写盘、校验、备份' },
  'dr-embed': { nav: '生态网页', hint: '论坛与 RoboGo 内嵌' },
};

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
    openDrAuthenticatedPortal,
  } = useAppState();
  const confirmRemoveDevice = useConfirmRemoveDevice();
  const { t } = useI18n();
  const tf = useCallback(
    (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars),
    [t],
  );

  const onlineCount = devices.filter((dev) => isDeviceShownOnline(dev)).length;

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand-shell">
        <button type="button" className="sidebar-brand" onClick={() => setActiveTab('dashboard')}>
          <span className="sidebar-brand-mark">R</span>
          <span className="sidebar-brand-copy">
            <strong>RDK Studio</strong>
            <span>{t('sidebar.brand.tagline', 'Apple 风桌面工作区')}</span>
          </span>
        </button>
        <button
          type="button"
          className="sidebar-settings-trigger"
          onClick={() => setShowSettings(true)}
          title={t('sidebar.settingsOpen', '打开设置')}
        >
          <span className="material-symbols-outlined">settings</span>
        </button>
      </div>

      <div className="sidebar-summary-card">
        <div className="sidebar-summary-kicker">{t('sidebar.summary.kicker', '当前工作区')}</div>
        <div className="sidebar-summary-title">
          {currentDevice ? currentDevice.name : t('sidebar.summary.noDevice', '未选择设备')}
        </div>
        <div className="sidebar-summary-meta">
          <span
            className={`sidebar-summary-pill ${currentDevice && isDeviceShownOnline(currentDevice) ? 'online' : ''}`}
            title={
              currentDevice
                ? t(
                    'dashboard.devicePillHint',
                    '「在线」表示后台已用当前保存的 SSH 凭据成功登录该设备。无凭据或密码错误时会显示离线；请重新连接设备以保存密码。',
                  )
                : undefined
            }
          >
            <span
              className={`status-dot ${
                !currentDevice ? '' : isDeviceShownOnline(currentDevice) ? 'online' : 'offline'
              }`}
            />
            {currentDevice
              ? (isDeviceShownOnline(currentDevice) ? t('sidebar.summary.online', '设备在线') : t('sidebar.summary.waiting', '等待连接'))
              : t('sidebar.summary.needConnect', '需要先连接设备')}
          </span>
          <span className="sidebar-summary-pill">{tf('sidebar.summary.devices', '{{n}} 台设备', { n: devices.length })}</span>
          <span className="sidebar-summary-pill">{tf('sidebar.summary.onlineCount', '{{n}} 台在线', { n: onlineCount })}</span>
        </div>
      </div>

      <div className="sidebar-section-head">
        <div>
          <div className="section-label">{t('sidebar.devices.section', '设备')}</div>
          <div className="sidebar-section-copy">{t('sidebar.devices.hint', '选择当前开发板或添加新设备')}</div>
        </div>
        <button className="sidebar-inline-action" type="button" onClick={() => setShowAddDevice(true)}>
          {t('sidebar.devices.add', '添加')}
        </button>
      </div>

      <div className="device-list">
        {devices.length === 0 && (
          <div className="sidebar-empty-state">
            <div className="sidebar-empty-title">{t('sidebar.empty.title', '还没有设备')}</div>
            <div className="sidebar-empty-desc">{t('sidebar.empty.desc', '先添加一台 RDK 设备，所有工作区都会自动联动。')}</div>
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
                <span
                  className={`status-dot ${isDeviceShownOnline(dev) ? 'online' : 'offline'}`}
                />
                {isDeviceShownOnline(dev) ? `${dev.ip}:${dev.port ?? 22}` : t('sidebar.dev.disconnected', '未连接')}
              </div>
            </div>
            <button
              type="button"
              className="device-delete-btn"
              title={t('sidebar.removeDevice', '删除设备')}
              onClick={(event) => {
                event.stopPropagation();
                confirmRemoveDevice(dev);
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
          {t('sidebar.addDevice', '+ 添加设备')}
        </button>
      </div>

      <div className="sidebar-groups">
        {NAV_GROUP_DEFS.map((group) => (
          <section key={group.titleKey} className="sidebar-nav-group">
            <div className="section-label">{t(group.titleKey, group.titleZh)}</div>
            <div className="sidebar-tools">
              {group.tabs.map((tab) => {
                const zh = SIDEBAR_TAB_ZH[tab];
                return (
                <button
                  key={tab}
                  type="button"
                  className={`tool-btn ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  <span className="tool-icon">{Icons[tab]}</span>
                  <span className="tool-copy">
                    <span className="tool-label">{t(`sidebar.nav.${tab}`, zh.nav)}</span>
                    <span className="tool-hint">{t(`sidebar.hint.${tab}`, zh.hint)}</span>
                  </span>
                </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="sidebar-footer">
        <button
          className="tool-btn"
          type="button"
          onClick={() => {
            void openDrAuthenticatedPortal('forum', 'https://forum.d-robotics.cc/');
          }}
        >
          <span className="material-symbols-outlined nav-icon">forum</span>
          <span className="tool-copy">
            <span className="tool-label">{t('sidebar.footer.forum', '地瓜开发者论坛')}</span>
            <span className="tool-hint">{t('sidebar.footer.forumHint', '开发者交流与讨论：已登录 Studio 时自动带令牌（与 RoboGo 一致）')}</span>
          </span>
        </button>
        <button
          className="tool-btn"
          type="button"
          onClick={() => {
            void openDrAuthenticatedPortal('robogo', 'https://robogo.d-robotics.cc/');
          }}
        >
          <span className="material-symbols-outlined nav-icon">cloud</span>
          <span className="tool-copy">
            <span className="tool-label">{t('sidebar.footer.robogo', 'RoboGo 云平台')}</span>
            <span className="tool-hint">{t('sidebar.footer.robogoHint', '云端机器人与工作流')}</span>
          </span>
        </button>
        <button className="tool-btn" type="button" onClick={() => setShowSettings(true)}>
          <span className="material-symbols-outlined nav-icon">settings</span>
          <span className="tool-copy">
            <span className="tool-label">{t('sidebar.footer.settings', '客户端设置')}</span>
            <span className="tool-hint">{t('sidebar.footer.settingsHint', 'AI、飞书、连接与体验')}</span>
          </span>
        </button>
      </div>
    </aside>
  );
}
