import { useState, useCallback } from 'react';
import { Cloud, MessagesSquare } from 'lucide-react';
import type { Tab } from '../app-types';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import StudioVersionFooter from './StudioVersionFooter';
import { isDeviceShownOnline } from '../utils/device-connection';
import { isDesktop } from '../utils/env';
import { useConfirmRemoveDevice } from '../hooks/useConfirmRemoveDevice';

interface NavItemDef {
  tab: Tab;
  labelKey: string;
  descKey: string;
  zhLabel: string;
  zhDesc: string;
  paths: string[];
}

const NAV_ITEMS: NavItemDef[] = [
  { tab: 'dashboard', labelKey: 'nav.dashboard.label', descKey: 'nav.dashboard.desc', zhLabel: '工作台', zhDesc: '设备总览与快捷操作',
    paths: ['M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4'] },
  { tab: 'openclaw', labelKey: 'nav.openclaw.label', descKey: 'nav.openclaw.desc', zhLabel: 'OpenClaw', zhDesc: '板端 AI Agent 管理',
    paths: [
      'M8 5c0-1.5 1.8-3 4-3s4 1.5 4 3',
      'M7 8c-2-1-4 0-4 2s1 3 2 3',
      'M17 8c2-1 4 0 4 2s-1 3-2 3',
      'M5 13l3 2 4 6 4-6 3-2',
      'M9.5 7a1 1 0 100-2 1 1 0 000 2z',
      'M14.5 7a1 1 0 100-2 1 1 0 000 2z',
    ] },
  { tab: 'skills', labelKey: 'nav.skills.label', descKey: 'nav.skills.desc', zhLabel: '技能工坊', zhDesc: 'OpenClaw 技能生成与部署',
    paths: ['M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z'] },
];

const CONNECT_ITEMS: NavItemDef[] = [
  { tab: 'terminal', labelKey: 'nav.terminal.label', descKey: 'nav.terminal.desc', zhLabel: '终端', zhDesc: 'SSH 远程命令行',
    paths: ['M6.75 7.5l3 2.25-3 2.25m4.5 0h3M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5z'] },
  { tab: 'files', labelKey: 'nav.files.label', descKey: 'nav.files.desc', zhLabel: '文件', zhDesc: '设备文件管理器',
    paths: ['M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z'] },
  { tab: 'vnc', labelKey: 'nav.vnc.label', descKey: 'nav.vnc.desc', zhLabel: '远程桌面', zhDesc: 'noVNC 可视化桌面连接',
    paths: ['M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25h-13.5A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25'] },
  { tab: 'ide', labelKey: 'nav.ide.label', descKey: 'nav.ide.desc', zhLabel: 'IDE', zhDesc: '在线代码编辑器',
    paths: ['M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5'] },
];

const CAPABILITY_ITEMS: NavItemDef[] = [
  { tab: 'flasher', labelKey: 'nav.flasher.label', descKey: 'nav.flasher.desc', zhLabel: '烧录', zhDesc: '系统镜像烧录',
    paths: ['M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3'] },
];

/** 工作台置顶；桌面端「AI 对话」插在 dashboard 与后续项之间 */
const DASHBOARD_NAV: NavItemDef[] = [NAV_ITEMS[0]];
const NAV_ITEMS_AFTER_DASHBOARD: NavItemDef[] = NAV_ITEMS.slice(1);

/** 与 prepare:build-resources 写入的 `public/branding/icon.png` 一致；`base: './'` 下需相对根 */
const RAIL_BRAND_SRC = `${import.meta.env.BASE_URL}branding/icon.png`;

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
    setShowSettings,
    language, setLanguage, addToast,
    railExpanded, setRailExpanded,
    obReturnStep, setObReturnStep,
    openDrAuthenticatedPortal,
  } = useAppState();
  const confirmRemoveDevice = useConfirmRemoveDevice();
  const { t } = useI18n();

  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const [railLogoFailed, setRailLogoFailed] = useState(false);
  const onRailLogoError = useCallback(() => setRailLogoFailed(true), []);
  const deviceOnline = !!currentDevice && isDeviceShownOnline(currentDevice);

  const renderGroup = (items: NavItemDef[]) =>
    items.map((item) => {
      const label = t(item.labelKey, item.zhLabel);
      const desc = t(item.descKey, item.zhDesc);
      return (
        <button
          key={item.tab}
          className={`rail-btn ${activeTab === item.tab ? 'active' : ''}`}
          data-tooltip={!railExpanded ? `${label} · ${desc}` : undefined}
          onClick={() => setActiveTab(item.tab)}
        >
          <NavIcon paths={item.paths} />
          {railExpanded && <span className="rail-label">{label}</span>}
        </button>
      );
    });

  return (
    <>
      <nav className={`icon-rail ${railExpanded ? 'expanded' : ''}`}>
        <button
          type="button"
          className={`rail-logo ${railLogoFailed ? 'rail-logo--fallback' : 'rail-logo--image'}`}
          onClick={() => setActiveTab('dashboard')}
          title="RDK Studio"
        >
          {!railLogoFailed ? (
            <img src={RAIL_BRAND_SRC} alt="" width={36} height={36} decoding="async" onError={onRailLogoError} />
          ) : (
            <span className="rail-logo-letter">R</span>
          )}
        </button>

        <div className="rail-nav">
          {renderGroup(DASHBOARD_NAV)}
          {isDesktop() && (
            <button
              type="button"
              className={`rail-btn rail-chat-sessions-btn ${activeTab === 'ai-chat-hub' ? 'active' : ''}`}
              aria-label={t('rail.chatSessions.short', 'AI 对话')}
              data-tooltip={!railExpanded ? t('rail.chatSessions.tooltipHub', 'AI 对话与历史（主工作区）') : undefined}
              aria-pressed={activeTab === 'ai-chat-hub'}
              onClick={() => {
                setShowDevicePanel(false);
                setActiveTab('ai-chat-hub');
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
              </svg>
              {railExpanded && <span className="rail-label">{t('rail.chatSessions.short', 'AI 对话')}</span>}
            </button>
          )}
          {renderGroup(NAV_ITEMS_AFTER_DASHBOARD)}
          <div className="rail-separator" />
          {renderGroup(CONNECT_ITEMS)}
          <div className="rail-separator" />
          {renderGroup(CAPABILITY_ITEMS)}
        </div>

        <div className="rail-footer">
          <StudioVersionFooter railExpanded={railExpanded} />
          {obReturnStep && (
            <button
              className="rail-btn rail-return-guide"
              data-tooltip={!railExpanded ? t('rail.returnGuide.tip', '返回新手引导') : undefined}
              onClick={() => { setActiveTab('dashboard'); setObReturnStep(null); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
              </svg>
              {railExpanded && <span className="rail-label">{t('rail.returnGuide', '返回引导')}</span>}
            </button>
          )}
          <button
            className="rail-btn"
            data-tooltip={!railExpanded ? (currentDevice ? currentDevice.name : t('rail.pickDevice', '选择设备')) : undefined}
            onClick={() => setShowDevicePanel(!showDevicePanel)}
          >
            <span className={`rail-device-dot ${deviceOnline ? 'online' : 'offline'}`} />
            {railExpanded && <span className="rail-label">{currentDevice ? currentDevice.name : t('rail.device', '设备')}</span>}
          </button>

          {railExpanded ? (
            <select
              className="rail-lang-select"
              aria-label={t('rail.lang.aria', '界面语言')}
              title={t('rail.lang.tip', '界面语言')}
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                addToast(t('settings.conn.lang.saved', '语言偏好已保存'), 'success');
              }}
            >
              <option value="zh-CN">{t('settings.conn.lang.zh', '简体中文')}</option>
              <option value="en">{t('settings.conn.lang.en', 'English')}</option>
            </select>
          ) : (
            <button
              type="button"
              className="rail-lang-toggle"
              data-tooltip={t('rail.lang.tip', '界面语言')}
              aria-label={t('rail.lang.aria', '界面语言')}
              onClick={() => {
                setLanguage(language === 'en' ? 'zh-CN' : 'en');
                addToast(t('settings.conn.lang.saved', '语言偏好已保存'), 'success');
              }}
            >
              {language === 'en' ? 'EN' : '中'}
            </button>
          )}

          <button
            className="rail-btn"
            data-tooltip={!railExpanded ? t('rail.settings.tip', '设置') : undefined}
            onClick={() => setShowSettings(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {railExpanded && <span className="rail-label">{t('rail.settings', '设置')}</span>}
          </button>

          <button
            type="button"
            className="rail-btn rail-external-link"
            data-tooltip={
              !railExpanded
                ? `${t('rail.forum.short', '地瓜开发者论坛')} · ${t('rail.forum.tooltip', 'Discourse 社区，已登录免重复认证')}`
                : undefined
            }
            onClick={() => {
              void openDrAuthenticatedPortal('forum', 'https://forum.d-robotics.cc/');
            }}
          >
            <MessagesSquare width={20} height={20} strokeWidth={1.5} aria-hidden />
            {railExpanded && <span className="rail-label">{t('rail.forum.short', '地瓜开发者论坛')}</span>}
          </button>
          <button
            type="button"
            className="rail-btn rail-external-link"
            data-tooltip={
              !railExpanded
                ? `${t('sidebar.footer.robogo', 'RoboGo 云平台')} · ${t('sidebar.footer.robogoHint', '云端机器人与工作流')}`
                : undefined
            }
            onClick={() => {
              void openDrAuthenticatedPortal('robogo', 'https://robogo.d-robotics.cc/');
            }}
          >
            <Cloud width={20} height={20} strokeWidth={1.5} aria-hidden />
            {railExpanded && (
              <span className="rail-label">{t('sidebar.footer.robogo', 'RoboGo 云平台')}</span>
            )}
          </button>

          <button
            className="rail-expand-btn"
            onClick={() => setRailExpanded(!railExpanded)}
            data-tooltip={!railExpanded ? t('rail.expand.tip', '展开导航') : undefined}
            aria-label={railExpanded ? t('rail.collapse.aria', '收起导航') : t('rail.expand.aria', '展开导航')}
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
            <div className="device-panel-title">{t('device.listTitle', '设备列表')}</div>
            {devices.length === 0 && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '12px 0' }}>
                {t('device.empty', '还没有设备，请先添加一台 RDK 开发板。')}
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
                <span className={`status-dot ${isDeviceShownOnline(dev) ? 'online' : 'offline'}`} />
                <div className="device-panel-item-info">
                  <div className="device-panel-item-name">{dev.name}</div>
                  <div className="device-panel-item-addr">{dev.ip}</div>
                </div>
                <button
                  type="button"
                  className="btn-icon device-panel-delete"
                  title={t('device.removeFromList', '从列表移除此设备')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    /** 先收起面板再弹出确认框，避免与侧栏同 z-index 层级时误以为「点了没反应」 */
                    setShowDevicePanel(false);
                    confirmRemoveDevice(dev);
                  }}
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
              {t('device.add', '+ 扫描 / 添加设备')}
            </button>
          </div>
        </>
      )}
    </>
  );
}
