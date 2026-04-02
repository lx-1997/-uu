import { useEffect, useMemo, useState } from 'react';
import type { Device } from '../app-types';
import {
  GLOBAL_CHAT_DEVICE_ID,
  listStoredChatHistoryDeviceIds,
  loadAnyChatHistoryForDevice,
} from '../utils/chat-history-storage';
import { chatMessageToPlainText } from '../utils/chat-message-plain';

function formatDurationMsLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m ${rs}s`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  devices: Device[];
  /** 打开时默认选中的设备 id（与对话坞当前设备一致） */
  preferredDeviceId?: string | null;
  t: (key: string, zh: string) => string;
};

export function ChatHistoryModal({ open, onClose, devices, preferredDeviceId, t }: Props) {
  const storedIds = useMemo(() => listStoredChatHistoryDeviceIds(), [open]);
  const deviceOptions = useMemo(() => {
    const byId = new Map(devices.map(d => [d.id, d]));
    const ids = new Set<string>([...storedIds, ...devices.map(d => d.id)]);
    if (preferredDeviceId) ids.add(preferredDeviceId);
    return [...ids].sort();
  }, [devices, storedIds, preferredDeviceId]);

  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    const pref = preferredDeviceId?.trim();
    if (pref && deviceOptions.includes(pref)) {
      setSelectedId(pref);
      return;
    }
    if (deviceOptions.length) {
      setSelectedId(deviceOptions[0]);
    }
  }, [open, preferredDeviceId, deviceOptions]);

  const labelForId = (id: string) => {
    if (id === GLOBAL_CHAT_DEVICE_ID) {
      return t('dock.history.global', '未绑定设备 / 全局');
    }
    const d = devices.find(x => x.id === id);
    return d?.name?.trim() || d?.ip || id;
  };

  const messages = selectedId ? loadAnyChatHistoryForDevice(selectedId) : [];

  if (!open) return null;

  return (
    <div className="chat-history-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="chat-history-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-labelledby="chat-history-modal-title"
      >
        <div className="chat-history-modal-header">
          <h2 id="chat-history-modal-title" className="chat-history-modal-title">
            {t('dock.history.title', '对话历史')}
          </h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t('dock.task.closeTitle', '关闭')}>
            ×
          </button>
        </div>
        <p className="chat-history-modal-hint">
          {t('dock.history.hint', '以下为已保存在本机的对话记录（按设备分档）。与当前窗口内容一致，最多保留近期若干条。')}
        </p>
        <div className="chat-history-modal-toolbar">
          <label className="chat-history-modal-label" htmlFor="chat-history-device-select">
            {t('dock.history.device', '设备')}
          </label>
          <select
            id="chat-history-device-select"
            className="select chat-history-device-select"
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
          >
            {deviceOptions.length === 0 ? (
              <option value="">{t('dock.history.noDevices', '无存档')}</option>
            ) : (
              deviceOptions.map(id => (
                <option key={id} value={id}>{labelForId(id)}</option>
              ))
            )}
          </select>
        </div>
        <div className="chat-history-modal-body">
          {messages.length === 0 ? (
            <div className="chat-history-modal-empty">{t('dock.history.empty', '该设备暂无本地对话记录')}</div>
          ) : (
            messages.map(msg => {
              const plain = chatMessageToPlainText(msg, t);
              const time =
                msg.role === 'ai' && msg.durationMs != null
                  ? `${t('dock.msg.took', '用时')} ${formatDurationMsLabel(msg.durationMs)}`
                  : new Date(msg.id).toLocaleString();
              return (
                <div key={msg.id} className={`chat-history-row ${msg.role}`}>
                  <div className="chat-history-row-meta">
                    <span className="chat-history-role">
                      {msg.role === 'ai' ? 'RDKClaw' : t('dock.history.you', '你')}
                    </span>
                    <span className="chat-history-time">{time}</span>
                  </div>
                  <pre className="chat-history-pre">{plain || '—'}</pre>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
