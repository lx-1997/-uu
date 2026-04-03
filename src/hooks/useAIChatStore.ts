import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ChatBlock, AgentPlan, AgentExecutionState, ChatAttachment } from '../app-types';
import { CMD_SUGGESTIONS, type CmdSuggestion } from '../constants';
import { translate } from '../i18n/translate';
import { fillTemplate } from '../i18n/en-extras';
import {
  bindRDKClawFeishuCode,
  cancelRDKClawRun,
  cancelAllRDKClawRuns,
  decideRDKClawApproval,
  sendRecommendationChoice,
  executeDeviceCommand,
  deployOneShotApp,
  generateOneShotApp,
  runOneShotApp,
  validateOneShotApp,
  setActiveRdkclawDevice,
  setActiveRdkclawSession,
  stopRDKClawTask,
  streamAgentChat,
  downloadRdkclawDebugBundle,
  fetchDevices,
  forgetDevicePassword,
  fetchDeviceOpenClawHealth,
  type AgentAttachmentPayload,
  type AgentSSEEvent,
  type StudioResponseMode,
} from '../api';
import { persistOpenClawHealthSnapshot, persistGatewayStatusSnapshot } from '../studio-ui-hints';
import {
  CHAT_HISTORY_LEGACY_KEY,
  GLOBAL_CHAT_DEVICE_ID,
  chatHistoryLegacyDeviceKey,
  chatHistoryStorageKey,
  getOrCreateStudioChatSessionId,
  purgeLocalChatThread,
  loadChatHistoryFromStorage,
  peekStudioChatSessionId,
  persistStudioChatSessionId,
  toChatDeviceId,
} from '../utils/chat-history-storage';
import { fetchApi } from '../utils/apiBase';
import { getRdkEmbedPanel } from '../utils/embed-mode';
import type { Task } from '../ai';
import { useToastStore } from './useToastStore';
import { useDeviceStore } from './useDeviceStore';
import { useUIStore } from './useUIStore';
import {
  executorLabel,
  resolveToolName,
  resolveToolId,
  resolvePhase,
  resolveDecisionSourceLabel,
  summarizeToolArgs,
  splitOpenClawCollaborationResult,
  extractNeedRdkclawBlocks,
  formatBoardOutboundLines,
  isBoardOpenClawCollabTool,
  isBoardOpenClawExecutorTool,
  collapseRepeatedBoardToolNotifyLines,
  formatToolStatusTitle,
} from './sse-helpers';
import { applyClientActionsFromAssistantText } from '../utils/client-action-bridge';

/** RDKClaw 当前轮次运行时间线（AI Dock 侧栏展示） */
export type RdkClawTimelineKind =
  | 'setup'
  | 'context'
  | 'reasoning'
  | 'tool_start'
  | 'tool_end'
  | 'board_tool'
  | 'progress'
  | 'complete';

export interface RdkClawTimelineEntry {
  id: string;
  at: number;
  kind: RdkClawTimelineKind;
  title: string;
  detail?: string;
}

export interface AIChatStoreState {
  cmd: string;
  setCmd: (v: string) => void;
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  filteredSuggestions: CmdSuggestion[];
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  chatExpanded: boolean;
  setChatExpanded: (v: boolean) => void;
  aiTyping: boolean;
  setAiTyping: React.Dispatch<React.SetStateAction<boolean>>;
  handleCommand: (
    e: React.FormEvent,
    options?: {
      messageOverride?: string;
      /** 仅影响聊天列表展示；发给模型的内容仍用 messageOverride（用于「不满意重试」等短气泡） */
      chatPreviewText?: string;
      attachments?: AgentAttachmentPayload[];
      displayAttachments?: ChatAttachment[];
      regenerate?: {
        removeAiMessageId: number;
        anchorUserMessageId: number;
        message: string;
        attachments: AgentAttachmentPayload[];
      };
    },
  ) => void;
  executeConfirm: (confirmId: string) => void;
  dismissConfirm: (confirmId: string) => void;
  clearChatHistory: () => void;
  /** 切换到本机已存档的对话线程（可跨设备），并展开 Dock */
  resumeStudioThread: (deviceId: string, studioSessionId: string) => void;
  /** 删除指定线程的本机存档；若即当前 Dock 会话则中止请求并开启新线程 */
  deleteStudioThread: (deviceId: string, studioSessionId: string) => void;
  agentMode: boolean;
  setAgentMode: (v: boolean) => void;
  agentPlan: AgentPlan | null;
  agentExecution: AgentExecutionState;
  taskHistory: Task[];
  showTaskPanel: boolean;
  setShowTaskPanel: (v: boolean) => void;
  cancelRunningTask: (taskId: string) => void;
  handleApprovalAction: (
    approvalId: string,
    action: 'allow_once' | 'allow_session_auto' | 'allow_global_auto' | 'deny' | 'cancel_run',
    runId?: string,
  ) => void;
  handleRecommendationChoice: (recommendationId: string, choiceId: string, autoExecute: boolean) => void;
  handleSoulUpdateDecision: (proposalId: string, accepted: boolean) => void;
  stopCurrentRun: () => void;
  stopAllRuns: () => void;
  backgroundCurrentRun: () => void;
  backgroundRuns: Array<{
    runId: string;
    status: 'running' | 'ended';
    detachedAt: number;
  }>;
  stopBackgroundRun: (runId: string) => void;

  /** 当前轮次 SSE 时间线（发送新消息时重置） */
  rdkClawRunTimeline: RdkClawTimelineEntry[];
  runTimelinePanelOpen: boolean;
  setRunTimelinePanelOpen: (v: boolean) => void;

  /** 工作台 RDK 对话：思考沿设置页模型；快速弱化扩展思考与推理流 */
  studioResponseMode: StudioResponseMode;
  setStudioResponseMode: (v: StudioResponseMode) => void;

  /** 导出排查 zip（服务端 Agent 会话、Dock 快照、可选板端日志） */
  exportDebugBundle: (options?: { includeBoardLogs?: boolean }) => Promise<void>;
  /** 当前窗口 RDKClaw 对话绑定的 Studio 会话 id（与 Dock 一致） */
  getStudioChatSessionId: () => string;
  /** 对话存档所用设备桶（`__global__` 或具体设备 id） */
  getStudioChatDeviceId: () => string;
}

const AIChatContext = createContext<AIChatStoreState | null>(null);

/** 内存中对话条数上限，避免长会话撑爆渲染进程 */
const MAX_CHAT_MESSAGES_IN_MEMORY = 100;
const LARGE_DATA_URL_STORAGE_CHARS = 48_000;
const CHAT_DRAFT_KEY_PREFIX = 'rdk:chat:draft:';
const STUDIO_RESPONSE_MODE_LS = 'rdk:studio-response-mode';

function parseStoredStudioResponseMode(): StudioResponseMode {
  try {
    const v = localStorage.getItem(STUDIO_RESPONSE_MODE_LS)?.trim();
    if (v === 'quick') return 'quick';
  } catch {
    /* ignore */
  }
  return 'thinking';
}

function chatDraftStorageKey(deviceId: string) {
  return `${CHAT_DRAFT_KEY_PREFIX}${toChatDeviceId(deviceId)}`;
}

/** 无设备时的会话与某台设备会话合并（按 id 去重、按时间排序），避免「对话连上设备后整段消失」 */
function mergeChatMessagesById(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const map = new Map<number, ChatMessage>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) {
    if (!map.has(m.id)) map.set(m.id, m);
  }
  return Array.from(map.values())
    .sort((x, y) => x.id - y.id)
    .slice(-MAX_CHAT_MESSAGES_IN_MEMORY);
}

/** 写入 localStorage 前去掉较早消息里巨型 data: URL，减轻 quota 与反序列化压力 */
function stripHeavyDataUrlsForStorage(messages: ChatMessage[]): ChatMessage[] {
  const keepLast = 6;
  const keepFrom = Math.max(0, messages.length - keepLast);
  return messages.map((m, i) => {
    if (i >= keepFrom) return m;

    let attachments = m.attachments;
    if (attachments?.length) {
      const next = attachments.map((a: ChatAttachment) => {
        const u = a.url;
        if (typeof u === 'string' && u.startsWith('data:') && u.length > LARGE_DATA_URL_STORAGE_CHARS) {
          return { ...a, url: '[omitted-large-data-url]' };
        }
        return a;
      });
      if (next.some((a, j) => a !== attachments![j])) attachments = next;
    }

    let blocks = m.blocks;
    if (blocks?.length) {
      const next = blocks.map((b) => {
        if (b.type === 'image' || b.type === 'video') {
          const src = b.src;
          if (typeof src === 'string' && src.startsWith('data:') && src.length > LARGE_DATA_URL_STORAGE_CHARS) {
            return { ...b, src: '[omitted-large-data-url]' };
          }
        }
        return b;
      });
      if (next.some((b, j) => b !== blocks![j])) blocks = next;
    }

    if (attachments === m.attachments && blocks === m.blocks) return m;
    return { ...m, attachments, blocks };
  });
}

export function useAIChatStore(): AIChatStoreState {
  const ctx = useContext(AIChatContext);
  if (!ctx) throw new Error('useAIChatStore must be used within AIChatProvider');
  return ctx;
}

export function AIChatProvider({ children }: { children: React.ReactNode }) {
  const { addToast } = useToastStore();
  const { currentDevice, setActiveDevice, setDevices, devices } = useDeviceStore();
  const { activeTab, setShowSettings, language } = useUIStore();
  const isEn = language === 'en';
  const t = (key: string, zh: string) => translate(isEn, key, zh);
  const tf = (key: string, zh: string, vars: Record<string, string | number>) =>
    fillTemplate(t(key, zh), vars);
  const initialChatDeviceId = toChatDeviceId(currentDevice?.id);
  const initialStudioSessionId =
    typeof window !== 'undefined' ? getOrCreateStudioChatSessionId(initialChatDeviceId) : `ui-${Date.now()}`;
  const chatDeviceIdRef = useRef(initialChatDeviceId);
  const sessionIdRef = useRef(initialStudioSessionId);
  const chatPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 用于主导航 tab 切换时判断是否为「AI 对话 → 工作台」（双击历史跳转时勿收起 Dock） */
  const prevNavTabRef = useRef<string | null>(null);

  // ── State ──
  const [cmd, setCmd] = useState('');
  const [studioResponseMode, setStudioResponseModeState] = useState<StudioResponseMode>(() => parseStoredStudioResponseMode());
  const setStudioResponseMode = useCallback((v: StudioResponseMode) => {
    setStudioResponseModeState(v);
    try {
      localStorage.setItem(STUDIO_RESPONSE_MODE_LS, v);
    } catch {
      /* ignore */
    }
  }, []);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
    typeof window !== 'undefined'
      ? loadChatHistoryFromStorage(initialChatDeviceId, initialStudioSessionId)
      : [],
  );
  /** 每轮渲染与 state 同步，供 debounce 持久化避免闭包 stale */
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  chatMessagesRef.current = chatMessages;

  useEffect(() => {
    if (chatMessages.length <= MAX_CHAT_MESSAGES_IN_MEMORY) return;
    setChatMessages((prev) => prev.slice(-MAX_CHAT_MESSAGES_IN_MEMORY));
  }, [chatMessages.length]);

  const [chatExpanded, setChatExpanded] = useState(false);
  const [aiTyping, setAiTyping] = useState(false);
  const pendingActionsRef = useRef<Record<string, () => void>>({});
  const activeTaskCountRef = useRef(0);
  const taskIntervalsRef = useRef<Record<string, number>>({});
  const cancelledTasksRef = useRef<Set<string>>(new Set());

  const [taskHistory, setTaskHistory] = useState<Task[]>([]);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [agentExecution, setAgentExecution] = useState<AgentExecutionState>({ running: false, currentStep: 0, totalSteps: 0 });
  const agentAbortRef = useRef(false);
  const [backgroundRuns, setBackgroundRuns] = useState<Array<{
    runId: string;
    status: 'running' | 'ended';
    detachedAt: number;
  }>>([]);

  const [rdkClawRunTimeline, setRdkClawRunTimeline] = useState<RdkClawTimelineEntry[]>([]);
  const [runTimelinePanelOpen, setRunTimelinePanelOpen] = useState(false);
  const timelineSeqRef = useRef(0);
  const boardToolTimelineSigRef = useRef('');

  const allCmdSuggestions: CmdSuggestion[] = useMemo(
    () =>
      CMD_SUGGESTIONS.map((s) => ({
        icon: s.icon,
        text: isEn ? s.textEn : s.textZh,
        keyword: s.keyword,
        textZh: s.textZh,
        textEn: s.textEn,
      })),
    [isEn],
  );
  const q = cmd.trim();
  const filteredSuggestions = q
    ? allCmdSuggestions.filter(
        (s) =>
          s.text.includes(cmd) ||
          s.textZh.includes(cmd) ||
          s.textEn.toLowerCase().includes(q.toLowerCase()) ||
          s.keyword.toLowerCase().includes(q.toLowerCase()),
      )
    : allCmdSuggestions;

  // ── Confirm / Dismiss ──
  const executeConfirm = (confirmId: string) => {
    const action = pendingActionsRef.current[confirmId];
    if (!action) return;
    delete pendingActionsRef.current[confirmId];
    setChatMessages(prev => prev.map(msg => ({
      ...msg,
      blocks: msg.blocks?.map(b => b.type === 'confirm' && b.confirmId === confirmId
        ? { type: 'task-result' as const, success: true, title: t('chat.store.confirmed', '已确认'), detail: t('chat.store.executing', '正在执行...') }
        : b
      ),
    })));
    setAiTyping(true);
    setTimeout(() => action(), 300);
  };

  const dismissConfirm = (confirmId: string) => {
    delete pendingActionsRef.current[confirmId];
    setChatMessages(prev => prev.map(msg => ({
      ...msg,
      blocks: msg.blocks?.map(b => b.type === 'confirm' && b.confirmId === confirmId
        ? { type: 'task-result' as const, success: false, title: t('chat.store.cancelled', '已取消'), detail: t('chat.store.cancelledDetail', '操作已取消') }
        : b
      ),
    })));
  };

  const clearChatHistory = () => {
    /** 必须先结束进行中的流式请求：否则旧 SSE 仍按已删消息 id 更新，且可能与新一轮竞态导致「发消息无回复」 */
    abortInFlightRun(false);
    setChatMessages([]);
    try {
      const deviceId = chatDeviceIdRef.current;
      const sid = sessionIdRef.current;
      localStorage.removeItem(chatHistoryStorageKey(deviceId, sid));
      localStorage.removeItem(chatHistoryLegacyDeviceKey(deviceId));
      localStorage.removeItem(chatDraftStorageKey(deviceId));
      if (toChatDeviceId(deviceId) === GLOBAL_CHAT_DEVICE_ID) {
        localStorage.removeItem(CHAT_HISTORY_LEGACY_KEY);
      }
      const nextSid = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      sessionIdRef.current = nextSid;
      persistStudioChatSessionId(deviceId, nextSid);
      void setActiveRdkclawSession(nextSid);
    } catch {
      // ignore
    }
    setRdkClawRunTimeline([]);
    addToast(
      t(
        'chat.store.historyCleared',
        '已在本窗口开启新对话线程，长期记忆与工作区档案仍保留。',
      ),
      'info',
    );
  };

  // ── Cancel task ──
  const cancelRunningTask = (taskId: string) => {
    if (taskIntervalsRef.current[taskId]) {
      clearInterval(taskIntervalsRef.current[taskId]);
      delete taskIntervalsRef.current[taskId];
    }
    activeTaskCountRef.current = Math.max(0, activeTaskCountRef.current - 1);
    if (activeTaskCountRef.current === 0) setAiTyping(false);
    setTaskHistory(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'cancelled' } : t,
    ));
    addToast(t('chat.store.taskCancelled', '任务已取消'), 'info');
  };

  const commandLockRef = useRef(false);
  const currentRunIdRef = useRef('');
  const streamAbortRef = useRef<null | (() => void)>(null);
  const lastGeneratedAppRef = useRef<{ name: string; rootDir: string; runCommand: string } | null>(null);
  const lastDeployFixRef = useRef<{
    deviceId: string;
    remoteDir: string;
    runCommand: string;
    suggestions: Array<{ title: string; detail: string; command?: string }>;
  } | null>(null);
  const streamGenerationRef = useRef(0);
  const appendRunTimelineEntry = useCallback((gen: number, entry: Omit<RdkClawTimelineEntry, 'id' | 'at'>) => {
    if (gen !== streamGenerationRef.current) return;
    timelineSeqRef.current += 1;
    const id = `tl-${timelineSeqRef.current}-${Date.now()}`;
    setRdkClawRunTimeline((prev) =>
      [...prev, { ...entry, id, at: Date.now(), detail: entry.detail ? entry.detail.slice(0, 600) : undefined }].slice(-200),
    );
  }, []);
  const toolTimelineRef = useRef<Record<string, {
    toolName: string;
    executor: string;
    startedAt: number;
    /** 快速回答：本地工具不落 UI 时为 -1 */
    statusIndex: number;
    /** 快速回答：本地工具隐藏；凡 board_openclaw_* / 跨板调度仍展示 */
    hiddenQuick?: boolean;
    rawIndex?: number;
    /** 板端 OpenClaw 协作流式块（与 terminal 二选一） */
    collabIndex?: number;
    /** board_openclaw_chat：Studio 插入的等待提示块（非板端输出） */
    waitHintCollabIndex?: number;
    /** 合并逐字/逐块 SSE，避免每个 chunk 被当成一行导致竖排假换行 */
    openclawStreamBuf?: string;
    /** summarizeToolArgs，进度/结束时保留路径等目标信息 */
    argDetail?: string;
    cardTitle?: string;
  }>>({});
  const latestBoardToolRef = useRef<string | null>(null);
  /** 当前轮 assistant 消息里 reasoning 块的 aiBlocks 下标 */
  const reasoningBlockIndexRef = useRef<number | null>(null);
  const reasoningTimelineSentRef = useRef(false);
  const approvalBlockRef = useRef<Record<string, number>>({});
  const userStorageKey = 'rdk:chat:user-id';
  const readOrCreateStableId = (key: string, prefix: string) => {
    try {
      const existing = localStorage.getItem(key);
      if (existing?.trim()) return existing.trim();
      const created = `${prefix}-${Date.now()}`;
      localStorage.setItem(key, created);
      return created;
    } catch {
      return `${prefix}-${Date.now()}`;
    }
  };
  const userIdRef = useRef(readOrCreateStableId(userStorageKey, 'studio-user'));
  const persistSessionId = (value: string) => {
    const next = String(value || '').trim();
    if (!next) return;
    sessionIdRef.current = next;
    persistStudioChatSessionId(chatDeviceIdRef.current, next);
  };
  const feishuMirrorSeenRef = useRef<Set<string>>(new Set());
  const feishuToolMessageRef = useRef<Record<string, number>>({});
  const feishuLastToolKeyRef = useRef('');
  const showDebugTurnsRef = useRef<boolean>((() => {
    try {
      return localStorage.getItem('rdk:chat:debug-turns') === '1';
    } catch {
      return false;
    }
  })());
  const syncWarnAtRef = useRef<{ session: number; device: number }>({ session: 0, device: 0 });
  const reportActiveSession = (reason: string) => {
    const sessionId = String(sessionIdRef.current || '').trim();
    if (!sessionId) return;
    setActiveRdkclawSession(sessionId)
      .then(() => {
        console.debug(`[RDKClawSync] session reported (${reason}): ${sessionId.slice(0, 10)}...`);
      })
      .catch((error) => {
        console.warn('[RDKClawSync] session report failed:', error instanceof Error ? error.message : error);
        const ts = Date.now();
        if (ts - syncWarnAtRef.current.session > 30_000) {
          syncWarnAtRef.current.session = ts;
          addToast(t('chat.sync.sessionFail', '会话同步上报失败，飞书可能无法接入当前会话'), 'warning');
        }
      });
  };
  const reportActiveDevice = (reason: string, explicitDeviceId?: string) => {
    const deviceId = String(explicitDeviceId || currentDevice?.id || '').trim();
    if (!deviceId) return;
    setActiveRdkclawDevice(deviceId)
      .then(() => {
        console.debug(`[RDKClawSync] device reported (${reason}): ${deviceId}`);
      })
      .catch((error) => {
        console.warn('[RDKClawSync] device report failed:', error instanceof Error ? error.message : error);
        const ts = Date.now();
        if (ts - syncWarnAtRef.current.device > 30_000) {
          syncWarnAtRef.current.device = ts;
          addToast(t('chat.sync.deviceFail', '设备同步上报失败，飞书可能无法复用当前设备'), 'warning');
        }
      });
  };

  const abortCooldownRef = useRef(false);

  const abortInFlightRun = (announce: boolean) => {
    const runId = currentRunIdRef.current;
    streamGenerationRef.current += 1;
    streamAbortRef.current?.();
    streamAbortRef.current = null;
    if (runId) {
      cancelRDKClawRun(runId).catch(() => null);
    }
    currentRunIdRef.current = '';
    commandLockRef.current = false;
    setAiTyping(false);
    if (announce) {
      abortCooldownRef.current = true;
      setTimeout(() => { abortCooldownRef.current = false; }, 600);
      const abortAiTs = Date.now();
      setChatMessages((prev) => [...prev, {
        id: abortAiTs,
        role: 'ai',
        text: t('chat.abort.taskEnded', '当前任务已结束。你可以继续输入新的指令。'),
        blocks: [{
          type: 'task-result',
          success: false,
          title: t('chat.abort.title', '任务已结束'),
          detail: runId
            ? tf('chat.abort.detailRun', '已发送结束指令（runId: {{runId}}）', { runId })
            : t('chat.abort.detailStream', '已结束当前流式响应'),
        }],
      }]);
    }
  };

  // ── Main command handler ──
  const handleCommand = (
    e: React.FormEvent,
    options?: {
      messageOverride?: string;
      chatPreviewText?: string;
      attachments?: AgentAttachmentPayload[];
      displayAttachments?: ChatAttachment[];
      regenerate?: {
        removeAiMessageId: number;
        anchorUserMessageId: number;
        message: string;
        attachments: AgentAttachmentPayload[];
      };
    },
  ) => {
    e.preventDefault();
    const regen = options?.regenerate;
    if (regen) {
      setChatMessages((prev) => prev.filter((m) => m.id !== regen.removeAiMessageId));
    }
    const userMsg = String(regen ? regen.message : options?.messageOverride ?? cmd).trim();
    const requestAttachments = regen?.attachments ?? options?.attachments ?? [];
    const displayAttachments = options?.displayAttachments ?? [];
    if (!userMsg && requestAttachments.length === 0) return;
    if (abortCooldownRef.current) {
      abortCooldownRef.current = false;
    }
    if (commandLockRef.current || aiTyping) {
      abortInFlightRun(false);
    }
    const requestMessage = userMsg || t('chat.attach.continue', '请结合我刚上传的附件继续处理当前请求。');
    const transcriptText = displayAttachments
      .map((attachment) => attachment.transcript?.trim())
      .filter(Boolean)
      .join('\n');
    const previewRaw = options?.chatPreviewText?.trim();
    const displayText =
      previewRaw != null && previewRaw !== ''
        ? previewRaw
        : userMsg || transcriptText || '';
    reportActiveSession('user-command');
    reportActiveDevice('user-command');
    const msgId = regen ? regen.anchorUserMessageId : Date.now();
    if (!regen) {
      setChatMessages((prev) => [...prev, {
        id: msgId,
        role: 'user',
        text: displayText,
        source: 'studio',
        attachments: displayAttachments.length > 0 ? displayAttachments : undefined,
      }]);
    }
    setChatExpanded(true);
    setCmd('');
    setShowSuggestions(false);
    setAiTyping(true);
    commandLockRef.current = true;

    (async () => {
      const generation = ++streamGenerationRef.current;
      try {
        // /settings — quick command to open settings
        if (requestAttachments.length === 0 && userMsg === '/settings') {
          setShowSettings(true);
          setChatMessages(prev => [...prev, {
            id: msgId + 1,
            role: 'ai',
            durationMs: Math.max(0, Date.now() - msgId),
            text: t('chat.cmd.settingsOpened', '已打开设置面板。'),
          }]);
          setAiTyping(false);
          return;
        }

        const resolveOneShotPrompt = () => {
          if (requestAttachments.length > 0) return '';
          const explicit = userMsg.match(/^(?:\/one-shot-app|一句话生成(?:rdk)?应用)\s+(.+)$/i);
          if (explicit) return explicit[1].trim();
          return '';
        };
        const oneShotPrompt = resolveOneShotPrompt();
        if (oneShotPrompt) {
          const prompt = oneShotPrompt;
          try {
            const result = await generateOneShotApp(prompt);
            let validationText = t('chat.oneShot.validationPending', '未执行');
            let validationOk = false;
            let validationBlocks: ChatBlock[] = [];
            try {
              const validation = await validateOneShotApp(result.app.rootDir);
              validationOk = validation.validation.ok;
              validationText = validation.validation.ok
                ? t('chat.oneShot.validationPass', '通过')
                : t('chat.oneShot.validationFail', '未通过');
              validationBlocks = [{
                type: 'status',
                collapsible: true,
                defaultCollapsed: true,
                summary: tf('chat.oneShot.summaryAuto', '自动校验 · {{text}}', { text: validationText }),
                items: validation.validation.checks.map((c) => ({
                  label: c.name,
                  value: c.detail,
                  ok: c.ok,
                })),
              }];
            } catch {
              validationText = t('chat.oneShot.validationErr', '校验失败');
            }
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: t('chat.oneShot.done', '已完成应用骨架生成。'),
              source: 'studio',
              blocks: [
                {
                  type: 'status',
                  items: [
                    { label: t('chat.oneShot.appName', '应用名称'), value: result.app.name, ok: true },
                    { label: t('chat.oneShot.rootDir', '生成目录'), value: result.app.rootDir, ok: true },
                    { label: t('chat.oneShot.fileCount', '文件数量'), value: String(result.app.files.length), ok: true },
                    { label: t('chat.oneShot.runCmd', '运行命令'), value: result.app.runCommand, ok: true },
                    { label: t('chat.oneShot.genMode', '生成模式'), value: result.app.usedFallback ? t('chat.oneShot.genFallback', '模板兜底') : t('chat.oneShot.genAi', 'AI 规划'), ok: true },
                    { label: t('chat.oneShot.autoCheck', '自动校验'), value: validationText, ok: validationOk },
                  ],
                },
                {
                  type: 'terminal',
                  label: t('chat.oneShot.genFiles', '已生成文件'),
                  lines: result.app.files.map((f) => `- ${f}`),
                  collapsible: true,
                  previewLines: 8,
                },
                ...validationBlocks,
              ],
            }]);
            lastGeneratedAppRef.current = {
              name: result.app.name,
              rootDir: result.app.rootDir,
              runCommand: result.app.runCommand || 'python main.py',
            };
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: tf('chat.oneShot.fail', '应用生成失败：{{msg}}', {
                msg: error instanceof Error ? error.message : t('common.unknownError', '未知错误'),
              }),
              source: 'studio',
            }]);
          }
          setAiTyping(false);
          return;
        }

        const runGeneratedMatch = requestAttachments.length === 0
          ? userMsg.match(/^(?:\/run-one-shot-app(?:\s+(.+))?|运行(?:刚|刚刚)?生成(?:的)?(?:rdk)?应用|启动(?:刚|刚刚)?生成(?:的)?(?:rdk)?应用)$/i)
          : null;
        if (runGeneratedMatch) {
          const explicitDir = String(runGeneratedMatch[1] || '').trim();
          const appDir = explicitDir || lastGeneratedAppRef.current?.rootDir || '';
          if (!appDir) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: t('chat.run.none', '还没有可运行的生成应用，请先执行一句话生成。'),
              source: 'studio',
            }]);
            setAiTyping(false);
            return;
          }
          const runCommand = lastGeneratedAppRef.current?.rootDir === appDir
            ? (lastGeneratedAppRef.current?.runCommand || 'python main.py')
            : 'python main.py';
          try {
            const run = await runOneShotApp(appDir, runCommand);
            const outputLines = String(run.run.output || '').split(/\r?\n/).filter(Boolean).slice(0, 60);
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: run.ok ? t('chat.run.doneOk', '应用已执行完成。') : t('chat.run.doneFail', '应用执行失败。'),
              source: 'studio',
              blocks: [
                {
                  type: 'status',
                  items: [
                    { label: t('chat.oneShot.runCmd', '运行命令'), value: run.run.runner || runCommand, ok: true },
                    {
                      label: t('chat.run.result', '执行结果'),
                      value: run.ok
                        ? (run.run.timedOut ? t('chat.run.timeout', '运行中（超时中断）') : t('chat.run.success', '成功'))
                        : t('chat.run.fail', '失败'),
                      ok: run.ok,
                    },
                    { label: t('chat.run.appDir', '应用目录'), value: appDir, ok: true },
                  ],
                },
                {
                  type: 'terminal',
                  label: t('chat.run.output', '运行输出'),
                  lines: outputLines.length > 0 ? outputLines : [t('chat.run.noOutput', '[无输出]')],
                  collapsible: true,
                  previewLines: 10,
                },
              ],
            }]);
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: tf('chat.run.err', '应用执行失败：{{msg}}', {
                msg: error instanceof Error ? error.message : t('common.unknownError', '未知错误'),
              }),
              source: 'studio',
            }]);
          }
          setAiTyping(false);
          return;
        }

        const deployGeneratedMatch = requestAttachments.length === 0
          ? userMsg.match(/^(?:\/deploy-one-shot-app(?:\s+(.+))?|部署(?:刚|刚刚)?生成(?:的)?(?:rdk)?应用|发布(?:刚|刚刚)?生成(?:的)?(?:rdk)?应用)$/i)
          : null;
        if (deployGeneratedMatch) {
          const explicitDir = String(deployGeneratedMatch[1] || '').trim();
          const appDir = explicitDir || lastGeneratedAppRef.current?.rootDir || '';
          if (!currentDevice?.id) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: t('chat.deploy.needDevice', '请先连接目标设备，再执行部署。'),
              source: 'studio',
            }]);
            setAiTyping(false);
            return;
          }
          if (!appDir) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: t('chat.deploy.none', '还没有可部署的生成应用，请先执行一句话生成。'),
              source: 'studio',
            }]);
            setAiTyping(false);
            return;
          }

          try {
            const deployRunCommand = lastGeneratedAppRef.current?.rootDir === appDir
              ? (lastGeneratedAppRef.current?.runCommand || 'python main.py')
              : 'python main.py';
            const deploy = await deployOneShotApp({
              appDir,
              deviceId: currentDevice.id,
              runAfterDeploy: true,
              runCommand: deployRunCommand,
            });
            const runOutput = String(deploy.deploy.run?.output || '').split(/\r?\n/).filter(Boolean).slice(0, 60);
            const suggestions = deploy.deploy.run?.suggestions ?? [];
            lastDeployFixRef.current = {
              deviceId: currentDevice.id,
              remoteDir: deploy.deploy.remoteDir,
              runCommand: deploy.deploy.runCommand || deployRunCommand,
              suggestions,
            };
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: t('chat.deploy.ok', '应用已部署到设备。'),
              source: 'studio',
              blocks: [
                {
                  type: 'status',
                  items: [
                    { label: t('chat.deploy.target', '目标设备'), value: `${currentDevice.name} (${currentDevice.ip})`, ok: true },
                    { label: t('chat.deploy.remoteDir', '部署目录'), value: deploy.deploy.remoteDir, ok: true },
                    { label: t('chat.oneShot.fileCount', '文件数量'), value: String(deploy.deploy.fileCount), ok: true },
                    { label: t('chat.oneShot.runCmd', '运行命令'), value: deploy.deploy.runCommand || deployRunCommand, ok: true },
                    {
                      label: t('chat.deploy.runResult', '运行结果'),
                      value: deploy.deploy.run?.ok ? t('chat.run.success', '成功') : t('chat.run.fail', '失败'),
                      ok: Boolean(deploy.deploy.run?.ok),
                    },
                    ...(suggestions.length > 0
                      ? [{ label: t('chat.deploy.suggestions', '修复建议'), value: tf('chat.deploy.suggestionsCount', '{{n}} 条', { n: suggestions.length }), ok: true }]
                      : []),
                  ],
                },
                ...(runOutput.length > 0 ? [{
                  type: 'terminal' as const,
                  label: t('chat.deploy.deviceOut', '设备运行输出'),
                  lines: runOutput,
                  collapsible: true,
                  previewLines: 10,
                }] : []),
                ...(suggestions.length > 0 ? [{
                  type: 'terminal' as const,
                  label: t('chat.deploy.nextSteps', '建议下一步'),
                  lines: suggestions.map((item, idx) => {
                    const cmd = item.command
                      ? tf('chat.deploy.suggestionCmd', ' | 命令: {{cmd}}', { cmd: item.command })
                      : '';
                    return tf('chat.deploy.suggestionLine', '{{i}}. {{title}}: {{detail}}{{cmd}}', {
                      i: idx + 1,
                      title: item.title,
                      detail: item.detail,
                      cmd,
                    });
                  }),
                  collapsible: true,
                  previewLines: 6,
                }] : []),
              ],
            }]);
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: tf('chat.deploy.fail', '部署失败：{{msg}}', {
                msg: error instanceof Error ? error.message : t('common.unknownError', '未知错误'),
              }),
              source: 'studio',
            }]);
          }
          setAiTyping(false);
          return;
        }

        const applyFixMatch = requestAttachments.length === 0
          ? userMsg.match(/^(?:\/apply-last-fix|执行修复)\s*(\d+)?$/i)
          : null;
        if (applyFixMatch) {
          const fixState = lastDeployFixRef.current;
          const indexRaw = Number.parseInt(String(applyFixMatch[1] || '1'), 10);
          const index = Number.isFinite(indexRaw) ? Math.max(1, indexRaw) : 1;
          if (!fixState || fixState.suggestions.length === 0) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: t('chat.fix.none', '暂无可执行修复建议，请先完成一次部署并产生建议。'),
              source: 'studio',
            }]);
            setAiTyping(false);
            return;
          }

          const selected = fixState.suggestions[index - 1];
          if (!selected?.command) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: tf('chat.fix.noCmd', '第 {{n}} 条建议没有可执行命令，请手动处理。', { n: index }),
              source: 'studio',
            }]);
            setAiTyping(false);
            return;
          }

          try {
            const command = `cd ${fixState.remoteDir} && ${selected.command}`;
            const result = await executeDeviceCommand(fixState.deviceId, command);
            const lines = String(result.output || '').split(/\r?\n/).filter(Boolean).slice(0, 60);
            const retryRunCommand = `cd ${fixState.remoteDir} && (${fixState.runCommand || 'python main.py'})`;
            const retryResult = await executeDeviceCommand(fixState.deviceId, retryRunCommand).catch((error) => ({
              ok: false,
              output: error instanceof Error ? error.message : t('chat.fix.autoFail', '自动重试运行失败'),
            }));
            const retryLines = String(retryResult.output || '').split(/\r?\n/).filter(Boolean).slice(0, 60);
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: tf('chat.fix.done', '已执行修复建议 #{{n}}：{{title}}，并自动重试运行。', { n: index, title: selected.title }),
              source: 'studio',
              blocks: [
                {
                  type: 'status',
                  items: [
                    { label: t('chat.fix.item', '修复项'), value: selected.title, ok: true },
                    { label: t('chat.fix.dir', '执行目录'), value: fixState.remoteDir, ok: true },
                    { label: t('chat.fix.cmd', '命令'), value: selected.command || '', ok: true },
                    { label: t('chat.fix.retryCmd', '重试命令'), value: fixState.runCommand || 'python main.py', ok: true },
                    {
                      label: t('chat.fix.retryRun', '重试运行'),
                      value: retryResult.ok ? t('chat.run.success', '成功') : t('chat.run.fail', '失败'),
                      ok: Boolean(retryResult.ok),
                    },
                  ],
                },
                {
                  type: 'terminal',
                  label: t('chat.fix.out', '修复输出'),
                  lines: lines.length > 0 ? lines : [t('chat.run.noOutput', '[无输出]')],
                  collapsible: true,
                  previewLines: 10,
                },
                {
                  type: 'terminal',
                  label: t('chat.fix.retryOut', '重试运行输出'),
                  lines: retryLines.length > 0 ? retryLines : [t('chat.run.noOutput', '[无输出]')],
                  collapsible: true,
                  previewLines: 10,
                },
              ],
            }]);
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: tf('chat.fix.err', '修复执行失败：{{msg}}', {
                msg: error instanceof Error ? error.message : t('common.unknownError', '未知错误'),
              }),
              source: 'studio',
            }]);
          }
          setAiTyping(false);
          return;
        }

        const bindMatch = requestAttachments.length === 0
          ? userMsg.match(/^(?:绑定飞书|飞书绑定|bind\s*feishu)\s+(\d{6})$/i)
          : null;
        if (bindMatch) {
          const code = bindMatch[1];
          try {
            const result = await bindRDKClawFeishuCode(code, sessionIdRef.current);
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: result.message || tf('chat.feishu.bindOk', '绑定成功，账号：{{id}}', { id: result.openId || '***' }),
              source: 'studio',
            }]);
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              durationMs: Math.max(0, Date.now() - msgId),
              text: tf('chat.feishu.bindFail', '绑定失败：{{msg}}', {
                msg: error instanceof Error ? error.message : t('chat.feishu.bindInvalid', '授权码无效或已过期'),
              }),
              source: 'studio',
            }]);
          }
          setAiTyping(false);
          return;
        }

        const stopAllMatch = requestAttachments.length === 0
          && /^(?:停止所有任务|全部停止|stop\s*all)$/i.test(userMsg);
        if (stopAllMatch) {
          await stopAllRuns();
          setAiTyping(false);
          return;
        }

        const stopTaskMatch = requestAttachments.length === 0
          ? userMsg.match(/^(?:停止任务|暂停任务|停止|stop\s*task|stop)\s*([a-zA-Z0-9_-]*)$/i)
          : null;
        if (stopTaskMatch) {
          const taskId = stopTaskMatch[1]?.trim();
          if (!taskId) {
            await stopAllRuns();
          } else {
            try {
              await stopRDKClawTask(taskId);
              setChatMessages(prev => [...prev, {
                id: msgId + 1,
                role: 'ai',
                durationMs: Math.max(0, Date.now() - msgId),
                text: tf('chat.stop.task', '已停止任务：{{id}}（当前轮次会被中断，状态切换为 paused）', { id: taskId }),
                source: 'studio',
              }]);
            } catch (error) {
              setChatMessages(prev => [...prev, {
                id: msgId + 1,
                role: 'ai',
                durationMs: Math.max(0, Date.now() - msgId),
                text: tf('chat.stop.fail', '停止任务失败：{{msg}}', {
                  msg: error instanceof Error ? error.message : t('common.unknownError', '未知错误'),
                }),
                source: 'studio',
              }]);
            }
          }
          setAiTyping(false);
          return;
        }

        // ── Agent Loop (SSE) — primary path ──
        const aiMsgId = regen ? Math.max(Date.now(), msgId + 1) : msgId + 1;
        let aiText = '';
        const aiBlocks: ChatBlock[] = [];
        let currentRunId = '';
        currentRunIdRef.current = '';
        toolTimelineRef.current = {};
        latestBoardToolRef.current = null;
        reasoningBlockIndexRef.current = null;
        reasoningTimelineSentRef.current = false;
        approvalBlockRef.current = {};
        timelineSeqRef.current = 0;
        boardToolTimelineSigRef.current = '';
        setRdkClawRunTimeline([]);

        setChatMessages(prev => [...prev, {
          id: aiMsgId, role: 'ai', text: '', blocks: [], source: 'studio',
        }]);

        let pendingText = '';
        let pendingBlocks: ChatBlock[] = [];
        let rafHandle: number | null = null;
        const flushAiMessage = () => {
          rafHandle = null;
          const t = pendingText;
          const b = [...pendingBlocks];
          setChatMessages(prev => prev.map(m =>
            m.id === aiMsgId ? { ...m, text: t, blocks: b } : m
          ));
        };
        /** 文本增量仅合并到下一帧 paint（~60fps），不再额外 setTimeout 限频，避免「一顿一顿」 */
        const updateAiMessage = (text: string, blocks: ChatBlock[], immediate?: boolean) => {
          pendingText = text;
          pendingBlocks = blocks;
          if (immediate) {
            if (rafHandle) cancelAnimationFrame(rafHandle);
            flushAiMessage();
            return;
          }
          if (!rafHandle) {
            rafHandle = requestAnimationFrame(flushAiMessage);
          }
        };
        let toolStepNo = 0;

        const { done, abort } = streamAgentChat(
          requestMessage,
          currentDevice?.id,
          sessionIdRef.current,
          userIdRef.current,
          { attachments: requestAttachments, studioResponseMode },
          (event: AgentSSEEvent) => {
            if (generation !== streamGenerationRef.current) return;
            const eventRunId = String(event.data.runId || '').trim();
            if (eventRunId) {
              currentRunId = eventRunId;
              currentRunIdRef.current = eventRunId;
            }
            switch (event.type) {
              case 'meta': {
                currentRunId = eventRunId || currentRunId;
                currentRunIdRef.current = currentRunId;
                const metaDataEarly = event.data as Record<string, unknown>;
                const phaseEarly = String(metaDataEarly.phase || '');
                const trReason = String(metaDataEarly.turn_transition_reason || '').trim();
                if (phaseEarly === 'limit' || trReason) {
                  const limitMsg = String(metaDataEarly.message || '').trim();
                  if (limitMsg) {
                    aiBlocks.push({
                      type: 'status',
                      items: [
                        {
                          label: t('chat.stopNotice.title', '运行结束说明'),
                          value: limitMsg,
                          ok: false,
                        },
                      ],
                    });
                    appendRunTimelineEntry(generation, {
                      kind: 'context',
                      title: t('chat.stopNotice.timeline', '结束原因'),
                      detail: limitMsg.slice(0, 500),
                    });
                    updateAiMessage(aiText, aiBlocks, true);
                  }
                  break;
                }
                if (studioResponseMode === 'quick') break;
                const executor = String(event.data.executor || 'rdkclaw_local');
                const phase = String(event.data.phase || 'start');
                const message = String(event.data.message || t('chat.stream.start', '开始处理请求'));

                if (phase === 'setup') {
                  aiBlocks.push({
                    type: 'status',
                    items: [{ label: executorLabel(executor), value: message, ok: true }],
                  });
                  appendRunTimelineEntry(generation, {
                    kind: 'setup',
                    title: t('chat.timeline.setup', '准备上下文'),
                    detail: message.slice(0, 400),
                  });
                  updateAiMessage(aiText, aiBlocks, true);
                  break;
                }

                if (phase === 'heartbeat') {
                  break;
                }

                const data = event.data as Record<string, unknown>;

                /** run 遥测由后端经 meta(run_metrics) + 前端 done 展示，勿再套「执行路径」全卡，否则会多出重复的「默认」条 */
                if (phase === 'end' && data.run_metrics != null) {
                  break;
                }

                /** 后端已不再推送；旧服务端若仍发 memory_sync，静默忽略以免每轮重复占位 */
                if (phase === 'memory_sync') {
                  break;
                }

                if (phase === 'running') {
                  const runIdx = aiBlocks.findIndex(
                    (b) => b.type === 'status' && (b as { _rdkMetaRunning?: boolean })._rdkMetaRunning,
                  );
                  const runBlock = {
                    type: 'status' as const,
                    _rdkMetaRunning: true as const,
                    collapsible: true,
                    defaultCollapsed: true,
                    summary: message.slice(0, 120),
                    items: [{ label: t('chat.stream.runtimeNote', '运行说明'), value: message, ok: true }],
                  };
                  if (runIdx >= 0) aiBlocks[runIdx] = runBlock;
                  else aiBlocks.push(runBlock);
                  appendRunTimelineEntry(generation, {
                    kind: 'context',
                    title: t('chat.timeline.agentNote', 'Agent 提示'),
                    detail: message.slice(0, 400),
                  });
                  updateAiMessage(aiText, aiBlocks, true);
                  break;
                }

                if (phase === 'end' && data.subagent_summary != null) {
                  const subSummary = String(data.subagent_summary ?? '');
                  aiBlocks.push({
                    type: 'status',
                    collapsible: true,
                    defaultCollapsed: true,
                    summary: message.slice(0, 100),
                    items: [{ label: t('chat.stream.subagent', '子代理'), value: subSummary || message, ok: true }],
                  });
                  appendRunTimelineEntry(generation, {
                    kind: 'context',
                    title: message.slice(0, 80),
                    detail: subSummary.slice(0, 400),
                  });
                  updateAiMessage(aiText, aiBlocks, true);
                  break;
                }

                /** 完整「编排上下文」卡仅对应 server 单次 phase=start（含委派/技能/模型能力），避免其它 meta 缺字段时用「默认」填空造成视觉重复 */
                if (phase !== 'start') {
                  aiBlocks.push({
                    type: 'status',
                    collapsible: true,
                    defaultCollapsed: true,
                    summary: message.slice(0, 100),
                    items: [{ label: executorLabel(executor), value: message, ok: true }],
                  });
                  appendRunTimelineEntry(generation, {
                    kind: 'context',
                    title: message.slice(0, 80),
                    detail: message.slice(0, 400),
                  });
                  updateAiMessage(aiText, aiBlocks, true);
                  break;
                }

                const delegationMode = String(event.data.delegation_mode || t('chat.stream.defaultMode', '默认'));
                const matchedSkills = Array.isArray(event.data.matched_skills)
                  ? (event.data.matched_skills as string[]).filter(Boolean)
                  : [];
                const needsBoardCollaboration = Boolean(event.data.needs_board_collaboration);
                const networkEnabled = Boolean(event.data.network_enabled);

                const modelCaps = event.data.model_capabilities as {
                  provider?: string;
                  model?: string;
                  contextWindow?: number;
                  maxOutputTokens?: number;
                  tier?: string;
                } | undefined;

                const summaryParts = [executorLabel(executor), delegationMode];
                if (matchedSkills.length > 0) {
                  summaryParts.push(tf('chat.stream.skillsVal', '技能: {{list}}', { list: matchedSkills.join('/') }));
                }
                if (networkEnabled) summaryParts.push(t('chat.stream.network', '联网'));
                if (needsBoardCollaboration) summaryParts.push(t('chat.stream.board', '板端协同'));

                const metaItems: Array<{ label: string; value: string; ok: boolean }> = [
                  { label: t('chat.stream.path', '执行路径'), value: `${delegationMode} · ${String(event.data.decision_reason || '')}`, ok: true },
                  {
                    label: t('chat.stream.hit', '命中能力'),
                    value: matchedSkills.length > 0 ? matchedSkills.join(' / ') : t('chat.stream.generic', '通用流程'),
                    ok: matchedSkills.length > 0,
                  },
                ];
                if (modelCaps?.model) {
                  const ctxK = modelCaps.contextWindow ? `${Math.round(modelCaps.contextWindow / 1024)}K` : '?';
                  const outK = modelCaps.maxOutputTokens ? `${Math.round(modelCaps.maxOutputTokens / 1024)}K` : '?';
                  const tierLabel = modelCaps.tier === 'small' ? t('chat.stream.tierSmall', ' (精简模式)') : modelCaps.tier === 'large' ? '' : '';
                  metaItems.push({
                    label: t('chat.stream.model', '模型'),
                    value: tf('chat.stream.modelVal', '{{model}} · 上下文 {{ctx}} · 输出 {{out}}{{tier}}', {
                      model: modelCaps.model,
                      ctx: ctxK,
                      out: outK,
                      tier: tierLabel,
                    }),
                    ok: true,
                  });
                }

                // 与 server/rdkclaw 下发的 setup 文案一致（固定中文），用于替换首条状态块
                const existingSetupIdx = aiBlocks.findIndex(
                  (b) => b.type === 'status' && b.items?.[0]?.value === '正在准备上下文...',
                );
                if (existingSetupIdx >= 0) {
                  aiBlocks[existingSetupIdx] = {
                    type: 'status',
                    collapsible: true,
                    defaultCollapsed: true,
                    summary: summaryParts.join(' · '),
                    items: metaItems,
                  };
                } else {
                  aiBlocks.push({
                    type: 'status',
                    collapsible: true,
                    defaultCollapsed: true,
                    summary: summaryParts.join(' · '),
                    items: metaItems,
                  });
                }
                appendRunTimelineEntry(generation, {
                  kind: 'context',
                  title: t('chat.timeline.context', '运行上下文'),
                  detail: summaryParts.join(' · '),
                });
                updateAiMessage(aiText, aiBlocks, true);
                break;
              }
              case 'text': {
                aiText += (event.data.delta as string) || '';
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'thinking_delta': {
                const delta = String(event.data.delta ?? '');
                if (!delta) break;
                /** 快捷模式原先跳过推理流：部分模型仅通过 thinking 通道输出正文，会导致气泡空白仅剩「用时」 */
                if (studioResponseMode === 'quick') {
                  aiText += delta;
                  updateAiMessage(aiText, aiBlocks);
                  break;
                }
                const idx = reasoningBlockIndexRef.current;
                const existing =
                  idx != null && idx < aiBlocks.length && aiBlocks[idx]?.type === 'reasoning'
                    ? (aiBlocks[idx] as Extract<ChatBlock, { type: 'reasoning' }>)
                    : null;
                if (existing) {
                  existing.text += delta;
                } else {
                  reasoningBlockIndexRef.current = aiBlocks.length;
                  aiBlocks.push({
                    type: 'reasoning',
                    text: delta,
                    collapsible: true,
                    defaultCollapsed: true,
                  });
                }
                if (!reasoningTimelineSentRef.current) {
                  reasoningTimelineSentRef.current = true;
                  appendRunTimelineEntry(generation, {
                    kind: 'reasoning',
                    title: t('chat.timeline.reasoning', '模型推理'),
                    detail: delta.slice(0, 280),
                  });
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'tool_start': {
                toolStepNo += 1;
                const toolName = resolveToolName(event.data);
                const args = event.data.args as Record<string, unknown>;
                const executor = String(
                  event.data.executor || (isBoardOpenClawExecutorTool(toolName) ? 'board_openclaw' : 'rdkclaw_local'),
                );
                if (studioResponseMode === 'quick' && !isBoardOpenClawExecutorTool(toolName)) {
                  const toolCallIdHidden = resolveToolId(event.data) || `${toolName}-${Date.now()}`;
                  const argDetailHidden = summarizeToolArgs(args);
                  toolTimelineRef.current[toolCallIdHidden] = {
                    toolName,
                    executor,
                    startedAt: Date.now(),
                    statusIndex: -1,
                    hiddenQuick: true,
                    argDetail: argDetailHidden,
                    cardTitle: formatToolStatusTitle(toolName, args),
                  };
                  updateAiMessage(aiText, aiBlocks);
                  break;
                }
                if (isBoardOpenClawCollabTool(toolName)) {
                  boardToolTimelineSigRef.current = '';
                }
                const phase = resolvePhase(event.data.phase);
                const argStr = summarizeToolArgs(args);
                const cardTitle = formatToolStatusTitle(toolName, args);
                const statusIndex = aiBlocks.length;
                aiBlocks.push({
                  type: 'status',
                  title: cardTitle,
                  items: [
                    {
                      label: executorLabel(executor),
                      value: `${phase} · ${argStr}`,
                      ok: true,
                    },
                  ],
                });
                const toolCallId = resolveToolId(event.data) || `${toolName}-${Date.now()}`;
                toolTimelineRef.current[toolCallId] = {
                  toolName,
                  executor,
                  startedAt: Date.now(),
                  statusIndex,
                  argDetail: argStr,
                  cardTitle,
                  ...(isBoardOpenClawCollabTool(toolName) ? { openclawStreamBuf: '' } : {}),
                };
                if (isBoardOpenClawCollabTool(toolName)) {
                  latestBoardToolRef.current = toolCallId;
                  const outboundLines = formatBoardOutboundLines(toolName, args);
                  const linesOut = outboundLines.length > 0 ? outboundLines : [argStr];
                  const outboundSubtitle =
                    toolName === 'board_openclaw_chat'
                      ? t('dock.collab.outboundChatSubtitle', 'RDKClaw 发出的交流内容')
                      : toolName === 'board_openclaw_assess'
                        ? t('dock.collab.outboundAssessSubtitle', '向板端咨询任务可行性（仅评估）')
                        : toolName === 'fleet_board_delegate'
                          ? t('dock.collab.outboundFleetDelegateSubtitle', '跨板委派至目标设备')
                          : toolName === 'fleet_board_broadcast'
                            ? t('dock.collab.outboundFleetBroadcastSubtitle', '向多块板卡广播任务')
                            : t('dock.collab.outboundDelegateSubtitle', '委派任务与执行建议');
                  aiBlocks.push({
                    type: 'collab',
                    side: 'rdkclaw',
                    collabRole: 'outbound',
                    title: t('dock.collab.outboundTitle', '发给板端 OpenClaw'),
                    subtitle: outboundSubtitle,
                    lines: linesOut,
                    collapsible: true,
                    previewLines: 12,
                  });
                }
                if (studioResponseMode !== 'quick' || isBoardOpenClawExecutorTool(toolName)) {
                  appendRunTimelineEntry(generation, {
                    kind: 'tool_start',
                    title: tf('chat.timeline.toolStart', '工具 · {{tool}}', { tool: toolName }),
                    detail: `${executorLabel(executor)} · ${phase} · ${argStr}`.slice(0, 500),
                  });
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'tool_progress': {
                const toolName = resolveToolName(event.data);
                const rawChunk = String(event.data.chunk ?? '');
                if (!rawChunk) break;
                const progressSource = String((event.data as { progressSource?: string }).progressSource || 'board');
                const rawToolId = resolveToolId(event.data);
                const fallbackId = latestBoardToolRef.current || '';
                const toolId = rawToolId && toolTimelineRef.current[rawToolId] ? rawToolId : fallbackId;
                if (!toolId || !toolTimelineRef.current[toolId]) break;
                const state = toolTimelineRef.current[toolId];
                if (state.hiddenQuick) break;
                const statusBlock = aiBlocks[state.statusIndex];
                if (statusBlock?.type === 'status' && statusBlock.items[0]) {
                  const ad = state.argDetail;
                  const hasTarget = Boolean(ad && ad !== '无参数');
                  const running = t('chat.tool.runningShort', '执行中…');
                  statusBlock.items[0].value = hasTarget
                    ? `${ad} · ${running}`
                    : tf('chat.tool.runningVal', '执行中 · {{exec}} · 实时输出更新', {
                        exec: executorLabel(state.executor),
                      });
                }
                const isBoardOpenClaw =
                  isBoardOpenClawCollabTool(toolName) || state.executor === 'board_openclaw';
                if (isBoardOpenClaw) {
                  if (toolName === 'board_openclaw_chat' && progressSource === 'studio_wait') {
                    const more = rawChunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0);
                    if (typeof state.waitHintCollabIndex === 'number') {
                      const wb = aiBlocks[state.waitHintCollabIndex];
                      if (wb?.type === 'collab' && wb.side === 'rdkclaw' && wb.collabRole === 'wait_hint') {
                        wb.lines = [...wb.lines, ...more];
                      }
                    } else {
                      state.waitHintCollabIndex = aiBlocks.length;
                      aiBlocks.push({
                        type: 'collab',
                        side: 'rdkclaw',
                        collabRole: 'wait_hint',
                        title: t('dock.collab.waitHintTitle', '稍等片刻'),
                        subtitle: t(
                          'dock.collab.waitHintSubtitle',
                          '等板端 OpenClaw 时的提示（由 Studio 插入，非板端模型生成）',
                        ),
                        lines: more,
                        collapsible: true,
                        previewLines: 6,
                      });
                    }
                    updateAiMessage(aiText, aiBlocks);
                    break;
                  }
                  if (typeof state.collabIndex === 'number') {
                    const collabBlock = aiBlocks[state.collabIndex];
                    if (collabBlock?.type === 'collab' && collabBlock.side === 'openclaw') {
                      state.openclawStreamBuf = (state.openclawStreamBuf ?? '') + rawChunk;
                      const bufLines = collapseRepeatedBoardToolNotifyLines(state.openclawStreamBuf.split('\n'));
                      collabBlock.lines = bufLines.length > 240 ? bufLines.slice(-240) : bufLines;
                    }
                  } else {
                    state.collabIndex = aiBlocks.length;
                    state.openclawStreamBuf = rawChunk;
                    const bufLines = collapseRepeatedBoardToolNotifyLines(state.openclawStreamBuf.split('\n'));
                    const lines = bufLines.length > 240 ? bufLines.slice(-240) : bufLines;
                    aiBlocks.push({
                      type: 'collab',
                      side: 'openclaw',
                      title: t('dock.collab.openclawTitle', '板端 OpenClaw'),
                      subtitle: t('dock.collab.openclawSubtitle', '与 RDKClaw 协作中的回复'),
                      lines,
                      collapsible: true,
                      previewLines: 8,
                    });
                  }
                  if (/\[TOOL:/.test(rawChunk)) {
                    const bits =
                      rawChunk.match(/\[TOOL:[^\]]*\][^\n]*/g)
                      ?? rawChunk.split('\n').filter((l) => l.includes('[TOOL:'));
                    for (const bit of bits) {
                      const sig = String(bit).trim().slice(0, 240);
                      if (sig && sig !== boardToolTimelineSigRef.current) {
                        boardToolTimelineSigRef.current = sig;
                        if (studioResponseMode !== 'quick' || isBoardOpenClawExecutorTool(toolName)) {
                          appendRunTimelineEntry(generation, {
                            kind: 'board_tool',
                            title: t('chat.timeline.boardTool', '板端工具'),
                            detail: sig,
                          });
                        }
                      }
                    }
                  }
                } else {
                  const progressLines = rawChunk.split('\n').map((line) => line.trim()).filter(Boolean).slice(-20);
                  if (progressLines.length === 0) break;
                  if (typeof state.rawIndex === 'number') {
                    const rawBlock = aiBlocks[state.rawIndex];
                    if (rawBlock?.type === 'terminal') {
                      rawBlock.lines = [...rawBlock.lines, ...progressLines].slice(-240);
                    }
                  } else {
                    state.rawIndex = aiBlocks.length;
                    aiBlocks.push({
                      type: 'terminal',
                      label: tf('chat.tool.rawLabel', '{{tool}} · 原始中间输出', { tool: state.toolName }),
                      lines: progressLines,
                      collapsible: true,
                      previewLines: 10,
                    });
                  }
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'tool_result': {
                const toolName = resolveToolName(event.data);
                const result = (event.data.result as string) || '';
                const isError = event.data.isError as boolean;
                const toolCallId = resolveToolId(event.data);
                const state = toolTimelineRef.current[toolCallId || ''];
                const elapsedMs = state ? Date.now() - state.startedAt : 0;
                if (state && !state.hiddenQuick && state.statusIndex >= 0) {
                  const statusBlock = aiBlocks[state.statusIndex];
                  if (statusBlock?.type === 'status' && statusBlock.items[0]) {
                    const ad = state.argDetail;
                    const hasTarget = Boolean(ad && ad !== '无参数');
                    const stateWord = isError ? t('chat.tool.fail', '失败') : t('chat.tool.done', '完成');
                    const ms = Math.max(1, elapsedMs);
                    let valueLine = hasTarget
                      ? tf('chat.tool.resultWithDetail', '{{detail}} · {{state}} · {{ms}} ms', {
                          detail: ad as string,
                          state: stateWord,
                          ms,
                        })
                      : tf('chat.tool.resultNoDetail', '{{tool}} · {{state}} · {{ms}} ms', {
                          tool: state.toolName,
                          state: stateWord,
                          ms,
                        });
                    if (isError && result.trim()) {
                      const errOne = result.trim().replace(/\s+/g, ' ').slice(0, 220);
                      valueLine = `${valueLine} — ${errOne}`;
                    }
                    statusBlock.items[0] = {
                      label: executorLabel(state.executor),
                      value: valueLine,
                      ok: !isError,
                    };
                    if (state.cardTitle && !statusBlock.title) {
                      statusBlock.title = state.cardTitle;
                    }
                  }
                }
                if (!state?.hiddenQuick) {
                  appendRunTimelineEntry(generation, {
                    kind: 'tool_end',
                    title: state?.toolName || toolName,
                    detail: tf('chat.timeline.toolEndVal', '{{state}} · {{ms}} ms', {
                      state: isError ? t('chat.tool.fail', '失败') : t('chat.tool.done', '完成'),
                      ms: Math.max(1, elapsedMs),
                    }),
                  });
                }

                if (!isError && (toolName === 'device_connect_ssh' || toolName === 'switch_device')) {
                  let boundId: string | null = null;
                  if (toolName === 'device_connect_ssh' && /设备连接成功/i.test(result)) {
                    const m = result.match(/设备ID:\s*([a-f0-9-]{36})/i);
                    boundId = m?.[1] ?? null;
                  } else if (toolName === 'switch_device' && /已切换到设备/i.test(result)) {
                    const m = result.match(/\[id:\s*([a-f0-9-]{36})\]/i);
                    boundId = m?.[1] ?? null;
                  }
                  if (boundId) {
                    void (async () => {
                      try {
                        const res = await fetchDevices();
                        const next = res.devices.map((device) => ({
                          id: device.id,
                          name: `${device.username}@${device.host}:${device.port ?? 22}`,
                          status: device.status === 'connected' ? 'online' : 'offline',
                          ip: device.host,
                          port: device.port ?? 22,
                          description: `SSH ${device.username}:${device.port ?? 22}`,
                        }));
                        setDevices(next);
                        setActiveDevice(boundId);
                        await setActiveRdkclawDevice(boundId);
                      } catch {
                        /* ignore */
                      }
                    })();
                  }
                }

                /** 对话里 device_remove 只改服务端存储，须拉列表并更新选中设备，否则侧栏/设备列表仍显示已删项 */
                if (!isError && toolName === 'device_remove') {
                  const m = result.match(/\[id:\s*([a-f0-9-]{36})\]/i);
                  const removedId = m?.[1] ?? null;
                  void (async () => {
                    try {
                      const res = await fetchDevices();
                      const next = res.devices.map((device) => ({
                        id: device.id,
                        name: `${device.username}@${device.host}:${device.port ?? 22}`,
                        status: device.status === 'connected' ? 'online' : 'offline',
                        ip: device.host,
                        port: device.port ?? 22,
                        description: `SSH ${device.username}:${device.port ?? 22}`,
                      }));
                      setDevices(next);
                      if (removedId) {
                        forgetDevicePassword(removedId);
                      }
                      const ids = new Set(next.map((d) => d.id));
                      let rdkclawDeviceToSync: string | null = null;
                      setActiveDevice((prev) => {
                        const stale = Boolean(prev && !ids.has(prev));
                        const hitRemoved = Boolean(removedId && prev === removedId);
                        if (stale || hitRemoved) {
                          rdkclawDeviceToSync = next[0]?.id ?? '';
                          return rdkclawDeviceToSync;
                        }
                        return prev;
                      });
                      if (rdkclawDeviceToSync) {
                        await setActiveRdkclawDevice(rdkclawDeviceToSync);
                      }
                    } catch {
                      /* ignore */
                    }
                  })();
                }

                let mediaHandled = false;
                if (!isError && result.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(result) as Record<string, unknown>;
                    if (parsed.__type === 'image_download' && typeof parsed.imageUrl === 'string') {
                      aiBlocks.push({
                        type: 'image',
                        src: parsed.imageUrl as string,
                        caption: tf('chat.img.caption', '{{name}} ({{bytes}} bytes) — 来自设备', {
                          name: String(parsed.fileName || t('chat.media.image', '图片')),
                          bytes: String(parsed.bytes || 0),
                        }),
                      });
                      mediaHandled = true;
                    } else if (
                      parsed.__type === 'studio_local_preview' &&
                      typeof parsed.imageUrl === 'string' &&
                      parsed.ok === true
                    ) {
                      aiBlocks.push({
                        type: 'image',
                        src: parsed.imageUrl as string,
                        caption: String(
                          parsed.fileName || t('chat.media.localPreview', '本地预览'),
                        ),
                      });
                      mediaHandled = true;
                    } else if (parsed.__type === 'video_download' && typeof parsed.videoUrl === 'string') {
                      aiBlocks.push({
                        type: 'video',
                        src: parsed.videoUrl as string,
                        caption: tf('chat.video.caption', '{{name}} ({{mb}} MB) — 来自设备', {
                          name: String(parsed.fileName || t('chat.media.video', '视频')),
                          mb: ((parsed.bytes as number) / 1024 / 1024).toFixed(1),
                        }),
                      });
                      mediaHandled = true;
                    } else if (parsed.localPath && typeof parsed.fileName === 'string') {
                      const ext = String(parsed.fileName).split('.').pop()?.toLowerCase() || '';
                      const docExts = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'csv', 'txt', 'md', 'zip', 'rar', '7z']);
                      if (docExts.has(ext)) {
                        const fileUrl = `/api/local-files/${encodeURIComponent(parsed.fileName as string)}`;
                        aiBlocks.push({
                          type: 'file',
                          src: fileUrl,
                          fileName: parsed.fileName as string,
                          caption: tf('chat.audio.caption', '{{name}} ({{kb}} KB) — 来自设备', {
                            name: String(parsed.fileName),
                            kb: ((parsed.bytes as number) / 1024).toFixed(0),
                          }),
                        });
                        mediaHandled = true;
                      }
                    }
                  } catch {
                    // not JSON, fall through to normal handling
                  }
                }

                if (
                  !mediaHandled
                  && !isError
                  && isBoardOpenClawCollabTool(toolName)
                ) {
                  const st = toolTimelineRef.current[toolCallId || ''];
                  const { body, rdkHint } = splitOpenClawCollaborationResult(result);
                  const { cleaned, extracts } = extractNeedRdkclawBlocks(body);
                  const pushReverseBlocks = () => {
                    for (const ex of extracts) {
                      aiBlocks.push({
                        type: 'collab',
                        side: 'rdkclaw',
                        collabRole: 'reverse',
                        title: t('dock.collab.reverseTitle', '向 RDKClaw 求助'),
                        subtitle: t(
                          'dock.collab.reverseSubtitle',
                          '板端在回复中请求本机能力（联网检索、文档等）；接下来由 RDKClaw 调用工具并再发回板端',
                        ),
                        lines: ex.split('\n').slice(0, 40),
                        collapsible: true,
                        previewLines: 8,
                      });
                    }
                  };
                  if (st && typeof st.collabIndex === 'number') {
                    const collabBlock = aiBlocks[st.collabIndex];
                    if (collabBlock?.type === 'collab' && collabBlock.side === 'openclaw') {
                      delete st.openclawStreamBuf;
                      const streamed = collabBlock.lines.join('\n').trim();
                      const shouldReplace =
                        cleaned.length > streamed.length + 8
                        || extracts.length > 0
                        || (cleaned.length > 0 && /\[NEED_RDKCLAW\]/i.test(streamed));
                      if (shouldReplace) {
                        collabBlock.lines = cleaned.split('\n').slice(0, 80);
                      }
                      pushReverseBlocks();
                    }
                  } else if (cleaned.trim()) {
                    aiBlocks.push({
                      type: 'collab',
                      side: 'openclaw',
                      title: t('dock.collab.openclawTitle', '板端 OpenClaw'),
                      subtitle: t('dock.collab.openclawSubtitle', '与 RDKClaw 协作中的回复'),
                      lines: cleaned.split('\n').slice(0, 80),
                      collapsible: true,
                      previewLines: 8,
                    });
                    pushReverseBlocks();
                  } else if (extracts.length > 0) {
                    pushReverseBlocks();
                  }
                  if (rdkHint) {
                    aiBlocks.push({
                      type: 'collab',
                      side: 'rdkclaw',
                      collabRole: 'hint',
                      title: t('dock.collab.rdkHintTitle', 'RDKClaw 协作说明'),
                      subtitle: t('dock.collab.rdkHintSubtitle', '对本次协作的提示与下一步'),
                      lines: rdkHint.split('\n').slice(0, 40),
                      collapsible: true,
                      previewLines: 6,
                    });
                  }
                  mediaHandled = true;
                }

                if (!mediaHandled) {
                  if (state?.hiddenQuick) {
                    const r = result.trim();
                    if (r) {
                      if (isError) {
                        const errLine = tf('chat.tool.errLine', '{{tool}} 失败：{{msg}}', { tool: toolName, msg: r });
                        aiText = aiText.trim() ? `${aiText.trim()}\n\n${errLine}` : errLine;
                      } else {
                        aiText = aiText.trim() ? `${aiText.trim()}\n\n${r}` : r;
                      }
                    }
                  } else if (result.includes('\n') || result.length > 100) {
                    aiBlocks.push({
                      type: 'terminal',
                      lines: result.split('\n').slice(0, 60),
                      label: tf('chat.tool.finalLabel', '{{tool}} · 最终结果', { tool: toolName }),
                      collapsible: true,
                      previewLines: 10,
                    });
                  } else if (!state) {
                    const execFallback = String(
                      (event.data as { executor?: string }).executor || 'rdkclaw_local',
                    );
                    aiBlocks.push({
                      type: 'status',
                      title: toolName,
                      items: [{
                        label: executorLabel(execFallback),
                        value: result || (isError ? t('chat.tool.fail', '失败') : t('chat.tool.done', '完成')),
                        ok: !isError,
                      }],
                    });
                  }
                }

                // 对话里执行 switch_device 成功后，主动同步 UI 当前设备，
                // 保证“侧边栏切换”和“对话切换”两种方式始终一致。
                if (!isError && toolName === 'switch_device') {
                  const matchedId = result.match(/\[id:\s*([^\]\s]+)\]/)?.[1]?.trim();
                  if (matchedId && matchedId !== currentDevice?.id) {
                    const target = devices.find((item) => item.id === matchedId);
                    setActiveDevice(matchedId);
                    reportActiveDevice('tool-switch', matchedId);
                    addToast(tf('chat.device.switched', 'RDKClaw 已切换到设备：{{name}}', { name: target?.name || matchedId }), 'info');
                  }
                }

                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'turn_start': {
                if (!showDebugTurnsRef.current) break;
                const turn = Math.max(1, Number(event.data.turn || 0));
                const thinkPrefix = t('chat.think.turn', '思考轮次');
                const existing = aiBlocks.find(
                  (b) => b.type === 'status' && b.summary?.startsWith(thinkPrefix),
                );
                if (existing && existing.type === 'status') {
                  existing.items[0] = {
                    label: thinkPrefix,
                    value: tf('chat.think.roundN', '第 {{n}} 轮', { n: turn }),
                    ok: true,
                  };
                  existing.summary = tf('chat.think.summaryRound', '思考轮次 · 第 {{n}} 轮', { n: turn });
                } else {
                  aiBlocks.push({
                    type: 'status',
                    collapsible: true,
                    defaultCollapsed: true,
                    summary: tf('chat.think.summaryRound', '思考轮次 · 第 {{n}} 轮', { n: turn }),
                    items: [{ label: thinkPrefix, value: tf('chat.think.roundN', '第 {{n}} 轮', { n: turn }), ok: true }],
                  });
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'turn_end': {
                if (!showDebugTurnsRef.current) break;
                const turn = Math.max(1, Number(event.data.turn || 0));
                const thinkPrefixEnd = t('chat.think.turn', '思考轮次');
                const existingEnd = aiBlocks.find(
                  (b) => b.type === 'status' && b.summary?.startsWith(thinkPrefixEnd),
                );
                if (existingEnd && existingEnd.type === 'status') {
                  existingEnd.items[0] = {
                    label: thinkPrefixEnd,
                    value: tf('chat.think.totalN', '共 {{n}} 轮', { n: turn }),
                    ok: true,
                  };
                  existingEnd.summary = tf('chat.think.summaryTotal', '思考轮次 · 共 {{n}} 轮', { n: turn });
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'message_end': {
                if (!aiText.trim()) {
                  const serverFill = String(event.data.text || '');
                  const serverTrim = serverFill.trim();
                  const reasoningWithText = aiBlocks.find(
                    (b): b is Extract<ChatBlock, { type: 'reasoning' }> =>
                      b.type === 'reasoning' && Boolean((b as Extract<ChatBlock, { type: 'reasoning' }>).text?.trim()),
                  );
                  /**
                   * agent-loop 在正文为空时会把 `<thinking>` 解出塞进 message_end.text（visibleAssistantText），
                   * 与已在客户端 reasoning 块中展示的内容重复 → 主气泡出现长篇「推理原文」。
                   * 若已有推理块且服务端回填与之一致，则不要写入主文，保留折叠展示。
                   */
                  if (reasoningWithText) {
                    const rNorm = reasoningWithText.text.replace(/\r\n/g, '\n').trim();
                    const sNorm = serverTrim.replace(/\r\n/g, '\n');
                    aiText = !serverTrim || sNorm === rNorm ? '' : serverFill;
                  } else {
                    aiText = serverFill;
                  }
                }
                if (/<client-action\b/i.test(aiText)) {
                  aiText = applyClientActionsFromAssistantText(aiText);
                }
                updateAiMessage(aiText, aiBlocks, true);
                break;
              }
              case 'approval_required': {
                const approvalId = String(event.data.approvalId || '');
                if (!approvalId) break;
                const toolName = resolveToolName(event.data);
                const risk = String(event.data.risk || 'medium') as 'low' | 'medium' | 'high';
                const runId = String(event.data.runId || currentRunId || '');
                const executor = String(
                  event.data.executor || (isBoardOpenClawExecutorTool(toolName) ? 'board_openclaw' : 'rdkclaw_local'),
                );
                const summary = `${toolName} · ${executorLabel(executor)} · ${t('chat.approval.risk', '风险')} ${risk.toUpperCase()}`;
                approvalBlockRef.current[approvalId] = aiBlocks.length;
                aiBlocks.push({
                  type: 'approval',
                  approvalId,
                  runId,
                  risk,
                  executor,
                  text: tf('chat.approval.need', '需要你的确认后才能执行：{{summary}}', { summary }),
                });
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'recommendation': {
                const recId = String(event.data.recommendationId || '');
                if (!recId) break;
                const question = String(event.data.question || '');
                const options = (event.data.options as Array<{ id: string; label: string; description: string; recommended?: boolean }>) || [];
                const allowAutoExecute = Boolean(event.data.allowAutoExecute);
                const runId = String(event.data.runId || currentRunId || '');
                aiBlocks.push({
                  type: 'recommendation',
                  recommendationId: recId,
                  runId,
                  question,
                  options,
                  allowAutoExecute,
                });
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'recommendation_choice':
                break;
              case 'approval_decision': {
                const approvalId = String(event.data.approvalId || '');
                const decision = String(event.data.decision || 'allow_once');
                const index = approvalBlockRef.current[approvalId];
                if (typeof index === 'number') {
                  aiBlocks[index] = {
                    type: 'task-result',
                    success: decision !== 'deny',
                    title: decision === 'deny' ? t('chat.approval.denied', '已拒绝执行') : t('chat.approval.ok', '已确认执行'),
                    detail: tf('chat.approval.detail', '审批决策：{{decision}}', { decision }),
                  };
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'queue_status': {
                if (studioResponseMode === 'quick') break;
                const pos = Number(event.data.position ?? 0);
                const current = String(event.data.currentTask ?? '');
                const channel = String(event.data.currentChannel ?? '');
                const channelLabel = channel === 'feishu'
                  ? t('chat.queue.feishu', '飞书')
                  : channel === 'weixin'
                    ? t('chat.queue.weixin', '微信')
                    : channel || t('chat.queue.other', '其他渠道');
                const posLabel = pos > 0
                  ? tf('chat.queue.pos', '排在第 {{n}} 位', { n: pos })
                  : t('chat.queue.waiting', '正在排队');
                aiBlocks.push({
                  type: 'status',
                  items: [
                    { label: t('chat.queue.state', '队列状态'), value: posLabel, ok: false },
                    ...(current ? [{ label: t('chat.queue.current', '当前任务'), value: `${channelLabel}: ${current}`, ok: true }] : []),
                  ],
                  summary: tf('chat.queue.busy', '设备正忙，{{pos}}，请稍候...', { pos: posLabel }),
                });
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'error': {
                const errorMsg = (event.data.error as string) || t('chat.err.agent', 'Agent 执行出错');
                let friendlyText = '';
                let friendlyDetail = errorMsg;

                if (errorMsg.includes('未配置 AI 模型')) {
                  friendlyText = t('chat.err.noModel', '请先配置 AI 模型。打开设置 → AI 模型，选择服务商并填写 API Key。');
                  friendlyDetail = t('chat.err.noModelHint', '点击右上角 ⚙️ 设置图标即可配置');
                } else if (errorMsg.includes('401') || errorMsg.includes('Incorrect API key')) {
                  friendlyText = t('chat.err.apiKey', 'API Key 无效或已过期，请在设置中重新配置。');
                  friendlyDetail = t('chat.err.apiKeyHint', '打开设置 → AI 模型，更新 API Key');
                } else if (errorMsg.includes('Connection error') || errorMsg.includes('ECONNREFUSED')) {
                  friendlyText = t('chat.err.conn', '无法连接到 AI 服务，请检查网络或 API 地址。');
                  friendlyDetail = t('chat.err.connHint', '如果使用通义千问 sk-sp- 开头的 Key，请确认 Base URL 是否正确');
                } else if (errorMsg.toLowerCase().includes('network_error') || errorMsg.toLowerCase().includes('network error')) {
                  friendlyText = t('chat.err.netSearch', '联网检索阶段出现网络错误。');
                  friendlyDetail = t('chat.err.netSearchHint', '请检查本机网络、目标站点可达性及是否被限流；可稍后重试或先切换离线方案。');
                } else {
                  friendlyText = aiText || t('chat.err.generic', '请求出错，请稍后重试。');
                }

                aiBlocks.push({
                  type: 'status',
                  items: [{ label: t('chat.err.hint', '提示'), value: friendlyDetail, ok: false }],
                });
                updateAiMessage(friendlyText, aiBlocks, true);
                break;
              }
              case 'done':
                {
                  if (studioResponseMode === 'quick') break;
                  const tokenUsage = event.data.token_usage as {
                    promptTokens?: number;
                    completionTokens?: number;
                    totalTokens?: number;
                    estimated?: boolean;
                  } | undefined;
                  const contextStats = event.data.context as {
                    compactionCount?: number;
                    droppedMessages?: number;
                    summaryChars?: number;
                    overflowRecoveryCount?: number;
                    policy?: {
                      contextTokens?: number;
                      maxHistoryShare?: number;
                      softTrimRatio?: number;
                      hardClearRatio?: number;
                      keepLastAssistants?: number;
                    };
                  } | undefined;
                  const executionStats = event.data.execution as {
                    boardToolCalls?: number;
                    localToolCalls?: number;
                    toolCallNames?: string[];
                  } | undefined;
                  const performanceStats = event.data.performance as {
                    setupElapsedMs?: number;
                    workspaceInitMs?: number;
                    attachmentPrepareMs?: number;
                    boardSnapshotMs?: number;
                    firstEventMs?: number | null;
                    firstTextDeltaMs?: number | null;
                    totalElapsedMs?: number;
                  } | undefined;
                  if (tokenUsage || performanceStats || executionStats) {
                    const usageItems: Array<{ label: string; value: string; ok: boolean }> = [];
                    if (performanceStats) {
                      const totalMs = Math.max(0, Math.round(Number(performanceStats.totalElapsedMs || 0)));
                      const firstTextMs = Number(performanceStats.firstTextDeltaMs);
                      const label = Number.isFinite(firstTextMs)
                        ? tf('chat.perf.totalFirst', '总 {{ms}}ms · 首字 {{first}}ms', {
                            ms: totalMs,
                            first: Math.round(firstTextMs),
                          })
                        : tf('chat.perf.total', '总 {{ms}}ms', { ms: totalMs });
                      usageItems.push({ label: t('chat.perf.time', '耗时'), value: label, ok: true });
                    }
                    if (tokenUsage) {
                      const total = Math.max(0, Number(tokenUsage.totalTokens || 0));
                      usageItems.push({
                        label: 'Tokens',
                        value: `${total}${tokenUsage.estimated ? t('chat.perf.est', ' (估)') : ''}`,
                        ok: true,
                      });
                    }
                    if (executionStats) {
                      const board = Math.max(0, Number(executionStats.boardToolCalls || 0));
                      const local = Math.max(0, Number(executionStats.localToolCalls || 0));
                      if (board + local > 0) {
                        usageItems.push({
                          label: t('chat.perf.tools', '工具调用'),
                          value: tf('chat.perf.toolsVal', '本地 {{local}} · 板端 {{board}}', { local, board }),
                          ok: true,
                        });
                      }
                    }
                    if (contextStats) {
                      const compaction = Math.max(0, Number(contextStats.compactionCount || 0));
                      if (compaction > 0) {
                        usageItems.push({
                          label: t('chat.perf.compact', '上下文压缩'),
                          value: tf('chat.perf.compactVal', '{{n}} 次', { n: compaction }),
                          ok: true,
                        });
                      }
                    }
                    if (usageItems.length > 0) {
                      aiBlocks.push({
                        type: 'status',
                        collapsible: true,
                        defaultCollapsed: true,
                        summary: usageItems.map((i) => `${i.label}: ${i.value}`).join(' · '),
                        items: usageItems,
                      });
                    }
                    /** 无 perf 块时也必须 flush，否则前面从推理提升的正文仍留在闭包、pendingText 未更新 */
                    if (/<client-action\b/i.test(aiText)) {
                      aiText = applyClientActionsFromAssistantText(aiText);
                    }
                    updateAiMessage(aiText, aiBlocks, true);
                  }
                }
                break;
              case 'run_progress': {
                if (studioResponseMode === 'quick') break;
                const msg = String(event.data.message || t('chat.progress.wait', '仍在处理中...'));
                const existingIdx = aiBlocks.findIndex(
                  (b) => b.type === 'status' && (b as any)._runProgress,
                );
                const progressBlock = {
                  type: 'status' as const,
                  _runProgress: true,
                  items: [{ label: t('chat.progress.label', '⏳ 进度'), value: msg, ok: true }],
                };
                if (existingIdx >= 0) {
                  aiBlocks[existingIdx] = progressBlock;
                } else {
                  aiBlocks.push(progressBlock);
                }
                appendRunTimelineEntry(generation, {
                  kind: 'progress',
                  title: t('chat.timeline.heartbeat', '进度心跳'),
                  detail: msg,
                });
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'run_complete': {
                const progressIdx = aiBlocks.findIndex(
                  (b) => b.type === 'status' && (b as any)._runProgress,
                );
                if (progressIdx >= 0) {
                  /** 勿保留 items:[] 的 status，否则会渲染成中间空白框 */
                  aiBlocks.splice(progressIdx, 1);
                }
                const elapsed = String(event.data.elapsed_display || '');
                const calls = Number(event.data.tool_calls || 0);
                const isError = Boolean(event.data.error);
                const isCancelled = Boolean(event.data.cancelled);
                const stopReason = String((event.data as { stop_reason?: string }).stop_reason || '').trim();
                const stopHint = String((event.data as { stop_hint?: string }).stop_hint || '').trim();
                const detail: string[] = [];
                if (elapsed) detail.push(elapsed);
                if (calls > 0) detail.push(tf('chat.runComplete.steps', '{{n}} 步', { n: calls }));
                if (stopHint) detail.push(stopHint);
                const label = isCancelled
                  ? t('chat.runComplete.cancelled', '⊘ 已取消')
                  : isError
                    ? t('chat.runComplete.err', '✗ 执行出错')
                    : stopReason === 'max_turns_reached'
                      ? t('chat.runComplete.maxTurns', '✓ 已完成（已达轮次上限）')
                      : t('chat.runComplete.ok', '✓ 回复完成');
                const ok = !isError && !isCancelled && stopReason !== 'max_turns_reached';
                const showCompleteFooter = studioResponseMode !== 'quick' || stopReason === 'max_turns_reached' || isError || isCancelled;
                if (!showCompleteFooter) {
                  updateAiMessage(aiText, aiBlocks, true);
                  break;
                }
                aiBlocks.push({
                  type: 'status',
                  items: [{ label, value: detail.length > 0 ? detail.join(' · ') : '', ok }],
                });
                appendRunTimelineEntry(generation, {
                  kind: 'complete',
                  title: label,
                  detail: detail.length > 0 ? detail.join(' · ') : undefined,
                });
                if (/<client-action\b/i.test(aiText)) {
                  aiText = applyClientActionsFromAssistantText(aiText);
                }
                updateAiMessage(aiText, aiBlocks, true);
                break;
              }
            }
          },
        );
        streamAbortRef.current = abort;

        await done;
        if (rafHandle) { cancelAnimationFrame(rafHandle); flushAiMessage(); }
        if (generation !== streamGenerationRef.current) return;
        const streamCompletedAt = Date.now();
        let bodyTrim = (pendingText || aiText).trim();
        if (/<client-action\b/i.test(bodyTrim)) {
          bodyTrim = applyClientActionsFromAssistantText(bodyTrim).trim();
        }
        if (!bodyTrim) {
          const fallback = t(
            'chat.err.emptyReply',
            '未收到可见回复。请重试一次；仍无输出时请检查模型与网络，或改用「快捷回答」。',
          );
          setChatMessages((prev) => prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  text: fallback,
                  blocks: [...pendingBlocks],
                  durationMs: Math.max(0, streamCompletedAt - msgId),
                }
              : m,
          ));
        } else {
          setChatMessages((prev) => prev.map((m) =>
            m.id === aiMsgId ? { ...m, durationMs: Math.max(0, streamCompletedAt - msgId) } : m,
          ));
        }
        setAiTyping(false);
      } finally {
        if (generation === streamGenerationRef.current) {
          streamAbortRef.current = null;
          currentRunIdRef.current = '';
          commandLockRef.current = false;
          setAiTyping(false);
        }
      }
    })();
  };

  const handleApprovalAction = (
    approvalId: string,
    action: 'allow_once' | 'allow_session_auto' | 'allow_global_auto' | 'deny' | 'cancel_run',
    runId?: string,
  ) => {
    if (action === 'cancel_run') {
      if (!runId) return;
      cancelRDKClawRun(runId).catch(() => null);
      const cancelAiTs = Date.now();
      setChatMessages((prev) => [...prev, {
        id: cancelAiTs,
        role: 'ai',
        text: '',
        blocks: [{
          type: 'task-result',
          success: false,
          title: t('chat.cancelled.title', '已取消当前任务'),
          detail: tf('chat.stop.detailRun', 'runId: {{id}}', { id: runId }),
        }],
      }]);
      return;
    }
    decideRDKClawApproval(approvalId, action).catch(() => null);
    setChatMessages((prev) => prev.map((msg) => ({
      ...msg,
      blocks: msg.blocks?.map((b) => {
        if (b.type !== 'approval' || b.approvalId !== approvalId) return b;
        const ok = action !== 'deny';
        return {
          type: 'task-result',
          success: ok,
          title: ok ? t('chat.approval.submitted', '已提交审批决策') : t('chat.approval.rejected', '已拒绝执行'),
          detail: ok ? tf('chat.approval.subDetail', '策略：{{action}}', { action }) : t('chat.approval.rejectDetail', '该步骤不会执行'),
        };
      }),
    })));
  };

  const handleRecommendationChoice = (recommendationId: string, choiceId: string, autoExecute: boolean) => {
    sendRecommendationChoice(recommendationId, choiceId, autoExecute).catch(() => null);
    setChatMessages((prev) => prev.map((msg) => ({
      ...msg,
      blocks: msg.blocks?.map((b) => {
        if (b.type !== 'recommendation' || b.recommendationId !== recommendationId) return b;
        return { ...b, chosen: choiceId };
      }),
    })));
  };

  const handleSoulUpdateDecision = async (proposalId: string, accepted: boolean) => {
    void proposalId;
    void accepted;
    addToast(t('chat.soul.closed', 'SOUL 更新入口已关闭：请通过 USER.md 调整偏好'), 'info');
  };

  const stopCurrentRun = async () => {
    const runId = currentRunIdRef.current;
    abortInFlightRun(false);
    try {
      if (runId) {
        await cancelRDKClawRun(runId);
      } else {
        await cancelAllRDKClawRuns();
      }
      setBackgroundRuns((prev) => prev.map((item) => ({ ...item, status: 'ended' as const })));
      const stopSentTs = Date.now();
      setChatMessages((prev) => [...prev, {
        id: stopSentTs,
        role: 'ai',
        text: t('chat.stop.sent', '停止指令已发送，当前任务将尽快结束。'),
        blocks: [{
          type: 'task-result',
          success: true,
          title: t('chat.stop.title', '已请求停止任务'),
          detail: runId
            ? tf('chat.stop.detailRun', 'runId: {{id}}', { id: runId })
            : t('chat.stop.detailAll', '已请求停止所有运行中的任务'),
        }],
        source: 'studio',
      }]);
    } catch {
      addToast(t('chat.stop.failRetry', '停止任务失败，请重试“全部停止”'), 'error');
    } finally {
      setAiTyping(false);
      commandLockRef.current = false;
      currentRunIdRef.current = '';
    }
  };

  const stopAllRuns = async () => {
    abortInFlightRun(false);
    try {
      const res = await cancelAllRDKClawRuns();
      const count = res.cancelled ?? 0;
      const pausedAutonomyTasks = Number(res.pausedAutonomyTasks ?? 0);
      const cancelledAutonomyRuns = Number(res.cancelledAutonomyRuns ?? 0);
      const detailParts = [t('chat.stopAll.detail1', '包括来自 Studio、飞书、微信的任务')];
      if (pausedAutonomyTasks > 0) {
        detailParts.push(tf('chat.stopAll.paused', '已暂停定时任务 {{n}} 个', { n: pausedAutonomyTasks }));
      }
      if (cancelledAutonomyRuns > 0) {
        detailParts.push(tf('chat.stopAll.cancelled', '已中断定时任务运行 {{n}} 个', { n: cancelledAutonomyRuns }));
      }
      const stopAllTs = Date.now();
      setChatMessages((prev) => [...prev, {
        id: stopAllTs,
        role: 'ai',
        text: '',
        blocks: [{
          type: 'task-result',
          success: true,
          title: tf('chat.stopAll.title', '已停止所有运行中的任务（{{n}} 个）', { n: count }),
          detail: detailParts.join(t('chat.stopAll.sep', '；')),
        }],
        source: 'studio',
      }]);
      setBackgroundRuns((prev) => prev.map((item) => ({ ...item, status: 'ended' as const })));
      addToast(tf('chat.stopAll.toast', '已停止 {{n}} 个运行中的任务', { n: count }), 'info');
    } catch {
      addToast(t('chat.stopAll.fail', '停止所有任务失败'), 'error');
    }
  };

  const backgroundCurrentRun = () => {
    void stopCurrentRun();
  };

  const stopBackgroundRun = (runId: string) => {
    if (!runId) return;
    cancelRDKClawRun(runId).catch(() => null);
    setBackgroundRuns((prev) => prev.map((item) => (
      item.runId === runId ? { ...item, status: 'ended' as const } : item
    )));
    const bgEndTs = Date.now();
    setChatMessages((prev) => [...prev, {
      id: bgEndTs,
      role: 'ai',
      text: t('chat.bg.ended', '后台任务已结束。'),
      blocks: [{
        type: 'task-result',
        success: false,
        title: t('chat.bg.title', '后台任务已结束'),
        detail: tf('chat.stop.detailRun', 'runId: {{id}}', { id: runId }),
      }],
    }]);
  };

  const resumeStudioThread = useCallback(
    (rawDeviceId: string, targetSessionId: string) => {
      const nextDeviceId = toChatDeviceId(rawDeviceId);
      const sid = String(targetSessionId || '').trim();
      if (!sid) return;

      if (chatPersistTimerRef.current) {
        clearTimeout(chatPersistTimerRef.current);
        chatPersistTimerRef.current = null;
      }

      abortInFlightRun(false);
      setRdkClawRunTimeline([]);

      try {
        const prevToSave = stripHeavyDataUrlsForStorage(chatMessagesRef.current.slice(-50));
        localStorage.setItem(
          chatHistoryStorageKey(chatDeviceIdRef.current, sessionIdRef.current),
          JSON.stringify(prevToSave),
        );
        localStorage.setItem(chatDraftStorageKey(chatDeviceIdRef.current), cmd);
      } catch {
        /* ignore */
      }

      persistStudioChatSessionId(nextDeviceId, sid);

      const dockDeviceId = nextDeviceId === GLOBAL_CHAT_DEVICE_ID ? '' : nextDeviceId;
      /**
       * 必须先对齐 chatDeviceIdRef，再 setActiveDevice。
       * 否则设备切换 effect 会看到「ref 仍是旧设备、state 已是新设备」，
       * 误走整段切换逻辑（getOrCreate 会话 / 合并全局消息），把刚恢复的线程冲掉。
       */
      chatDeviceIdRef.current = nextDeviceId;
      sessionIdRef.current = sid;

      setChatMessages(loadChatHistoryFromStorage(nextDeviceId, sid));
      try {
        setCmd(localStorage.getItem(chatDraftStorageKey(nextDeviceId)) ?? '');
      } catch {
        setCmd('');
      }

      if (toChatDeviceId(currentDevice?.id) !== nextDeviceId) {
        setActiveDevice(dockDeviceId);
      }

      reportActiveSession('resume-thread');
      reportActiveDevice(
        'resume-thread',
        nextDeviceId === GLOBAL_CHAT_DEVICE_ID ? undefined : nextDeviceId,
      );

      setChatExpanded(true);
    },
    [
      abortInFlightRun,
      cmd,
      currentDevice?.id,
      setActiveDevice,
      setChatExpanded,
      setChatMessages,
      setCmd,
    ],
  );

  const deleteStudioThread = useCallback(
    (rawDeviceId: string, targetSessionId: string) => {
      const nextDeviceId = toChatDeviceId(rawDeviceId);
      const sid = String(targetSessionId || '').trim();
      if (!sid) return;

      purgeLocalChatThread(nextDeviceId, sid);

      const isCurrent =
        chatDeviceIdRef.current === nextDeviceId && sessionIdRef.current === sid;

      if (!isCurrent) {
        try {
          const peek = peekStudioChatSessionId(nextDeviceId);
          if (peek === sid) {
            const fresh = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            persistStudioChatSessionId(nextDeviceId, fresh);
          }
        } catch {
          /* ignore */
        }
      }

      if (isCurrent) {
        abortInFlightRun(false);
        setChatMessages([]);
        try {
          localStorage.removeItem(chatHistoryLegacyDeviceKey(nextDeviceId));
          localStorage.removeItem(chatDraftStorageKey(nextDeviceId));
          if (nextDeviceId === GLOBAL_CHAT_DEVICE_ID) {
            localStorage.removeItem(CHAT_HISTORY_LEGACY_KEY);
          }
        } catch {
          /* ignore */
        }
        const nextSid = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        sessionIdRef.current = nextSid;
        persistStudioChatSessionId(nextDeviceId, nextSid);
        void setActiveRdkclawSession(nextSid);
        setRdkClawRunTimeline([]);
      }

      addToast(
        t(
          'chat.hub.threadDeletedToast',
          '已删除该会话的本机存档。',
        ),
        'info',
      );
    },
    [abortInFlightRun, addToast, setChatMessages, t],
  );

  // ── Effects ──

  useEffect(() => {
    reportActiveSession('init');
    reportActiveDevice('init');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const nextDeviceId = toChatDeviceId(currentDevice?.id);
    const prevDeviceId = chatDeviceIdRef.current;
    if (nextDeviceId === prevDeviceId) return;

    try {
      const prevToSave = stripHeavyDataUrlsForStorage(chatMessages.slice(-50));
      localStorage.setItem(chatHistoryStorageKey(prevDeviceId, sessionIdRef.current), JSON.stringify(prevToSave));
      localStorage.setItem(chatDraftStorageKey(prevDeviceId), cmd);
    } catch {
      // ignore
    }

    chatDeviceIdRef.current = nextDeviceId;
    sessionIdRef.current = getOrCreateStudioChatSessionId(nextDeviceId);

    const loadedForDevice = loadChatHistoryFromStorage(nextDeviceId, sessionIdRef.current);
    if (prevDeviceId === GLOBAL_CHAT_DEVICE_ID && nextDeviceId !== GLOBAL_CHAT_DEVICE_ID) {
      const merged = mergeChatMessagesById(chatMessages, loadedForDevice);
      setChatMessages(merged);
      try {
        localStorage.setItem(
          chatHistoryStorageKey(nextDeviceId, sessionIdRef.current),
          JSON.stringify(stripHeavyDataUrlsForStorage(merged.slice(-50))),
        );
      } catch {
        /* ignore */
      }
    } else {
      setChatMessages(loadedForDevice);
    }

    try {
      let nextDraft = localStorage.getItem(chatDraftStorageKey(nextDeviceId)) ?? '';
      if (
        !nextDraft.trim() &&
        prevDeviceId === GLOBAL_CHAT_DEVICE_ID &&
        nextDeviceId !== GLOBAL_CHAT_DEVICE_ID
      ) {
        nextDraft = localStorage.getItem(chatDraftStorageKey(GLOBAL_CHAT_DEVICE_ID)) ?? '';
      }
      setCmd(nextDraft);
    } catch {
      setCmd('');
    }

    reportActiveSession('device-switch');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  useEffect(() => {
    if (!currentDevice?.id) return;
    reportActiveDevice('device-change');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  /** 选中设备后自动拉一次 OpenClaw 状态写入 sessionStorage，供 Agent 请求携带 studioUiHints（无需先打开 Dashboard） */
  useEffect(() => {
    const id = String(currentDevice?.id || '').trim();
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const healthRes = await fetchDeviceOpenClawHealth(id);
        if (cancelled) return;
        if (healthRes.status) persistOpenClawHealthSnapshot(id, healthRes.status);
      } catch {
        /* ignore */
      }
      try {
        const res = await fetchApi(`/api/devices/${encodeURIComponent(id)}/openclaw/status`);
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { running?: boolean; version?: string; installed?: boolean; feishuConnected?: boolean };
        persistGatewayStatusSnapshot(id, {
          running: !!data.running,
          version: typeof data.version === 'string' ? data.version : '',
          installed: !!(data.installed ?? (typeof data.version === 'string' && !!data.version.trim())),
          feishuConnected: !!data.feishuConnected,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentDevice?.id]);

  useEffect(() => {
    const onNotify = (evt: Event) => {
      const e = evt as CustomEvent<{
        type?: string;
        title?: string;
        message?: string;
        level?: string;
        ts?: number;
        payload?: {
          channel?: string;
          direction?: 'inbound' | 'ack' | 'outbound' | 'error';
          openIdMasked?: string;
          chatId?: string;
          messageId?: string;
          sessionId?: string;
          mirrorId?: string;
          rdkEventKind?: 'tool_start' | 'tool_progress' | 'tool_result';
          toolName?: string;
          toolCallId?: string;
          executor?: 'board_openclaw' | 'rdkclaw_local' | string;
          isError?: boolean;
        };
      }>;
      const detail = e.detail ?? {};
      const ts = detail.ts ?? Date.now();
      const title = detail.title || t('chat.push.title', '系统推送');
      const message = detail.message || t('chat.push.msg', '收到新的系统事件');
      const ok = detail.level !== 'error';
      const payload = detail.payload || {};
      const isFeishuMirror = detail.type?.startsWith('channel_message_') && payload.channel === 'feishu';
      if (isFeishuMirror) {
        const toProgressLines = (raw: string) => raw
          .replace(/\r/g, '\n')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^(board_openclaw_\w+|fleet_board_\w+):\s*/i, '').trim())
          .slice(-20);
        const dedupeLines = (prevLines: string[], nextLines: string[]) => {
          if (nextLines.length === 0) return prevLines;
          const merged = [...prevLines];
          for (const line of nextLines) {
            if (!line) continue;
            if (merged[merged.length - 1] === line) continue;
            merged.push(line);
          }
          return merged.slice(-240);
        };
        const resolveToolStreamKey = () => {
          const toolCallId = String(payload.toolCallId || '').trim();
          const toolName = String(payload.toolName || '').trim();
          const chatId = String(payload.chatId || '').trim();
          if (toolCallId) return `tool:${toolCallId}`;
          if (toolName && chatId) return `chat:${chatId}:tool:${toolName}`;
          if (toolName) return `tool:${toolName}`;
          return '';
        };
        if (payload.sessionId && payload.sessionId !== sessionIdRef.current) {
          // 飞书会话优先作为统一上下文，自动接管当前 Studio 会话键
          persistSessionId(payload.sessionId);
          reportActiveSession('feishu-mirror-switch');
        }
        const dedupKey = payload.mirrorId
          ? String(payload.mirrorId)
          : `${payload.messageId || ''}:${detail.type || ''}:${payload.direction || ''}`;
        if (dedupKey !== '::' && feishuMirrorSeenRef.current.has(dedupKey)) return;
        if (dedupKey !== '::') feishuMirrorSeenRef.current.add(dedupKey);
        setChatExpanded(true);
        const feishuExec = payload.executor === 'board_openclaw'
          ? t('chat.feishu.exec.board', '板端 OpenClaw')
          : payload.executor
            ? String(payload.executor)
            : 'RDKClaw';
        if (payload.rdkEventKind === 'tool_start' || payload.rdkEventKind === 'tool_progress' || payload.rdkEventKind === 'tool_result') {
          const phaseText = payload.rdkEventKind === 'tool_start'
            ? t('chat.feishu.start', '开始执行')
            : payload.rdkEventKind === 'tool_progress'
              ? t('chat.feishu.running', '执行中')
              : (payload.isError ? t('chat.feishu.fail', '执行失败') : t('chat.feishu.done', '执行完成'));
          const toolName = payload.toolName || 'unknown_tool';
          const streamKeyRaw = resolveToolStreamKey();
          const streamKey = streamKeyRaw || feishuLastToolKeyRef.current;
          const lines = toProgressLines(message);
          if (payload.rdkEventKind === 'tool_start') {
            const messageId = ts + 1;
            if (streamKeyRaw) {
              feishuToolMessageRef.current[streamKeyRaw] = messageId;
              feishuLastToolKeyRef.current = streamKeyRaw;
            }
            setChatMessages((prev) => [
              ...prev,
              {
                id: messageId,
                role: 'ai',
                startedAt: Date.now(),
                text: '',
                source: 'studio',
                blocks: [
                  {
                    type: 'status',
                    items: [{ label: tf('chat.feishu.flow', '飞书流程 · {{tool}}', { tool: toolName }), value: `${feishuExec} · ${phaseText}`, ok: true }],
                  },
                  ...(lines.length > 0 ? [{
                    type: 'terminal' as const,
                    label: tf('chat.feishu.live', '{{tool}} · 实时反馈', { tool: toolName }),
                    lines,
                    collapsible: true,
                    previewLines: 8,
                  }] : []),
                ],
                channelMeta: {
                  channel: 'feishu',
                  direction: payload.direction,
                  openIdMasked: payload.openIdMasked,
                  chatId: payload.chatId,
                  messageId: payload.messageId,
                },
              },
            ]);
            return;
          }

          const existingId = streamKey ? feishuToolMessageRef.current[streamKey] : undefined;
          if (existingId) {
            setChatMessages((prev) => prev.map((item) => {
              if (item.id !== existingId) return item;
              const nextBlocks = [...(item.blocks ?? [])];
              const statusIdx = nextBlocks.findIndex((b) => b.type === 'status');
              if (statusIdx >= 0) {
                const statusBlock = nextBlocks[statusIdx];
                if (statusBlock?.type === 'status' && statusBlock.items[0]) {
                  statusBlock.items[0] = {
                    label: tf('chat.feishu.flow', '飞书流程 · {{tool}}', { tool: toolName }),
                    value: `${feishuExec} · ${phaseText}`,
                    ok: payload.rdkEventKind !== 'tool_result' || !payload.isError,
                  };
                }
              } else {
                nextBlocks.unshift({
                  type: 'status',
                  items: [{ label: tf('chat.feishu.flow', '飞书流程 · {{tool}}', { tool: toolName }), value: `${feishuExec} · ${phaseText}`, ok: payload.rdkEventKind !== 'tool_result' || !payload.isError }],
                });
              }
              const terminalIdx = nextBlocks.findIndex((b) => b.type === 'terminal');
              if (terminalIdx >= 0) {
                const terminalBlock = nextBlocks[terminalIdx];
                if (terminalBlock?.type === 'terminal') {
                  terminalBlock.label = tf('chat.feishu.live', '{{tool}} · 实时反馈', { tool: toolName });
                  terminalBlock.lines = dedupeLines(terminalBlock.lines, lines);
                }
              } else if (lines.length > 0) {
                nextBlocks.push({
                  type: 'terminal',
                  label: tf('chat.feishu.live', '{{tool}} · 实时反馈', { tool: toolName }),
                  lines,
                  collapsible: true,
                  previewLines: 8,
                });
              }
              return {
                ...item,
                blocks: nextBlocks,
                ...(payload.rdkEventKind === 'tool_result'
                  ? { durationMs: Math.max(0, Date.now() - (item.startedAt ?? item.id)) }
                  : {}),
              };
            }));
            return;
          }

          const fallbackMessageId = ts + 1;
          if (streamKey) {
            feishuToolMessageRef.current[streamKey] = fallbackMessageId;
            feishuLastToolKeyRef.current = streamKey;
          }
          const feishuFallbackStartedAt = Date.now();
          setChatMessages((prev) => [
            ...prev,
            {
              id: fallbackMessageId,
              role: 'ai',
              startedAt: feishuFallbackStartedAt,
              text: '',
              source: 'studio',
              ...(payload.rdkEventKind === 'tool_result'
                ? { durationMs: Math.max(0, Date.now() - feishuFallbackStartedAt) }
                : {}),
              blocks: [
                {
                  type: 'status',
                  items: [{ label: tf('chat.feishu.flow', '飞书流程 · {{tool}}', { tool: toolName }), value: `${feishuExec} · ${phaseText}`, ok: payload.rdkEventKind !== 'tool_result' || !payload.isError }],
                },
                ...(lines.length > 0 ? [{
                  type: 'terminal' as const,
                  label: tf('chat.feishu.live', '{{tool}} · 实时反馈', { tool: toolName }),
                  lines,
                  collapsible: true,
                  previewLines: 8,
                }] : []),
              ],
              channelMeta: {
                channel: 'feishu',
                direction: payload.direction,
                openIdMasked: payload.openIdMasked,
                chatId: payload.chatId,
                messageId: payload.messageId,
              },
            },
          ]);
          return;
        }
        if (payload.direction === 'ack' || payload.direction === 'error') {
          const label = payload.direction === 'error' ? t('chat.feishu.recv', '飞书通道') : t('chat.feishu.receipt', '飞书回执');
          setChatMessages((prev) => [
            ...prev,
            {
              id: ts + 1,
              role: 'ai',
              text: '',
              source: 'studio',
              blocks: [
                {
                  type: 'status',
                  items: [{ label, value: message, ok: payload.direction !== 'error' }],
                },
              ],
              channelMeta: {
                channel: 'feishu',
                direction: payload.direction,
                openIdMasked: payload.openIdMasked,
                chatId: payload.chatId,
                messageId: payload.messageId,
              },
            },
          ]);
          return;
        }
        const role = payload.direction === 'inbound' ? 'user' : 'ai';
        setChatMessages((prev) => [
          ...prev,
          {
            id: ts + (role === 'ai' ? 1 : 0),
            role,
            text: message,
            source: 'studio',
            channelMeta: {
              channel: 'feishu',
              direction: payload.direction,
              openIdMasked: payload.openIdMasked,
              chatId: payload.chatId,
              messageId: payload.messageId,
            },
          },
        ]);
        return;
      }
      setChatExpanded(true);
      setChatMessages((prev) => [
        ...prev,
        {
          id: ts,
          role: 'ai',
          text: '',
          source: 'studio',
          blocks: [
            {
              type: 'status',
              items: [{ label: title, value: message, ok }],
            },
          ],
        },
      ]);
    };
    window.addEventListener('rdkclaw-notify', onNotify as EventListener);
    return () => window.removeEventListener('rdkclaw-notify', onNotify as EventListener);
  }, [language]);

  // Persist chat history (debounced to avoid blocking main thread during streaming)
  useEffect(() => {
    if (chatPersistTimerRef.current) clearTimeout(chatPersistTimerRef.current);
    chatPersistTimerRef.current = setTimeout(() => {
      try {
        const toSave = stripHeavyDataUrlsForStorage(chatMessagesRef.current.slice(-50));
        localStorage.setItem(
          chatHistoryStorageKey(chatDeviceIdRef.current, sessionIdRef.current),
          JSON.stringify(toSave),
        );
        localStorage.setItem(chatDraftStorageKey(chatDeviceIdRef.current), cmd);
        if (toChatDeviceId(chatDeviceIdRef.current) === GLOBAL_CHAT_DEVICE_ID) {
          localStorage.setItem(CHAT_HISTORY_LEGACY_KEY, JSON.stringify(toSave));
        }
      } catch { /* quota exceeded */ }
    }, aiTyping ? 2000 : 300);
    return () => {
      if (chatPersistTimerRef.current) {
        clearTimeout(chatPersistTimerRef.current);
        chatPersistTimerRef.current = null;
      }
    };
  }, [chatMessages, aiTyping, cmd]); /* chatMessages 参与调度；正文用 ref 避免闭包与 sessionId 不同步 */

  // Cleanup task intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(taskIntervalsRef.current).forEach(id => clearInterval(id));
      taskIntervalsRef.current = {};
    };
  }, []);

  // Close chat panel on tab change（副屏常驻展开，不受主导航切换影响）
  useEffect(() => {
    if (getRdkEmbedPanel()) return;
    const prev = prevNavTabRef.current;
    prevNavTabRef.current = activeTab;

    if (activeTab === 'ai-chat-hub') return;

    /** 从「AI 对话」进入工作台：保留展开态，避免刚恢复的历史消息被立刻收起而看似「没还原」 */
    if (prev === 'ai-chat-hub' && activeTab === 'dashboard') return;

    if (chatExpanded) setChatExpanded(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  /** 多窗口：另一标签页写入 localStorage 后同步到当前窗口内存态 */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== localStorage || !e.key) return;
      if (e.key !== chatHistoryStorageKey(chatDeviceIdRef.current, sessionIdRef.current)) return;
      if (!e.newValue) {
        setChatMessages([]);
        return;
      }
      try {
        const parsed = JSON.parse(e.newValue) as ChatMessage[];
        setChatMessages(parsed.slice(-MAX_CHAT_MESSAGES_IN_MEMORY));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const getStudioChatSessionId = useCallback(() => String(sessionIdRef.current || '').trim(), []);
  const getStudioChatDeviceId = useCallback(() => chatDeviceIdRef.current, []);

  const exportDebugBundle = useCallback(
    async (options?: { includeBoardLogs?: boolean }) => {
      const sessionId = String(sessionIdRef.current || '').trim();
      if (!sessionId) {
        addToast(translate(isEn, 'dock.export.noSession', '无法导出：缺少会话 ID'), 'warning');
        return;
      }
      try {
        const uiSnapshot = {
          exportedAt: new Date().toISOString(),
          studioSessionId: sessionId,
          chatDeviceId: chatDeviceIdRef.current,
          studioResponseMode,
          device: currentDevice
            ? { id: currentDevice.id, ip: currentDevice.ip, name: currentDevice.name }
            : null,
          chatMessages: stripHeavyDataUrlsForStorage(chatMessages),
          rdkClawRunTimeline,
          agentExecution,
        };
        await downloadRdkclawDebugBundle({
          sessionId,
          deviceId: currentDevice?.id,
          userId: userIdRef.current,
          includeBoardLogs: options?.includeBoardLogs !== false,
          uiSnapshot,
        });
        addToast(translate(isEn, 'dock.export.ok', '排查包已下载'), 'success');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addToast(
          fillTemplate(translate(isEn, 'dock.export.fail', '导出失败：{{msg}}'), { msg }),
          'error',
        );
      }
    },
    [
      addToast,
      isEn,
      studioResponseMode,
      currentDevice,
      chatMessages,
      rdkClawRunTimeline,
      agentExecution,
    ],
  );

  const value: AIChatStoreState = {
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, setChatMessages, chatExpanded, setChatExpanded,
    aiTyping, setAiTyping, handleCommand,
    executeConfirm, dismissConfirm, clearChatHistory, resumeStudioThread, deleteStudioThread,
    agentMode, setAgentMode, agentPlan, agentExecution,
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask, handleApprovalAction, handleRecommendationChoice, handleSoulUpdateDecision, stopCurrentRun, stopAllRuns, backgroundCurrentRun,
    backgroundRuns, stopBackgroundRun,
    rdkClawRunTimeline, runTimelinePanelOpen, setRunTimelinePanelOpen,
    studioResponseMode, setStudioResponseMode,
    exportDebugBundle,
    getStudioChatSessionId,
    getStudioChatDeviceId,
  };

  return React.createElement(AIChatContext.Provider, { value }, children);
}
