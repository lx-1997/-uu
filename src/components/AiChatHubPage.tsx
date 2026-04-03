import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useHubDockAnchor } from '../contexts/HubDockAnchorContext';
import { useAppState } from '../hooks/useAppState';
import { useAIChatStore } from '../hooks/useAIChatStore';
import { useI18n } from '../i18n/use-i18n';
import {
  GLOBAL_CHAT_DEVICE_ID,
  hasPersistedChatHistoryForSession,
  listStoredChatHistoryDeviceIds,
  listStoredStudioSessionIdsForDevice,
  loadChatHistoryFromStorage,
  toChatDeviceId,
} from '../utils/chat-history-storage';
import { buildThreadSummaryLine } from '../utils/chat-history-thread-label';
import { buildChatTranscriptTxt, downloadTranscriptTxt } from '../utils/export-chat-transcript';
import { confirmAndBeginNewChat } from '../utils/studio-new-chat';
import type { ChatMessage, Device } from '../app-types';

function threadLastActivityMs(msgs: ChatMessage[]): number {
  if (!msgs.length) return 0;
  let max = 0;
  for (const m of msgs) {
    max = Math.max(max, m.id, m.startedAt ?? 0);
  }
  return max;
}

function deviceSectionLabel(id: string, devices: Device[], tr: (k: string, zh: string) => string): string {
  if (id === GLOBAL_CHAT_DEVICE_ID) return tr('dock.history.global', '未绑定设备 / 全局');
  const d = devices.find((x) => x.id === id);
  const name = d?.name?.trim();
  if (name) {
    const tail = d?.ip ? ` · ${d.ip}${d.port != null && d.port !== 22 ? `:${d.port}` : ''}` : '';
    return `${name}${tail}`;
  }
  if (d?.ip) return d.ip + (d?.port != null && d.port !== 22 ? `:${d.port}` : '');
  return `${tr('chat.hub.archivedBucket', '本机存档')} · ${id.slice(0, 8)}…`;
}

/** 侧栏列表用短时间标签（降低视觉噪音） */
function formatChatHubThreadTime(
  ms: number,
  tr: (k: string, zh: string) => string,
  isEn: boolean,
): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sod = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((sod(now) - sod(d)) / 86400000);
  const hm = d.toLocaleTimeString(isEn ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return hm;
  if (diffDays === 1) {
    return `${tr('chat.hub.time.yesterday', '昨天')} ${hm}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return isEn
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return d.toLocaleDateString(isEn ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

type SelectedThread = { devId: string; sessionId: string };

export default function AiChatHubPage() {
  const {
    devices,
    activeDevice,
    currentDevice,
    setActiveDevice,
    setChatExpanded,
    addToast,
    showConfirm,
    aiTyping,
    taskHistory,
    stopAllRuns,
    getStudioChatSessionId,
    getStudioChatDeviceId,
  } = useAppState();
  const { chatMessages, resumeStudioThread, deleteStudioThread, clearChatHistory } = useAIChatStore();
  const { setHubAnchorEl } = useHubDockAnchor();
  const { t, isEn } = useI18n();

  const [archiveRev, setArchiveRev] = useState(0);
  const [selected, setSelected] = useState<SelectedThread | null>(null);

  const studioDev = getStudioChatDeviceId();
  const studioSid = getStudioChatSessionId();

  useEffect(() => {
    setChatExpanded(true);
  }, [setChatExpanded]);

  /** Dock / 新对话 切换会话 id 时，左侧高亮与主区域与之一致 */
  useEffect(() => {
    if (!studioSid) return;
    setSelected({ devId: studioDev, sessionId: studioSid });
  }, [studioDev, studioSid]);

  const deviceBuckets = useMemo(() => {
    const stored = listStoredChatHistoryDeviceIds();
    const ids = new Set<string>([GLOBAL_CHAT_DEVICE_ID, ...stored, ...devices.map((d) => d.id)]);
    const pref = String(activeDevice || '').trim();
    if (pref) ids.add(pref);
    ids.add(studioDev);
    return [...ids].sort();
  }, [devices, activeDevice, studioDev, archiveRev, chatMessages.length]);

  const threadsByDevice = useMemo(() => {
    const map = new Map<string, Array<{ sessionId: string; summary: string; lastAt: number }>>();
    for (const devId of deviceBuckets) {
      const rawSids = listStoredStudioSessionIdsForDevice(devId);
      const sidSet = new Set<string>(rawSids);
      if (toChatDeviceId(devId) === studioDev && studioSid) sidSet.add(studioSid);
      const sids = [...sidSet].filter(
        (sessionId) =>
          sessionId === studioSid && toChatDeviceId(devId) === studioDev
          || hasPersistedChatHistoryForSession(devId, sessionId),
      );
      if (sids.length === 0) continue;
      const rows = sids.map((sessionId) => {
        const msgs = loadChatHistoryFromStorage(devId, sessionId);
        const lastAt = threadLastActivityMs(msgs);
        const summary = msgs.length ? buildThreadSummaryLine(msgs, t) : '';
        return {
          sessionId,
          summary: summary || t('chat.hub.emptyThread', '（空）'),
          lastAt,
        };
      });
      rows.sort((a, b) => b.lastAt - a.lastAt);
      map.set(devId, rows);
    }
    return map;
  }, [deviceBuckets, studioDev, studioSid, t, archiveRev, chatMessages.length]);

  const visibleDeviceBuckets = useMemo(() => {
    const ids = deviceBuckets.filter((id) => (threadsByDevice.get(id)?.length ?? 0) > 0);
    return ids.sort((a, b) => {
      const rowsA = threadsByDevice.get(a) ?? [];
      const rowsB = threadsByDevice.get(b) ?? [];
      const maxA = rowsA.length ? Math.max(...rowsA.map((r) => r.lastAt)) : 0;
      const maxB = rowsB.length ? Math.max(...rowsB.map((r) => r.lastAt)) : 0;
      return maxB - maxA;
    });
  }, [deviceBuckets, threadsByDevice]);

  const isLiveView =
    selected != null
    && toChatDeviceId(selected.devId) === studioDev
    && selected.sessionId === studioSid;

  const deviceLabel = currentDevice
    ? `${currentDevice.name?.trim() || t('dock.device.unnamed', '未命名设备')} · ${currentDevice.ip}:${currentDevice.port ?? 22}`
    : t('dock.device.unbound', '未绑定设备');

  const onSelectThread = useCallback(
    (devId: string, sessionId: string) => {
      const sid = String(sessionId || '').trim();
      if (!sid) return;
      setSelected({ devId, sessionId: sid });
      resumeStudioThread(devId, sid);
      setChatExpanded(true);
    },
    [resumeStudioThread, setChatExpanded],
  );

  const onNewChat = useCallback(async () => {
    await confirmAndBeginNewChat({ aiTyping, taskHistory, t, stopAllRuns, clearChatHistory });
    setSelected({ devId: getStudioChatDeviceId(), sessionId: getStudioChatSessionId() });
    setArchiveRev((n) => n + 1);
  }, [aiTyping, taskHistory, t, stopAllRuns, clearChatHistory, getStudioChatDeviceId, getStudioChatSessionId]);

  const onExport = useCallback(() => {
    if (!selected) {
      addToast(t('chat.hub.pickThread', '请从左侧选择一个会话'), 'info');
      return;
    }
    const msgs = isLiveView
      ? chatMessages
      : loadChatHistoryFromStorage(selected.devId, selected.sessionId);
    if (!msgs.length) {
      addToast(t('chat.hub.exportEmpty', '该会话暂无消息可导出'), 'info');
      return;
    }
    try {
      const sidForName = (isLiveView ? getStudioChatSessionId() : selected.sessionId).replace(/[^\w.-]+/g, '_').slice(0, 24);
      const body = buildChatTranscriptTxt(msgs, t, {
        deviceLabel,
        sessionId: isLiveView ? getStudioChatSessionId() : selected.sessionId,
      });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadTranscriptTxt(`rdkclaw-chat-${sidForName || stamp}.txt`, body);
      addToast(t('chat.export.done', '对话已导出为 TXT'), 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : t('chat.export.fail', '导出失败'), 'error');
    }
  }, [selected, isLiveView, chatMessages, t, deviceLabel, getStudioChatSessionId, addToast]);

  const onDeleteThread = useCallback(
    (e: React.MouseEvent, devId: string, sessionId: string) => {
      e.stopPropagation();
      showConfirm(
        t('chat.hub.deleteThread', '删除此对话'),
        t('chat.hub.deleteThreadConfirm', '确定删除？本机对话存档将被彻底清除且无法恢复。'),
        () => {
          deleteStudioThread(devId, sessionId);
          if (
            selected
            && toChatDeviceId(selected.devId) === toChatDeviceId(devId)
            && selected.sessionId === sessionId
          ) {
            setSelected({
              devId: getStudioChatDeviceId(),
              sessionId: getStudioChatSessionId(),
            });
          }
          setArchiveRev((n) => n + 1);
        },
        { variant: 'danger', confirmLabel: t('chat.hub.deleteConfirmBtn', '删除') },
      );
    },
    [showConfirm, deleteStudioThread, selected, getStudioChatDeviceId, getStudioChatSessionId, t],
  );

  const rowActive = (devId: string, sessionId: string) =>
    selected != null
    && toChatDeviceId(selected.devId) === toChatDeviceId(devId)
    && selected.sessionId === sessionId;

  const isRowDockActive = (devId: string, sessionId: string) =>
    toChatDeviceId(devId) === studioDev && sessionId === studioSid;

  return (
    <div className="ai-chat-hub-page">
      <div className="ai-chat-hub-layout">
        <aside className="ai-chat-hub-sidebar" aria-label={t('chat.hub.sidebarAria', '会话列表')}>
          <header className="ai-chat-hub-sidebar-header">
            <div className="ai-chat-hub-sidebar-header-row">
              <h2 className="ai-chat-hub-sidebar-title">{t('chat.hub.sidebarTitle', '会话')}</h2>
              <div className="ai-chat-hub-sidebar-header-actions">
                <button
                  type="button"
                  className="ai-chat-hub-header-icon-btn"
                  onClick={onExport}
                  title={t('dock.header.exportChat', '导出')}
                  aria-label={t('dock.header.exportChat', '导出')}
                >
                  <Download size={17} strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  className="ai-chat-hub-header-new-btn"
                  onClick={() => void onNewChat()}
                  title={t('chat.hub.newChatShort', '新对话')}
                >
                  <MessageSquarePlus size={17} strokeWidth={2} aria-hidden />
                  <span>{t('chat.hub.newChatShort', '新对话')}</span>
                </button>
              </div>
            </div>
            <p className="ai-chat-hub-sidebar-hint">
              {t('chat.hub.sidebarHintShort', '点击会话切换；与右侧对话区同步。')}
            </p>
          </header>

          <div className="ai-chat-hub-sidebar-list ai-chat-hub-sidebar-list--devices">
            {visibleDeviceBuckets.length === 0 ? (
              <div className="ai-chat-hub-sidebar-empty">
                {t(
                  'chat.hub.noArchivedThreads',
                  '暂无已保存的对话。在工作台或此处发消息后会出现；仅会话指针、未落盘的不列出。',
                )}
              </div>
            ) : (
              visibleDeviceBuckets.map((devId) => {
                const bucketLabel = deviceSectionLabel(devId, devices, t);
                const threads = threadsByDevice.get(devId) ?? [];
                return (
                  <section key={devId} className="ai-chat-hub-device-section">
                    <div className="ai-chat-hub-device-head">
                      <button
                        type="button"
                        className="ai-chat-hub-device-chip"
                        onClick={() => {
                          const dockId = devId === GLOBAL_CHAT_DEVICE_ID ? '' : devId;
                          setActiveDevice(dockId);
                        }}
                      >
                        <span className="ai-chat-hub-device-chip-dot" aria-hidden />
                        <span className="ai-chat-hub-device-chip-label">{bucketLabel}</span>
                        <span className="ai-chat-hub-device-chip-count">{threads.length}</span>
                      </button>
                    </div>
                    <ul className="ai-chat-hub-device-threads">
                      {threads.map((row) => {
                        const active = rowActive(devId, row.sessionId);
                        const dockDot = isRowDockActive(devId, row.sessionId);
                        const timeLabel = row.lastAt ? formatChatHubThreadTime(row.lastAt, t, isEn) : '—';
                        return (
                          <li key={row.sessionId}>
                            <div
                              className={`ai-chat-hub-thread-item${active ? ' is-active' : ''}${dockDot ? ' is-dock' : ''}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => onSelectThread(devId, row.sessionId)}
                              onKeyDown={(ev) => {
                                if (ev.key === 'Enter' || ev.key === ' ') {
                                  ev.preventDefault();
                                  onSelectThread(devId, row.sessionId);
                                }
                              }}
                            >
                              <div className="ai-chat-hub-thread-item-body">
                                <div className="ai-chat-hub-thread-item-row">
                                  <span className="ai-chat-hub-thread-item-time">{timeLabel}</span>
                                  {dockDot ? (
                                    <span className="ai-chat-hub-thread-pill">{t('chat.hub.threadActivePill', '当前')}</span>
                                  ) : null}
                                </div>
                                <span className="ai-chat-hub-thread-item-title">{row.summary}</span>
                              </div>
                              <button
                                type="button"
                                className="ai-chat-hub-thread-item-delete"
                                title={t('chat.hub.deleteThread', '删除此对话')}
                                aria-label={t('chat.hub.deleteThread', '删除此对话')}
                                onClick={(e) => onDeleteThread(e, devId, row.sessionId)}
                              >
                                <Trash2 size={15} strokeWidth={2} aria-hidden />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        </aside>

        <main className="ai-chat-hub-main ai-chat-hub-main--dock-host">
          <div
            className="ai-chat-hub-dock-anchor"
            ref={setHubAnchorEl}
            aria-label={t('chat.hub.dockMountAria', 'RDKClaw 对话与输入')}
          />
        </main>
      </div>
    </div>
  );
}
