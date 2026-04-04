import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, MessageSquarePlus, Search, Trash2 } from 'lucide-react';
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
import { threadLastActivityMs } from '../utils/chat-message-timestamp';
import { confirmAndBeginNewChat } from '../utils/studio-new-chat';
import type { Device } from '../app-types';

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

/** 扁平列表用短设备名（避免与摘要抢宽度） */
function deviceRowShortLabel(id: string, devices: Device[], tr: (k: string, zh: string) => string): string {
  if (id === GLOBAL_CHAT_DEVICE_ID) return tr('chat.hub.deviceShort.global', '全局');
  const d = devices.find((x) => x.id === id);
  const name = d?.name?.trim();
  if (name) return name.length > 14 ? `${name.slice(0, 12)}…` : name;
  if (d?.ip) return d.ip;
  return `${id.slice(0, 6)}…`;
}

/** 侧栏列表时间：统一按用户本机时区 */
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

type SelectedThread = { devId: string; sessionId: string };

type ThreadRow = { sessionId: string; summary: string; lastAt: number };

type ThreadViewMode = 'all' | 'live';

export default function AiChatHubPage() {
  const {
    devices,
    activeDevice,
    setChatExpanded,
    addToast,
    showConfirm,
    aiTyping,
    taskHistory,
    stopAllRuns,
    getStudioChatSessionId,
    getStudioChatDeviceId,
    exportDebugBundleForThread,
  } = useAppState();
  const { chatMessages, resumeStudioThread, deleteStudioThread, clearChatHistory } = useAIChatStore();
  const { setHubAnchorEl } = useHubDockAnchor();
  const { t, isEn } = useI18n();

  const [archiveRev, setArchiveRev] = useState(0);
  const [selected, setSelected] = useState<SelectedThread | null>(null);
  const [searchText, setSearchText] = useState('');
  const [viewMode, setViewMode] = useState<ThreadViewMode>('all');
  const [deviceFilter, setDeviceFilter] = useState<'all' | string>('all');

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

  /** 不依赖 chatMessages：避免每条消息触发全量扫盘 */
  const deviceBuckets = useMemo(() => {
    const stored = listStoredChatHistoryDeviceIds();
    const ids = new Set<string>([GLOBAL_CHAT_DEVICE_ID, ...stored, ...devices.map((d) => d.id)]);
    const pref = String(activeDevice || '').trim();
    if (pref) ids.add(pref);
    ids.add(studioDev);
    return [...ids].sort();
  }, [devices, activeDevice, studioDev, archiveRev]);

  /** 仅从存储与会话 id 构建；刷新依赖 archiveRev / 设备列表，不因每条新消息重扫 */
  const threadsByDeviceBase = useMemo(() => {
    const map = new Map<string, ThreadRow[]>();
    for (const devId of deviceBuckets) {
      const rawSids = listStoredStudioSessionIdsForDevice(devId);
      const sidSet = new Set<string>(rawSids);
      if (toChatDeviceId(devId) === studioDev && studioSid) sidSet.add(studioSid);
      const sids = [...sidSet].filter(
        (sessionId) =>
          (sessionId === studioSid && toChatDeviceId(devId) === studioDev)
          || hasPersistedChatHistoryForSession(devId, sessionId),
      );
      if (sids.length === 0) continue;
      const rows: ThreadRow[] = sids.map((sessionId) => {
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
  }, [deviceBuckets, studioDev, studioSid, t, archiveRev]);

  /** 仅当前 studio 会话用内存消息覆盖摘要与时间，避免全表随 chatMessages 重建 */
  const threadsByDevice = useMemo(() => {
    const map = new Map(threadsByDeviceBase);
    const devKey = toChatDeviceId(studioDev);
    const sid = studioSid?.trim();
    if (!sid) return map;
    const rows = map.get(devKey);
    if (!rows?.length) return map;
    const idx = rows.findIndex((r) => r.sessionId === sid);
    if (idx < 0) return map;
    const base = rows[idx];
    const liveLast = threadLastActivityMs(chatMessages);
    const liveSummary = chatMessages.length ? buildThreadSummaryLine(chatMessages, t) : '';
    const next = [...rows];
    next[idx] = {
      ...base,
      summary: liveSummary || base.summary || t('chat.hub.emptyThread', '（空）'),
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
    return out;
  }, [threadsByDevice]);

  const liveThreadKey = useMemo(() => {
    if (!studioSid) return '';
    return `${toChatDeviceId(studioDev)}:${studioSid}`;
  }, [studioDev, studioSid]);

  const filteredThreads = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return flatThreads.filter((row) => {
      if (deviceFilter !== 'all' && toChatDeviceId(row.devId) !== toChatDeviceId(deviceFilter)) return false;
      if (viewMode === 'live' && `${toChatDeviceId(row.devId)}:${row.sessionId}` !== liveThreadKey) return false;
      if (!q) return true;
      const devLabel = deviceSectionLabel(row.devId, devices, t).toLowerCase();
      return (
        row.summary.toLowerCase().includes(q)
        || devLabel.includes(q)
        || row.sessionId.toLowerCase().includes(q)
      );
    });
  }, [searchText, flatThreads, deviceFilter, viewMode, liveThreadKey, devices, t]);

  const statsLabel = useMemo(() => {
    const total = flatThreads.length;
    const live = liveThreadKey ? 1 : 0;
    return {
      total,
      live,
    };
  }, [flatThreads.length, liveThreadKey]);

  const deviceOptions = useMemo(() => {
    const ids = new Set<string>(flatThreads.map((row) => toChatDeviceId(row.devId)));
    return [...ids].sort();
  }, [flatThreads]);

  const isLiveView =
    selected != null
    && toChatDeviceId(selected.devId) === studioDev
    && selected.sessionId === studioSid;

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
    const snapshotMessages = isLiveView
      ? chatMessages
      : loadChatHistoryFromStorage(selected.devId, selected.sessionId);
    void exportDebugBundleForThread({
      archiveDevId: selected.devId,
      sessionId: selected.sessionId,
      snapshotMessages,
    });
  }, [selected, isLiveView, chatMessages, exportDebugBundleForThread, addToast, t]);

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
    <div className="ai-chat-hub-page ai-chat-hub-page--v2">
      <div className="ai-chat-hub-v2">
        <aside className="ai-chat-hub-v2-sidebar" aria-label={t('chat.hub.sidebarAria', '会话列表')}>
          <header className="ai-chat-hub-v2-toolbar">
            <div className="ai-chat-hub-v2-toolbar-copy">
              <h2 className="ai-chat-hub-v2-toolbar-title">{t('chat.hub.sidebarTitle', '会话')}</h2>
              <p className="ai-chat-hub-v2-toolbar-subtitle">
                {t('chat.hub.sidebarSubtitle', '从记录里快速恢复上下文，继续执行任务')}
              </p>
            </div>
            <div className="ai-chat-hub-v2-toolbar-actions">
              <button
                type="button"
                className="ai-chat-hub-v2-icon-btn"
                onClick={onExport}
                title={t('dock.header.exportDebugDesc', '对话快照与 Agent 会话排查包')}
                aria-label={t('dock.header.exportDebug', '导出排查包')}
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

          <section className="ai-chat-hub-v2-controls" aria-label={t('chat.hub.controlsAria', '会话筛选控制')}>
            <div className="ai-chat-hub-v2-metrics" role="status">
              <span className="ai-chat-hub-v2-metric ai-chat-hub-v2-metric--total">
                <strong>{statsLabel.total}</strong>
                {t('chat.hub.metric.total', '全部会话')}
              </span>
              <span className="ai-chat-hub-v2-metric ai-chat-hub-v2-metric--live">
                <strong>{statsLabel.live}</strong>
                {t('chat.hub.metric.live', '进行中会话')}
              </span>
            </div>

            <label className="ai-chat-hub-v2-search" htmlFor="ai-chat-hub-search">
              <Search size={14} strokeWidth={2} aria-hidden />
              <input
                id="ai-chat-hub-search"
                type="search"
                value={searchText}
                placeholder={t('chat.hub.searchPh', '搜索会话内容、设备或 ID')}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </label>

            <div className="ai-chat-hub-v2-filter-row">
              <div className="ai-chat-hub-v2-view-switch" role="tablist" aria-label={t('chat.hub.viewMode', '视图')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'all'}
                  className={`ai-chat-hub-v2-view-btn${viewMode === 'all' ? ' is-active' : ''}`}
                  onClick={() => setViewMode('all')}
                >
                  {t('chat.hub.view.all', '全部')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'live'}
                  className={`ai-chat-hub-v2-view-btn${viewMode === 'live' ? ' is-active' : ''}`}
                  onClick={() => setViewMode('live')}
                >
                  {t('chat.hub.view.live', '当前')}
                </button>
              </div>

              <label className="ai-chat-hub-v2-device-select-wrap" htmlFor="ai-chat-hub-device-filter">
                <select
                  id="ai-chat-hub-device-filter"
                  value={deviceFilter}
                  aria-label={t('chat.hub.filter.device', '筛选设备')}
                  onChange={(e) => setDeviceFilter(e.target.value)}
                >
                  <option value="all">{t('chat.hub.filter.allDevices', '全部设备')}</option>
                  {deviceOptions.map((devId) => (
                    <option key={devId} value={devId}>
                      {deviceSectionLabel(devId, devices, t)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <div className="ai-chat-hub-v2-list" role="list">
            {filteredThreads.length === 0 ? (
              <div className="ai-chat-hub-v2-empty">
                {flatThreads.length === 0
                  ? t(
                    'chat.hub.noArchivedThreads',
                    '暂无已保存的对话。在工作台或此处发消息后会出现；仅会话指针、未落盘的不列出。',
                  )
                  : t('chat.hub.noFilteredThreads', '当前筛选条件下没有匹配会话，试试清空搜索或切换视图。')}
              </div>
            ) : (
              filteredThreads.map((row) => {
                const active = rowActive(row.devId, row.sessionId);
                const dockDot = isRowDockActive(row.devId, row.sessionId);
                const timeLabel = row.lastAt ? formatChatHubThreadTime(row.lastAt, t, isEn) : '—';
                const devShort = deviceRowShortLabel(row.devId, devices, t);
                return (
                  <div
                    key={`${row.devId}:${row.sessionId}`}
                    className={`ai-chat-hub-v2-row${active ? ' is-active' : ''}${dockDot ? ' is-live' : ''}`}
                    role="listitem"
                    tabIndex={0}
                    onClick={() => onSelectThread(row.devId, row.sessionId)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        onSelectThread(row.devId, row.sessionId);
                      }
                    }}
                  >
                    <div className="ai-chat-hub-v2-row-inner">
                      <div className="ai-chat-hub-v2-row-head">
                        <span className="ai-chat-hub-v2-chip" title={deviceSectionLabel(row.devId, devices, t)}>
                          {devShort}
                        </span>
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
                      <p className="ai-chat-hub-v2-summary">{row.summary}</p>
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
              })
            )}
          </div>
        </aside>

        <main className="ai-chat-hub-v2-main">
          <div
            className="ai-chat-hub-v2-anchor"
            ref={setHubAnchorEl}
            aria-label={t('chat.hub.dockMountAria', 'RDKClaw 对话与输入')}
          />
        </main>
      </div>
    </div>
  );
}
