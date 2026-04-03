import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessage, Device } from '../app-types';
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

function deviceFriendlyLabel(id: string, devices: Device[], tr: (k: string, zh: string) => string): string {
  if (id === GLOBAL_CHAT_DEVICE_ID) return tr('dock.history.global', '未绑定设备 / 全局');
  const d = devices.find((x) => x.id === id);
  return d?.name?.trim() || d?.ip || id;
}

/** 侧栏分组用：不再把整段 UUID 当作大标题 */
function deviceSectionLabel(id: string, devices: Device[], tr: (k: string, zh: string) => string): string {
  if (id === GLOBAL_CHAT_DEVICE_ID) return tr('dock.history.global', '未绑定设备 / 全局');
  const d = devices.find((x) => x.id === id);
  const name = d?.name?.trim();
  if (name) {
    const tail = d?.ip ? ` · ${d.ip}${d.port != null && d.port !== 22 ? `:${d.port}` : ''}` : '';
    return `${name}${tail}`;
  }
  if (d?.ip) return d.ip + (d?.port != null && d.port !== 22 ? `:${d.port}` : '');
  return `${tr('chat.hub.archivedBucket', '本机存档')}${' · '}${id.slice(0, 8)}…`;
}

type ThreadRow = {
  sessionId: string;
  timeLabel: string;
  summary: string;
  lastAt: number;
};

/** 本条线程最后一条消息/最后活动时间（用于排序与展示「最近对话」） */
function threadLastActivityMs(msgs: ChatMessage[]): number {
  if (!msgs.length) return 0;
  let max = 0;
  for (const m of msgs) {
    max = Math.max(max, m.id, m.startedAt ?? 0);
  }
  return max;
}

export default function AiChatHubPage() {
  const { devices, activeDevice, setActiveDevice, setActiveTab, setChatExpanded } = useAppState();
  const { resumeStudioThread, clearChatHistory, deleteStudioThread, chatMessages, setChatMessages } =
    useAIChatStore();
  const { t } = useI18n();

  /** 单击仅预览；双击恢复会话并跳到工作台 Dock */
  const [previewThread, setPreviewThread] = useState<{ devId: string; sessionId: string } | null>(null);
  /** 本机存档变更后刷新左侧列表（删除会话等不一定会改 chatMessages.length） */
  const [archiveRev, setArchiveRev] = useState(0);
  const [threadMenu, setThreadMenu] = useState<null | { x: number; y: number; devId: string; sessionId: string }>(
    null,
  );

  useEffect(() => {
    if (!threadMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setThreadMenu(null);
    };
    const onPointer = (e: PointerEvent) => {
      const el = e.target;
      if (el instanceof Element && el.closest('.ai-chat-hub-thread-ctx-menu')) return;
      setThreadMenu(null);
    };
    const tid = window.setTimeout(() => {
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('pointerdown', onPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [threadMenu]);

  const deviceBuckets = useMemo(() => {
    const stored = listStoredChatHistoryDeviceIds();
    const ids = new Set<string>([GLOBAL_CHAT_DEVICE_ID, ...stored, ...devices.map((d) => d.id)]);
    const pref = String(activeDevice || '').trim();
    if (pref) ids.add(pref);
    return [...ids].sort();
  }, [devices, activeDevice, chatMessages.length, archiveRev]);

  const threadsByDevice = useMemo(() => {
    const map = new Map<string, ThreadRow[]>();
    for (const devId of deviceBuckets) {
      const sids = listStoredStudioSessionIdsForDevice(devId).filter((sessionId) =>
        hasPersistedChatHistoryForSession(devId, sessionId),
      );
      if (sids.length === 0) continue;
      const rows: ThreadRow[] = sids.map((sessionId) => {
        const msgs = loadChatHistoryFromStorage(devId, sessionId);
        const lastAt = threadLastActivityMs(msgs);
        const summary = msgs.length ? buildThreadSummaryLine(msgs, t) : '';
        const timeLabel = lastAt ? new Date(lastAt).toLocaleString() : '';
        return {
          sessionId,
          timeLabel: timeLabel || '—',
          summary: summary || (msgs.length ? '' : t('chat.hub.emptyThread', '（空会话）')),
          lastAt,
        };
      });
      rows.sort((a, b) => b.lastAt - a.lastAt);
      map.set(devId, rows);
    }
    return map;
  }, [deviceBuckets, t, chatMessages.length, archiveRev]);

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

  const previewMessages = useMemo(() => {
    if (!previewThread) return [];
    return loadChatHistoryFromStorage(previewThread.devId, previewThread.sessionId);
  }, [previewThread]);

  const selectThreadPreview = (devId: string, sessionId: string) => {
    setPreviewThread({ devId, sessionId });
  };

  const openThreadInWorkspace = (rawDeviceId: string, sessionId: string) => {
    const nextDeviceId = toChatDeviceId(rawDeviceId);
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    resumeStudioThread(rawDeviceId, sid);
    setActiveTab('dashboard');
    setChatExpanded(true);
    /** 导航与 effect 跑完后再次灌入本地存档，确保工作台 Dock 里一定显示该会话历史 */
    queueMicrotask(() => {
      setChatMessages(loadChatHistoryFromStorage(nextDeviceId, sid));
      setChatExpanded(true);
    });
  };

  const isRowSelected = (devId: string, sessionId: string) =>
    previewThread != null &&
    toChatDeviceId(previewThread.devId) === toChatDeviceId(devId) &&
    previewThread.sessionId === sessionId;

  const confirmDeleteThread = (devId: string, sessionId: string) => {
    if (
      !window.confirm(
        t(
          'chat.hub.deleteThreadConfirm',
          '确定删除此会话？本机对话存档将被彻底清除且无法恢复。',
        ),
      )
    ) {
      return;
    }
    deleteStudioThread(devId, sessionId);
    setThreadMenu(null);
    if (
      previewThread &&
      toChatDeviceId(previewThread.devId) === toChatDeviceId(devId) &&
      previewThread.sessionId === sessionId
    ) {
      setPreviewThread(null);
    }
    setArchiveRev((n) => n + 1);
  };

  const ctxMenu =
    threadMenu && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="ai-chat-hub-thread-ctx-menu"
            style={{ left: threadMenu.x, top: threadMenu.y }}
            role="menu"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="ai-chat-hub-thread-ctx-item ai-chat-hub-thread-ctx-danger"
              onClick={() => confirmDeleteThread(threadMenu.devId, threadMenu.sessionId)}
            >
              {t('chat.hub.deleteThread', '删除此会话')}
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="ai-chat-hub-page">
      {ctxMenu}
      <div className="ai-chat-hub">
      <aside className="ai-chat-hub-sidebar" aria-label={t('chat.hub.sidebarAria', '对话列表')}>
        <header className="ai-chat-hub-side-head">
          <h1 className="ai-chat-hub-side-title">{t('chat.hub.title', '对话与历史')}</h1>
          <p className="ai-chat-hub-side-desc">
            {t(
              'chat.hub.desc',
              '按设备浏览本机存档；单击会话可在右侧预览，双击进入工作台在 RDKClaw 面板继续对话。',
            )}
          </p>
        </header>

        <div className="ai-chat-hub-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              clearChatHistory();
              setPreviewThread(null);
              setActiveTab('dashboard');
              setChatExpanded(true);
            }}
          >
            {t('chat.hub.startNewChat', '开启新对话')}
          </button>
        </div>

        <div className="ai-chat-hub-device-stack">
          {visibleDeviceBuckets.length === 0 ? (
            <div className="ai-chat-hub-thread-empty ai-chat-hub-stack-empty">
              {t(
                'chat.hub.noArchivedThreads',
                '暂无已保存的对话记录。在工作台发送消息后会出现在此处；仅有会话指针、未落盘的消息不会列出。',
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
                      className="ai-chat-hub-device-name"
                      onClick={() => {
                        const dockId = devId === GLOBAL_CHAT_DEVICE_ID ? '' : devId;
                        setActiveDevice(dockId);
                      }}
                    >
                      {bucketLabel}
                    </button>
                  </div>
                  <ul className="ai-chat-hub-thread-list">
                    {threads.map((row) => {
                      const summaryText = row.summary.trim();
                      const hasTime = row.timeLabel !== '' && row.timeLabel !== '—';
                      const summaryLine =
                        summaryText
                        || (!hasTime ? t('chat.hub.emptyThread', '（空会话）') : t('chat.hub.noSummaryLine', '（无摘要）'));
                      const sidTip =
                        row.sessionId.length > 14
                          ? `${row.sessionId.slice(0, 10)}…${row.sessionId.slice(-6)}`
                          : row.sessionId;
                      return (
                        <li key={row.sessionId}>
                          <button
                            type="button"
                            className={`ai-chat-hub-thread-btn${isRowSelected(devId, row.sessionId) ? ' is-active' : ''}`}
                            title={t('chat.hub.dblclickHint', '双击：在工作台打开此会话并继续')}
                            onClick={() => selectThreadPreview(devId, row.sessionId)}
                            onDoubleClick={() => openThreadInWorkspace(devId, row.sessionId)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setThreadMenu({
                                x: e.clientX,
                                y: e.clientY,
                                devId,
                                sessionId: row.sessionId,
                              });
                            }}
                          >
                            {hasTime ? (
                              <span className="ai-chat-hub-thread-time">{row.timeLabel}</span>
                            ) : null}
                            <span className="ai-chat-hub-thread-summary">{summaryLine}</span>
                            <span className="ai-chat-hub-thread-meta">
                              {t('chat.hub.threadIdHint', '会话')}: <span className="mono">{sidTip}</span>
                            </span>
                          </button>
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

      <main className="ai-chat-hub-main">
        <header className="ai-chat-hub-main-head">
          <h2 className="ai-chat-hub-main-title">{t('chat.hub.previewTitle', '预览')}</h2>
          <p className="ai-chat-hub-main-sub">
            {previewThread
              ? `${deviceFriendlyLabel(toChatDeviceId(previewThread.devId), devices, t)} · ${previewThread.sessionId.slice(0, 14)}…`
              : t('chat.hub.previewEmptySub', '单击左侧会话浏览存档 · 双击在工作台继续')}
          </p>
        </header>
        <div className="ai-chat-hub-stream">
          {!previewThread ? (
            <div className="ai-chat-hub-empty">{t('chat.hub.streamEmpty', '单击左侧会话预览；双击进入工作台继续对话。')}</div>
          ) : previewMessages.length === 0 ? (
            <div className="ai-chat-hub-empty">{t('chat.hub.previewNoMessages', '该会话暂无消息。仍可在工作台打开并发送新消息。')}</div>
          ) : (
            previewMessages.map((msg) => {
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
      </main>
      </div>
    </div>
  );
}
