import { useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import { useConfirmRemoveDevice } from '../hooks/useConfirmRemoveDevice';
import { isDeviceShownOnline } from '../utils/device-connection';
import { isDesktop } from '../utils/env';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * 桌面端：从左侧栏打开「按设备分桶」的 AI 对话列表（一设备一会话），与主对话 localStorage 分桶一致。
 */
export default function DesktopChatSessionsPanel({ open, onClose }: Props) {
  const {
    devices,
    activeDevice,
    setActiveDevice,
    setChatExpanded,
    setShowAddDevice,
  } = useAppState();
  const confirmRemoveDevice = useConfirmRemoveDevice();
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!isDesktop() || !open) return null;

  const selectGlobal = () => {
    setActiveDevice('');
    setChatExpanded(true);
    onClose();
  };

  const selectDevice = (id: string) => {
    setActiveDevice(id);
    setChatExpanded(true);
    onClose();
  };

  return (
    <>
      <div className="device-panel-overlay" onClick={onClose} />
      <div
        className="device-panel chat-sessions-panel"
        role="dialog"
        aria-label={t('rail.chatSessions.title', 'AI 对话')}
      >
        <div className="chat-sessions-panel-head">
          <div className="device-panel-title">{t('rail.chatSessions.title', 'AI 对话')}</div>
          <p className="chat-sessions-panel-hint">{t('rail.chatSessions.hint', '每台设备对应一个聊天窗口；添加设备即新增对话。')}</p>
        </div>

        <button
          type="button"
          className={`device-panel-item chat-sessions-item ${!activeDevice ? 'active' : ''}`}
          onClick={selectGlobal}
        >
          <span className="status-dot" style={{ background: 'var(--text-muted)' }} />
          <div className="device-panel-item-info">
            <div className="device-panel-item-name">{t('rail.chatSessions.global', '未绑定 / 全局')}</div>
            <div className="device-panel-item-addr">{t('rail.chatSessions.globalDesc', '未选择设备时的对话')}</div>
          </div>
        </button>

        {devices.length === 0 && (
          <div className="chat-sessions-empty">{t('rail.chatSessions.emptyDevices', '暂无设备，请添加开发板以开始设备对话。')}</div>
        )}

        {devices.map((dev) => (
          <div
            key={dev.id}
            className={`device-panel-item chat-sessions-item ${activeDevice === dev.id ? 'active' : ''}`}
            onClick={() => selectDevice(dev.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectDevice(dev.id);
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <span className={`status-dot ${isDeviceShownOnline(dev) ? 'online' : 'offline'}`} />
            <div className="device-panel-item-info">
              <div className="device-panel-item-name">{dev.name}</div>
              <div className="device-panel-item-addr">{dev.ip}{dev.port != null ? `:${dev.port}` : ''}</div>
            </div>
            <button
              type="button"
              className="btn-icon device-panel-delete"
              title={t('device.removeFromList', '从列表移除此设备')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
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
          type="button"
          className="device-panel-add-btn"
          onClick={() => {
            setShowAddDevice(true);
            onClose();
          }}
        >
          {t('rail.chatSessions.addDevice', '+ 添加设备（新对话窗口）')}
        </button>
      </div>
    </>
  );
}
