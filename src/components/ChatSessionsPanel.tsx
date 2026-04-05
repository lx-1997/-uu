import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, MessageCircle, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useAppState } from '../hooks/useAppState';
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
import {
  effectiveThreadActivityMs,
  parseUiSessionIdMs,
  threadLastActivityMs,
} from '../utils/chat-message-timestamp';
import { confirmAndBeginNewChat, confirmSwitchStudioThread } from '../utils/studio-new-chat';

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
  const hm = new Intl.DateTimeFormat(isEn ? 'en-US' : 'zh-CN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: isEn,
  }).format(d);
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

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/** 按日历日分组（今天 / 昨天 / 具体日期）；ms 为 0 时用 sessionId 内嵌时间 */
function sessionBucketKey(ms: number, sessionId: string): string {
  const effective = ms > 0 ? ms : parseUiSessionIdMs(sessionId);
  const now = new Date();
  const d = effective > 0 ? new Date(effective) : now;
  const sod = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((sod(now) - sod(d)) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function sessionBucketLabel(
  key: string,
  tr: (k: string, zh: string) => string,
  isEn: boolean,
): string {
  if (key === 'today') return tr('chat.hub.group.today', '今天');
  if (key === 'yesterday') return tr('chat.hub.group.yesterday', '昨天');
  const parts = key.split('-');
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return key;
  const now = new Date();
  if (y === now.getFullYear()) {
    return isEn
      ? new Date(y, mo - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `${mo}月${day}日`;
  }
  return isEn
    ? new Date(y, mo - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : `${y}年${mo}月${day}日`;
}

type SelectedThread = { devId: string; sessionId: string };

type ThreadRow = { sessionId: string; summary: string; lastAt: number };

export type ChatSessionsPanelProps = {
  /** dock 内为紧凑面板；page 保留整页外边距（少用） */
  layout?: 'dock' | 'page';
  /** 选中新会话或新对话后关闭浮层 */
  onRequestClose?: () => void;
  idPrefix?: string;
};

export default function ChatSessionsPanel({
  layout = 'page',
  onRequestClose,
  idPrefix: _idPrefix = 'chat-sessions',
}: ChatSessionsPanelProps) {
  const {
    devices,
    activeDevice,
    setChatExpanded,
    addToast,
    showConfirm,
    aiTyping,
    taskHistory,
    backgroundRuns,
    stopAllRuns,
    getStudioChatSessionId,
    getStudioChatDeviceId,
    chatMessages,
    resumeStudioThread,
    deleteStudioThread,
    clearChatHistory,
    exportDebugBundleForThread,
  } = useAppState();
  const { t, isEn } = useI18n();

  const [archiveRev, setArchiveRev] = useState(0);
  const [selected, setSelected] = useState<SelectedThread | null>(null);

  const studioDev = getStudioChatDeviceId();
  const studioSid = getStudioChatSessionId();

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
  }, [devices, activeDevice, studioDev, archiveRev]);

  const threadsByDeviceBase = useMemo(() => {
    const map = new Map<string, ThreadRow[]>();
    for (const devId of deviceBuckets) {
      const rawSids = listStoredStudioSessionIdsForDevice(devId);
      const sidSet = new Set<string>(rawSids);
      if (toChatDeviceId(devId) === studioDev && studioSid) sidSet.add(studioSid);
      const sids = [...sidSet].filter((sessionId) =>
        hasPersistedChatHistoryForSession(devId, sessionId),
      );
      if (sids.length === 0) continue;
      const rows: ThreadRow[] = sids.map((sessionId) => {
        const msgs = loadChatHistoryFromStorage(devId, sessionId);
        const lastAt = effectiveThreadActivityMs(msgs, sessionId);
        const summary = msgs.length ? buildThreadSummaryLine(msgs, t) : '';
        return {
          sessionId,
          summary: summary || t('chat.hub.noSummaryLine', '（无摘要）'),
          lastAt,
        };
      });
      rows.sort((a, b) => b.lastAt - a.lastAt);
      map.set(devId, rows);
    }
    return map;
  }, [deviceBuckets, studioDev, studioSid, t, archiveRev]);

  const threadsByDevice = useMemo(() => {
    const map = new Map(threadsByDeviceBase);
    const devKey = toChatDeviceId(studioDev);
    const sid = studioSid?.trim();
    if (!sid) return map;

    const liveLast = effectiveThreadActivityMs(chatMessages, sid);
    const liveSummary = chatMessages.length ? buildThreadSummaryLine(chatMessages, t) : '';
    const hasLiveMessages = chatMessages.length > 0;

    const rows = map.get(devKey);
    /** 无存档行时：仅当当前 Dock 里已有消息时，才补一行「当前线程」便于对照顶栏 */
    if (!rows?.length) {
      if (hasLiveMessages) {
        map.set(devKey, [{
          sessionId: sid,
          summary: liveSummary,
          lastAt: Math.max(liveLast, parseUiSessionIdMs(sid), Date.now()),
        }]);
      }
      return map;
    }

    const idx = rows.findIndex((r) => String(r.sessionId).trim() === sid);
    if (idx < 0) {
      if (!hasLiveMessages) return map;
      const next = [...rows, {
        sessionId: sid,
        summary: liveSummary,
        lastAt: Math.max(liveLast, parseUiSessionIdMs(sid)),
      }];
      next.sort((a, b) => b.lastAt - a.lastAt);
      map.set(devKey, next);
      return map;
    }

    const base = rows[idx];
    const next = [...rows];
    next[idx] = {
      ...base,
      summary: liveSummary || base.summary,
      lastAt: Math.max(base.lastAt, liveLast),
    };
    next.sort((a, b) => b.lastAt - a.lastAt);
    map.set(devKey, next);
    return map;
  }, [threadsByDeviceBase, studioDev, studioSid, chatMessages, t]);

  const flatThreads = useMemo(() => {
    const out: Array<ThreadRow & { devId: string }> = [];
    for (const [devId, rows] of threadsByDevice) {
      for (const r of rows) {
        out.push({ devId, ...r });
      }
    }
    out.sort((a, b) => b.lastAt - a.lastAt);
    /** 当前 Dock 会话行（若有）置顶，避免 lastAt=0 沉底 */
    const sid = studioSid?.trim();
    if (sid) {
      const curKey = `${toChatDeviceId(studioDev)}:${sid}`;
      const idx = out.findIndex((x) => `${toChatDeviceId(x.devId)}:${x.sessionId}` === curKey);
      if (idx > 0) {
        const [row] = out.splice(idx, 1);
        out.unshift(row);
      }
    }
    return out;
  }, [threadsByDevice, studioDev, studioSid]);

  const threadSections = useMemo(() => {
    const sections: Array<{ bucket: string; label: string; rows: Array<ThreadRow & { devId: string }> }> = [];
    let lastBucket = '';
    for (const row of flatThreads) {
      const key = sessionBucketKey(row.lastAt, row.sessionId);
      if (key !== lastBucket) {
        lastBucket = key;
        sections.push({
          bucket: key,
          label: sessionBucketLabel(key, t, isEn),
          rows: [row],
        });
      } else {
        sections[sections.length - 1].rows.push(row);
      }
    }
    return sections;
  }, [flatThreads, t, isEn]);

  const onSelectThread = useCallback(
    async (devId: string, sessionId: string) => {
      const sid = String(sessionId || '').trim();
      if (!sid) return;
      if (toChatDeviceId(devId) === toChatDeviceId(studioDev) && sid === studioSid) {
        onRequestClose?.();
        return;
      }
      const proceed = await confirmSwitchStudioThread({
        aiTyping,
        taskHistory,
        backgroundRuns,
        t,
        showConfirm,
        stopAllRuns,
      });
      if (!proceed) return;
      setSelected({ devId, sessionId: sid });
      resumeStudioThread(devId, sid);
      setChatExpanded(true);
      onRequestClose?.();
    },
    [
      studioDev,
      studioSid,
      aiTyping,
      taskHistory,
      backgroundRuns,
      t,
      stopAllRuns,
      showConfirm,
      resumeStudioThread,
      setChatExpanded,
      onRequestClose,
    ],
  );

  const onNewChat = useCallback(async () => {
    await confirmAndBeginNewChat({
      aiTyping,
      taskHistory,
      backgroundRuns,
      t,
      showConfirm,
      stopAllRuns,
      clearChatHistory,
    });
    setSelected({ devId: getStudioChatDeviceId(), sessionId: getStudioChatSessionId() });
    setArchiveRev((n) => n + 1);
  }, [aiTyping, taskHistory, backgroundRuns, t, showConfirm, stopAllRuns, clearChatHistory, getStudioChatDeviceId, getStudioChatSessionId]);

  const onExportSession = useCallback(() => {
    const devId = getStudioChatDeviceId();
    const sessionId = getStudioChatSessionId().trim();
    if (!sessionId) {
      addToast(t('chat.hub.pickThread', '请选择一个会话'), 'info');
      return;
    }
    const isLive =
      toChatDeviceId(devId) === toChatDeviceId(studioDev) && sessionId === studioSid;
    const snapshotMessages = isLive
      ? chatMessages
      : loadChatHistoryFromStorage(devId, sessionId);
    void exportDebugBundleForThread({
      archiveDevId: devId,
      sessionId,
      snapshotMessages,
    });
  }, [
    chatMessages,
    exportDebugBundleForThread,
    addToast,
    t,
    getStudioChatDeviceId,
    getStudioChatSessionId,
    studioDev,
    studioSid,
  ]);

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

  const inner = (
    <aside
      className={`ai-chat-hub-v2-sidebar ai-chat-hub-v2-sidebar--sessions-refined${
        layout === 'dock' ? ' ai-chat-hub-v2-sidebar--dock' : ''
      }`}
      aria-label={t('chat.hub.sidebarAria', '会话列表')}
    >
      <header
        className={`ai-chat-hub-v2-toolbar${layout === 'dock' ? ' ai-chat-hub-v2-toolbar--dock-popover' : ''}`}
      >
        <div className="ai-chat-hub-v2-toolbar-copy">
          <h2 className="ai-chat-hub-v2-toolbar-title">{t('chat.hub.sidebarTitle', '会话')}</h2>
          {layout === 'page' ? (
            <p className="ai-chat-hub-v2-toolbar-subtitle">
              {t('chat.hub.sidebarSubtitle', '切换会话后，在底部 Dock 或工作台继续对话')}
            </p>
          ) : layout === 'dock' ? (
            <p className="ai-chat-hub-v2-toolbar-subtitle ai-chat-hub-v2-toolbar-subtitle--dock">
              {t('chat.hub.sidebarSubtitleDock', '点一条在下方 Dock 继续；仅列出已有消息的对话')}
            </p>
          ) : null}
        </div>
        <div className="ai-chat-hub-v2-toolbar-actions">
          <button
            type="button"
            className="ai-chat-hub-v2-icon-btn"
            onClick={onExportSession}
            title={t('dock.header.exportDebugDesc', '导出运行诊断包（含本机会话与界面信息，可选设备日志）')}
            aria-label={t('chat.hub.exportSessionShort', '下载诊断包')}
          >
            <Download size={17} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="ai-chat-hub-v2-new-btn"
            onClick={() => void onNewChat()}
            title={t('chat.hub.newChatShort', '新对话')}
          >
            <MessageSquarePlus size={16} strokeWidth={2} aria-hidden />
            <span>{t('chat.hub.newChatShort', '新对话')}</span>
          </button>
        </div>
      </header>

      <div className="ai-chat-hub-v2-list">
        {flatThreads.length === 0 ? (
          <div className="ai-chat-hub-v2-empty">
            {t(
              'chat.hub.noArchivedThreads',
              '暂无已保存的对话。在下方 Dock 输入并发送后，会出现在此列表。',
            )}
          </div>
        ) : (
          threadSections.map((section) => (
            <section key={section.bucket} className="ai-chat-hub-v2-section" aria-label={section.label}>
              <h3 className="ai-chat-hub-v2-section-label">{section.label}</h3>
              <div className="ai-chat-hub-v2-section-rows" role="list">
                {section.rows.map((row) => {
                  const active = rowActive(row.devId, row.sessionId);
                  const dockDot = isRowDockActive(row.devId, row.sessionId);
                  const displayTimeMs = row.lastAt || parseUiSessionIdMs(row.sessionId);
                  const timeLabel = displayTimeMs ? formatChatHubThreadTime(displayTimeMs, t, isEn) : '—';
                  return (
                    <div
                      key={`${row.devId}:${row.sessionId}`}
                      className={`ai-chat-hub-v2-row${active ? ' is-active' : ''}${dockDot ? ' is-live' : ''}`}
                      role="listitem"
                      tabIndex={0}
                      onClick={() => void onSelectThread(row.devId, row.sessionId)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          void onSelectThread(row.devId, row.sessionId);
                        }
                      }}
                    >
                      <div className="ai-chat-hub-v2-row-inner">
                        <span className="ai-chat-hub-v2-row-glyph" aria-hidden>
                          <MessageCircle
                            size={18}
                            strokeWidth={active ? 2.25 : 1.75}
                            className={active ? 'is-on' : undefined}
                          />
                        </span>
                        <div className="ai-chat-hub-v2-row-text">
                          <p className="ai-chat-hub-v2-row-title">{row.summary}</p>
                          <div className="ai-chat-hub-v2-row-meta">
                            {dockDot ? (
                              <span className="ai-chat-hub-v2-live">{t('chat.hub.threadActivePill', '当前')}</span>
                            ) : null}
                            <span
                              className="ai-chat-hub-v2-time"
                              title={t('chat.hub.timeLocalHint', '按本机时区显示')}
                            >
                              {timeLabel}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="ai-chat-hub-v2-row-del"
                        title={t('chat.hub.deleteThread', '删除此对话')}
                        aria-label={t('chat.hub.deleteThread', '删除此对话')}
                        onClick={(e) => onDeleteThread(e, row.devId, row.sessionId)}
                      >
                        <Trash2 size={15} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </aside>
  );

  if (layout === 'dock') {
    return <div className="dock-chat-sessions-panel">{inner}</div>;
  }

  return (
    <div className="ai-chat-hub-page ai-chat-hub-page--v2">
      <div className="ai-chat-hub-v2 ai-chat-hub-v2--list-only">{inner}</div>
    </div>
  );
}
