import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AiDockContentSlot,
  ChatMessage,
  ChatBlock,
  AgentPlan,
  AgentExecutionState,
  ChatAttachment,
} from '../app-types';
import { CMD_SUGGESTIONS, type CmdSuggestion } from '../constants';
import { translate } from '../i18n/translate';
import { fillTemplate } from '../i18n/en-extras';
import {
  bindRDKClawFeishuCode,
  cancelRDKClawRun,
  cancelAllRDKClawRuns,
  getActiveRDKClawRuns,
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
import { sanitizeTerminalLineForDisplay } from '../utils/strip-ansi';
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
import {
  applyClientActionsFromAssistantText,
  registerStudioClientActionHandlers,
} from '../utils/client-action-bridge';
import {
  dispatchOpenEmbedIntentFromUserMessage,
  tryOpenProductDocFromUserMessage,
} from '../utils/studio-user-intent';

/** 编排 meta 摘要行：技能名过长时截断，避免标题栏铺满 */
function formatMatchedSkillsShort(skills: string[], maxItems = 2, maxEach = 28): string {
  if (skills.length === 0) return '';
  const trim = (s: string) => {
    const t = String(s || '').trim();
    if (t.length <= maxEach) return t;
    return `${t.slice(0, Math.max(0, maxEach - 1))}…`;
  };
  const parts = skills.slice(0, maxItems).map(trim);
  if (skills.length > maxItems) {
    return `${parts.join(' / ')} 等${skills.length}项`;
  }
  return parts.join(' / ');
}

function capMetaSummaryLine(parts: string[], maxChars: number): string {
  const j = parts.filter(Boolean).join(' · ');
  if (j.length <= maxChars) return j;
  return `${j.slice(0, Math.max(0, maxChars - 1))}…`;
}

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

  /** 工作台 RDK 对话：quick / thinking 对应不同模型配置；对话内均展示 meta、工具与步骤 */
  studioResponseMode: StudioResponseMode;
  setStudioResponseMode: (v: StudioResponseMode) => void;

  /** 导出运行诊断 ZIP（本机会话 JSONL、对话界面快照、可选设备日志） */
  exportDebugBundle: (options?: { includeBoardLogs?: boolean }) => Promise<void>;
  /**
   * 按左侧列表选中的设备桶与 Studio 会话导出运行诊断包（与当前 Dock 线程不一致时也使用对应 sessionKey 拉本会话 JSONL）。
   */
  exportDebugBundleForThread: (opts: {
    archiveDevId: string;
    sessionId: string;
    snapshotMessages: ChatMessage[];
    includeBoardLogs?: boolean;
  }) => Promise<void>;
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

const LONG_HEX_TOKEN_RE = /\b[a-fA-F0-9]{64,}\b/g;
const LONG_BASE64_TOKEN_RE = /\b[A-Za-z0-9+/_-]{80,}={0,2}\b/g;
const ENCRYPTED_FIELD_RE =
  /"(payload|cipher|ciphertext|encrypted|signature|token|authTag)"\s*:\s*"([A-Za-z0-9+/_=-]{40,})"/gi;
const RDK_SHELL_READY_RE = /__RDK_SHELL_READY__/i;
const RDK_SHELL_EXIT_RE = /__RDK_EXIT__[a-f0-9]{16,}__(?:\d+)?/i;
const RDK_SHELL_WRAPPER_RE =
  /(?:stty\s+-echo\b.*base64\s+-d|eval\s+"\$\(printf\b.*base64\s+-d|printf\s+'\\n__RDK_EXIT__)/i;
const INTERNAL_DRAFT_TOOL_RE = /(device_exec|load_tools|board_openclaw_[a-z_]+|工具列表|未知工具|调用工具)/i;
const INTERNAL_DRAFT_TONE_RE = /(不对|我先|先看看|先确认|那我先|可能是|或者|所以我现在|让我先)/;

function stripRdkShellProtocolNoise(input: string): string {
  const text = String(input || '');
  if (!text) return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    if (RDK_SHELL_READY_RE.test(trimmed)) continue;
    if (RDK_SHELL_EXIT_RE.test(trimmed)) continue;
    if (RDK_SHELL_WRAPPER_RE.test(trimmed)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimStart();
}

function sanitizeCipherLikeText(input: string): string {
  const text = stripRdkShellProtocolNoise(input);
  if (!text) return '';
  const withFieldMask = text.replace(
    ENCRYPTED_FIELD_RE,
    (_m, key: string, value: string) => `"${key}":"[hidden-${value.length}]"`,
  );
  const withHexMask = withFieldMask.replace(LONG_HEX_TOKEN_RE, (token) => `[hex-${token.length}]`);
  return withHexMask.replace(LONG_BASE64_TOKEN_RE, (token) => {
    const hasAlpha = /[A-Za-z]/.test(token);
    const hasDigit = /\d/.test(token);
    return hasAlpha && hasDigit ? `[cipher-${token.length}]` : token;
  });
}

function sanitizeTerminalDisplayText(input: string): string {
  return sanitizeCipherLikeText(sanitizeTerminalLineForDisplay(stripRdkShellProtocolNoise(input)));
}

/** device_exec / exec 等：用参数摘要作终端块标题，便于多段输出与命令对应 */
function toolShellCmdHintForLabel(argDetail: string | undefined): string {
  const d = String(argDetail || '').trim();
  if (!d || d === '无参数') return '';
  return d.length > 96 ? `${d.slice(0, 93)}…` : d;
}

/** device_exec 长任务时服务端注入的静默心跳行，不应参与「与最终结果是否重复」的比较 */
function isDeviceExecHeartbeatLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('·')) return false;
  return /命令仍在运行|暂无新输出|still running|no new output/i.test(t);
}

/** 与 tool_progress 中逐行处理一致，且与「仅对全文做 reasoning 净化」解耦，便于流式/最终去重对齐 */
function normalizeToolTerminalLinesFromRaw(raw: string): string[] {
  return String(raw || '')
    .split(/\r?\n/)
    .map((ln) => sanitizeTerminalDisplayText(ln.trim()))
    .filter(Boolean);
}

/** 持久 shell 等偶发「整段输出连续重复两遍」时折叠为一段 */
function collapseTerminalLinesIfDuplicateHalf(lines: string[]): string[] {
  if (lines.length < 2 || lines.length % 2 !== 0) return lines;
  const half = lines.length / 2;
  const a = lines.slice(0, half);
  const b = lines.slice(half);
  if (a.every((line, i) => line === b[i])) return a;
  return lines;
}

/** 合并流式 chunk：跳过与已有尾部完全相同的整段（避免结束再刷一遍全文导致重复） */
function mergeTerminalProgressLines(existing: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;
  if (incoming.length === existing.length && incoming.every((l, i) => l === existing[i])) {
    return existing;
  }
  const inJoin = incoming.join('\n');
  const exJoin = existing.join('\n');
  if (inJoin === exJoin) return existing;
  if (existing.length >= incoming.length) {
    const tail = existing.slice(-incoming.length);
    if (tail.every((l, i) => l === incoming[i])) return existing;
  }
  return [...existing, ...incoming];
}

/**
 * 流式块已包含「最终结果」将展示的内容时，不再追加第二块（与 tool_progress 行规范化一致）。
 */
function streamCoversFinalTerminalBlock(streamedLines: string[], rawResult: string): boolean {
  const finalLines = collapseTerminalLinesIfDuplicateHalf(
    normalizeToolTerminalLinesFromRaw(rawResult).slice(0, 60),
  );
  const n = finalLines.length;
  if (n === 0) return false;
  const streamedFiltered = collapseTerminalLinesIfDuplicateHalf(
    streamedLines.filter((l) => !isDeviceExecHeartbeatLine(l)),
  );
  if (streamedFiltered.length < n) return false;
  for (let i = 0; i < n; i++) {
    if (streamedFiltered[i] !== finalLines[i]) return false;
  }
  return true;
}

function sanitizeReasoningDisplayText(input: string): string {
  return sanitizeCipherLikeText(stripRdkShellProtocolNoise(input));
}

function stripInternalDraftMonologue(input: string): string {
  const text = String(input || '');
  if (!text) return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const suspiciousCount = lines.reduce((n, line) => {
    const trimmed = line.trim();
    if (!trimmed) return n;
    return INTERNAL_DRAFT_TOOL_RE.test(trimmed) && INTERNAL_DRAFT_TONE_RE.test(trimmed) ? n + 1 : n;
  }, 0);
  if (suspiciousCount < 3) return text;
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return !(INTERNAL_DRAFT_TOOL_RE.test(trimmed) && INTERNAL_DRAFT_TONE_RE.test(trimmed));
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 模型既流式 thinking_delta（reasoning 块）又把同一段写进 message_delta（主文）时，去掉主文重复部分。
 * 与 message_end 中空主文分支配合：非空时仍可能全文或前缀与 reasoning 一致。
 * 正文与 reasoning 均经 sanitizeReasoningDisplayText，并处理「整段思考被夹在中间」的重复。
 */
function stripVisibleAssistantDuplicateOfReasoning(visible: string, reasoningChunksSorted: string[]): string {
  if (!reasoningChunksSorted.length) return visible;
  let vNorm = sanitizeReasoningDisplayText(visible.replace(/\r\n/g, '\n')).replace(/\r\n/g, '\n').trim();
  if (!vNorm) return visible;
  for (const r of reasoningChunksSorted) {
    const rNorm = sanitizeReasoningDisplayText(r.replace(/\r\n/g, '\n')).trim();
    if (!rNorm) continue;
    if (vNorm === rNorm) {
      vNorm = '';
      break;
    }
    if (vNorm.startsWith(rNorm)) {
      vNorm = vNorm.slice(rNorm.length).trimStart();
      continue;
    }
    if (rNorm.startsWith(vNorm)) {
      vNorm = '';
      break;
    }
    /** 模型把与思考块完全相同的段落又写进主文中间时，indexOf 去掉首段匹配（长片段优先已排序） */
    if (rNorm.length >= 32) {
      const idx = vNorm.indexOf(rNorm);
      if (idx >= 0) {
        const before = vNorm.slice(0, idx).trimEnd();
        const after = vNorm.slice(idx + rNorm.length).trimStart();
        vNorm = [before, after].filter(Boolean).join('\n\n').trim();
      }
    }
  }
  return vNorm;
}

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
  const {
    activeTab,
    setShowSettings,
    language,
    setActiveTab,
    ideEmbedToolbar,
    vncEmbedToolbar,
  } = useUIStore();
  const ideToolbarRef = React.useRef(ideEmbedToolbar);
  const vncToolbarRef = React.useRef(vncEmbedToolbar);
  ideToolbarRef.current = ideEmbedToolbar;
  vncToolbarRef.current = vncEmbedToolbar;

  const isEn = language === 'en';
  const t = (key: string, zh: string) => translate(isEn, key, zh);
  const tf = (key: string, zh: string, vars: Record<string, string | number>) =>
    fillTemplate(t(key, zh), vars);

  React.useEffect(() => {
    const loc = language === 'en';
    const tr = (key: string, zh: string) => translate(loc, key, zh);
    registerStudioClientActionHandlers({
      navigateTab: (tab) => {
        setActiveTab(tab);
      },
      setEmbedFloat: (target, enabled) => {
        const api = target === 'ide' ? ideToolbarRef.current : vncToolbarRef.current;
        if (!api?.showIframe) {
          addToast(
            tr(
              target === 'ide' ? 'studio.embed.clientAction.needIde' : 'studio.embed.clientAction.needVnc',
              target === 'ide'
                ? '请先在代码编辑器中连接 code-server（编辑器同类型仅 1 个，可与远程桌面同时各 1 个）'
                : '请先在远程桌面中连接（远程桌面同类型仅 1 个，可与代码编辑器同时各 1 个）',
            ),
            'info',
          );
          return;
        }
        if (enabled === api.embedFloating) {
          addToast(
            tr(
              'studio.embed.singleSessionOnly',
              '当前已是该状态；同类嵌入仅 1 个，IDE 与远程桌面可同时各 1 个',
            ),
            'info',
          );
          return;
        }
        api.toggleEmbedFloat();
      },
    });
  }, [setActiveTab, addToast, language]);
  const initialChatDeviceId = toChatDeviceId(currentDevice?.id);
  const initialStudioSessionId =
    typeof window !== 'undefined' ? getOrCreateStudioChatSessionId(initialChatDeviceId) : `ui-${Date.now()}`;
  const chatDeviceIdRef = useRef(initialChatDeviceId);
  const sessionIdRef = useRef(initialStudioSessionId);
  const chatPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const cmdRef = useRef('');
  cmdRef.current = cmd;

  /** 将当前 ref 指向的线程写入 localStorage（含全局设备的 legacy 键）；切换会话/设备前必须调用 */
  const flushChatPersistToStorage = useCallback(() => {
    try {
      const toSave = stripHeavyDataUrlsForStorage(chatMessagesRef.current.slice(-50));
      localStorage.setItem(
        chatHistoryStorageKey(chatDeviceIdRef.current, sessionIdRef.current),
        JSON.stringify(toSave),
      );
      localStorage.setItem(chatDraftStorageKey(chatDeviceIdRef.current), cmdRef.current);
      if (toChatDeviceId(chatDeviceIdRef.current) === GLOBAL_CHAT_DEVICE_ID) {
        localStorage.setItem(CHAT_HISTORY_LEGACY_KEY, JSON.stringify(toSave));
      }
    } catch {
      /* quota exceeded */
    }
  }, []);

  /** 新消息入列时立即落盘，避免仅依赖 300ms 防抖时用户立刻点「新对话」导致上一会话未写入 */
  const prevChatMsgLenRef = useRef(-1);
  useEffect(() => {
    const n = chatMessages.length;
    if (n > prevChatMsgLenRef.current && prevChatMsgLenRef.current >= 0) {
      flushChatPersistToStorage();
    }
    prevChatMsgLenRef.current = n;
  }, [chatMessages.length, flushChatPersistToStorage]);

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
    if (chatPersistTimerRef.current) {
      clearTimeout(chatPersistTimerRef.current);
      chatPersistTimerRef.current = null;
    }
    /**
     * 先同步落盘当前线程，再换新 session。
     * 切勿 remove 旧会话分片：旧逻辑会删掉 rdk-chat-history:…:旧 sid，历史列表里对应日期会整段消失；
     * 若此时防抖尚未写入，连存档都没有。
     */
    flushChatPersistToStorage();
    try {
      const deviceId = chatDeviceIdRef.current;
      localStorage.removeItem(chatDraftStorageKey(deviceId));
      const nextSid = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      sessionIdRef.current = nextSid;
      persistStudioChatSessionId(deviceId, nextSid);
      void setActiveRdkclawSession(nextSid);
    } catch {
      // ignore
    }
    setChatMessages([]);
    setRdkClawRunTimeline([]);
    addToast(
      t(
        'chat.store.historyCleared',
        '已开启新对话；上一会话已保存到本地，可在「会话」列表中查看。',
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
    /** 板端长链路兜底提示：最近一次「已告知用户」时间 */
    watchdogLastNoticeAt?: number;
    /** 板端长链路兜底提示：最近一次主动探测 OpenClaw 健康时间 */
    watchdogLastProbeAt?: number;
    watchdogProbePending?: boolean;
    watchdogProbeCount?: number;
    watchdogWaitLine?: string;
    watchdogHealthLine?: string;
    boardStageStatusIndex?: number;
    boardActiveTool?: string;
    boardDoneCount?: number;
    boardLastEventAt?: number;
    boardLastEventText?: string;
    boardTaskSummary?: string;
    boardCollabLastPaintAt?: number;
  }>>({});
  const latestBoardToolRef = useRef<string | null>(null);
  /** 任意工具最近一次 tool_start 的 toolCallId；device_exec 等本地工具进度不能回退到 latestBoardToolRef */
  const latestAnyToolCallIdRef = useRef<string | null>(null);
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
  /** 微信会话过期等：短时窗口内合并重复推送（多路 socket / 重连），不阻塞日后再次过期提示 */
  const channelErrorMirrorAtRef = useRef<Map<string, number>>(new Map());
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
      setChatMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === regen.removeAiMessageId);
        if (idx >= 0) return prev.slice(0, idx);
        return prev.filter((m) => m.id !== regen.removeAiMessageId);
      });
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
    dispatchOpenEmbedIntentFromUserMessage(requestMessage);
    void tryOpenProductDocFromUserMessage(requestMessage).then((opened) => {
      if (opened) addToast(t('chat.productDoc.opened', '已打开文档页面'), 'info');
    });
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
      let stopOpenClawWatchdog: (() => void) | null = null;
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
        const contentSlots: AiDockContentSlot[] = [];
        let currentRunId = '';
        currentRunIdRef.current = '';
        toolTimelineRef.current = {};
        latestBoardToolRef.current = null;
        latestAnyToolCallIdRef.current = null;
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
          const slots = [...contentSlots];
          setChatMessages(prev => prev.map(m =>
            m.id === aiMsgId ? { ...m, text: t, blocks: b, contentSlots: slots } : m
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

        function reconcileSlotsAfterBlockRemoved(removedIdx: number) {
          const next = contentSlots
            .map((s) => {
              if (s.kind !== 'block') return s;
              if (s.index === removedIdx) return null;
              if (s.index > removedIdx) return { ...s, index: s.index - 1 };
              return s;
            })
            .filter((x): x is AiDockContentSlot => x != null);
          contentSlots.length = 0;
          contentSlots.push(...next);
        }

        function pushAiBlock(block: ChatBlock) {
          aiBlocks.push(block);
          contentSlots.push({ kind: 'block', index: aiBlocks.length - 1 });
        }

        function appendMarkdownDelta(delta: string) {
          if (!delta) return;
          aiText += delta;
          const last = contentSlots[contentSlots.length - 1];
          if (last?.kind === 'markdown') last.text += delta;
          else contentSlots.push({ kind: 'markdown', text: delta });
        }

        function appendMarkdownParagraph(p: string) {
          const trimmed = p.trim();
          if (!trimmed) return;
          const last = contentSlots[contentSlots.length - 1];
          if (last?.kind === 'markdown') {
            last.text = last.text.trim() ? `${last.text.trim()}\n\n${trimmed}` : trimmed;
          } else {
            contentSlots.push({ kind: 'markdown', text: trimmed });
          }
          aiText = aiText.trim() ? `${aiText.trim()}\n\n${trimmed}` : trimmed;
        }

        function stripMarkdownSlotsKeepBlocks() {
          const blocksOnly = contentSlots.filter((s): s is Extract<AiDockContentSlot, { kind: 'block' }> => s.kind === 'block');
          contentSlots.length = 0;
          contentSlots.push(...blocksOnly);
        }

        function rebuildContentSlotsFromBlocksAndText(blocks: ChatBlock[], tailMarkdown: string) {
          contentSlots.length = 0;
          for (let i = 0; i < blocks.length; i++) {
            contentSlots.push({ kind: 'block', index: i });
          }
          if (tailMarkdown.trim()) {
            contentSlots.push({ kind: 'markdown', text: tailMarkdown });
          }
        }

        function applyClientActionsAcrossMarkdownSlots() {
          if (contentSlots.some((s) => s.kind === 'markdown')) {
            for (const s of contentSlots) {
              if (s.kind === 'markdown') {
                s.text = applyClientActionsFromAssistantText(s.text);
              }
            }
            aiText = contentSlots
              .filter((s): s is Extract<AiDockContentSlot, { kind: 'markdown' }> => s.kind === 'markdown')
              .map((s) => s.text)
              .join('');
          } else if (/<client-action\b/i.test(aiText)) {
            aiText = applyClientActionsFromAssistantText(aiText);
          }
        }

        const OPENCLAW_IDLE_NOTICE_MS = 45_000;
        const OPENCLAW_HEALTH_PROBE_MS = 90_000;
        const OPENCLAW_WATCHDOG_TICK_MS = 5_000;
        const openclawActiveToolIds = new Set<string>();
        let openclawWatchdogTimer: number | null = null;

        const openclawCollabSubtitle =
          currentDevice?.ip
            ? tf('dock.collab.openclawSubtitleWithIp', '与 RDKClaw 协作 · 当前设备 {{ip}}（与 SSH 一致）', {
                ip: currentDevice.ip,
              })
            : t('dock.collab.openclawSubtitle', '与 RDKClaw 协作中的回复');

        const toBoardPhaseLabel = (phase: string) => {
          if (phase === 'start') return t('chat.board.phase.start', '开始执行');
          if (phase === 'update') return t('chat.board.phase.update', '执行中');
          if (phase === 'result') return t('chat.board.phase.result', '已完成');
          if (phase === 'error') return t('chat.board.phase.error', '执行失败');
          return t('chat.board.phase.unknown', '处理中');
        };

        const toBoardToolLabel = (tool: string) => {
          const name = String(tool || '').trim().toLowerCase();
          if (name === 'exec') return t('chat.board.tool.exec', '执行脚本');
          if (name === 'edit') return t('chat.board.tool.edit', '修改文件');
          if (name === 'read') return t('chat.board.tool.read', '读取文件');
          if (name === 'search') return t('chat.board.tool.search', '检索信息');
          if (name === 'process') return t('chat.board.tool.process', '处理数据');
          if (name === 'analyze') return t('chat.board.tool.analyze', '分析结果');
          return tool;
        };

        const summarizeBoardTask = (toolName: string, args: Record<string, unknown>) => {
          const pick =
            toolName === 'board_openclaw_chat'
              ? String(args.message ?? '').trim()
              : String(args.task ?? args.context ?? args.message ?? '').trim();
          if (!pick) return '';
          const firstLine = pick.split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
          return firstLine.length > 72 ? `${firstLine.slice(0, 70)}...` : firstLine;
        };

        const parseBoardToolEvents = (raw: string) => {
          const events: Array<{ phase: 'start' | 'update' | 'result' | 'error'; tool: string }> = [];
          for (const line of raw.split(/\r?\n/)) {
            const m = line.trim().match(/^\[TOOL:(start|update|result|error)\]\s*([^\s]+)/i);
            if (!m) continue;
            events.push({
              phase: m[1].toLowerCase() as 'start' | 'update' | 'result' | 'error',
              tool: m[2],
            });
          }
          return events;
        };

        /** 无 [TOOL:…] 时仍可能含「[板端…]」契约行，用于更新看板「最近更新」；优先展示「结果」再「过程/进行」 */
        const extractBoardVisibilityLine = (raw: string): string | null => {
          const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          const pick = (re: RegExp) => {
            for (let i = lines.length - 1; i >= 0; i--) {
              const ln = lines[i];
              if (re.test(ln)) return ln.length > 220 ? `${ln.slice(0, 218)}…` : ln;
            }
            return null;
          };
          return (
            pick(/^\[板端·结果\]/i)
            || pick(/^\[板端·过程\]/i)
            || pick(/^\[板端·进行\]/i)
            || pick(/^\[板端\]/i)
            || pick(/^\[预检\]/i)
            || pick(/^\[板端 OpenClaw 正在推理/i)
          );
        };

        const humanizeBoardToolLine = (line: string) => {
          const trimmed = line.trim();
          if (/^\[板端[·.]/i.test(trimmed) || /^\[板端\]/i.test(trimmed)) {
            return trimmed;
          }
          const m = trimmed.match(/^\[TOOL:(start|update|result|error)\]\s*([^\s]+)(?:\s*×(\d+))?$/i);
          if (m) {
            const phase = m[1].toLowerCase();
            const rawTool = m[2];
            const times = m[3] ? ` ×${m[3]}` : '';
            const toolLabel = toBoardToolLabel(rawTool);
            const phaseLabel = toBoardPhaseLabel(phase);
            return tf(
              'chat.board.toolLineTransparent',
              '[TOOL:{{phaseRaw}}] {{rawTool}}{{times}} · {{toolLabel}} · {{phase}}',
              {
                phaseRaw: phase,
                rawTool,
                times,
                toolLabel,
                phase: phaseLabel,
              },
            );
          }
          if (/^https?:\/\//i.test(trimmed)) {
            return tf('chat.board.lineUrl', '链接：{{url}}', { url: trimmed.slice(0, 220) });
          }
          if (trimmed.length > 140) {
            return tf('chat.board.lineOut', '输出摘录：{{snippet}}', { snippet: trimmed.slice(0, 220) });
          }
          return line;
        };

        const upsertBoardStageStatus = (state: {
          boardStageStatusIndex?: number;
          boardActiveTool?: string;
          boardDoneCount?: number;
          boardLastEventAt?: number;
          boardLastEventText?: string;
          boardTaskSummary?: string;
        }) => {
          const now = Date.now();
          const activeTool = state.boardActiveTool || t('chat.board.active.none', '等待板端返回步骤');
          const done = state.boardDoneCount ?? 0;
          const lastAt = state.boardLastEventAt ?? now;
          const sec = Math.max(0, Math.floor((now - lastAt) / 1000));
          const recent = state.boardLastEventText || t('chat.board.recent.none', '尚未收到板端步骤事件');
          const taskSummary = state.boardTaskSummary || t('chat.board.task.none', '按上文目标执行');
          const block = {
            type: 'status' as const,
            collapsible: true,
            defaultCollapsed: false,
            summary: t('chat.board.summary', '板端执行看板'),
            items: [
              { label: t('chat.board.task', '目标任务'), value: taskSummary, ok: true },
              { label: t('chat.board.active', '当前步骤'), value: activeTool, ok: true },
              { label: t('chat.board.done', '已完成步骤'), value: String(done), ok: true },
              { label: t('chat.board.recent', '最近更新'), value: `${sec}s · ${recent}`, ok: true },
            ],
          };
          if (typeof state.boardStageStatusIndex === 'number') {
            const existing = aiBlocks[state.boardStageStatusIndex];
            if (existing?.type === 'status') {
              aiBlocks[state.boardStageStatusIndex] = block;
              return;
            }
          }
          state.boardStageStatusIndex = aiBlocks.length;
          pushAiBlock(block);
        };

        const upsertOpenClawWatchdogHint = (
          state: {
            waitHintCollabIndex?: number;
            startedAt: number;
            watchdogWaitLine?: string;
            watchdogHealthLine?: string;
          },
          patch: {
            waitLine?: string;
            healthLine?: string;
          },
        ) => {
          if (typeof patch.waitLine === 'string') state.watchdogWaitLine = patch.waitLine.trim();
          if (typeof patch.healthLine === 'string') state.watchdogHealthLine = patch.healthLine.trim();
          const lines = [state.watchdogWaitLine, state.watchdogHealthLine]
            .filter((line): line is string => Boolean(line && line.trim()))
            .map((line) => line.trim());
          if (lines.length === 0) return;
          if (typeof state.waitHintCollabIndex === 'number') {
            const wb = aiBlocks[state.waitHintCollabIndex];
            if (wb?.type === 'collab' && wb.side === 'rdkclaw' && wb.collabRole === 'wait_hint') {
              wb.lines = lines;
            }
          } else {
            state.waitHintCollabIndex = aiBlocks.length;
            pushAiBlock({
              type: 'collab',
              side: 'rdkclaw',
              collabRole: 'wait_hint',
              title: t('dock.collab.waitHintTitle', '稍等片刻'),
              subtitle: t('chat.openclaw.watchdog.subtitle', 'RDKClaw 正在主动跟进板端 OpenClaw 的执行进度'),
              lines,
              collapsible: true,
              previewLines: 6,
            });
          }
          updateAiMessage(aiText, aiBlocks);
        };

        stopOpenClawWatchdog = () => {
          if (openclawWatchdogTimer != null) {
            window.clearInterval(openclawWatchdogTimer);
            openclawWatchdogTimer = null;
          }
          openclawActiveToolIds.clear();
        };

        const ensureOpenClawWatchdog = () => {
          if (openclawWatchdogTimer != null) return;
          openclawWatchdogTimer = window.setInterval(() => {
            if (generation !== streamGenerationRef.current) {
              stopOpenClawWatchdog?.();
              return;
            }
            const now = Date.now();
            for (const toolId of [...openclawActiveToolIds]) {
              const st = toolTimelineRef.current[toolId];
              if (!st || st.executor !== 'board_openclaw') {
                openclawActiveToolIds.delete(toolId);
                continue;
              }

              const lastNotice = st.watchdogLastNoticeAt ?? st.startedAt;
              if (now - lastNotice >= OPENCLAW_IDLE_NOTICE_MS) {
                const waitedSec = Math.max(1, Math.floor((now - st.startedAt) / 1000));
                upsertOpenClawWatchdogHint(
                  st,
                  {
                    waitLine: tf('chat.openclaw.watchdog.waiting', '已等待 {{sec}} 秒，RDKClaw 正在追问 OpenClaw 当前进展...', {
                      sec: waitedSec,
                    }),
                  },
                );
                st.watchdogLastNoticeAt = now;
              }

              const deviceId = String(currentDevice?.id || '').trim();
              const lastProbe = st.watchdogLastProbeAt ?? 0;
              if (!deviceId || st.watchdogProbePending || (st.watchdogProbeCount ?? 0) >= 1 || now - lastProbe < OPENCLAW_HEALTH_PROBE_MS) continue;

              st.watchdogLastProbeAt = now;
              st.watchdogProbePending = true;
              void fetchDeviceOpenClawHealth(deviceId)
                .then((res) => {
                  if (generation !== streamGenerationRef.current) return;
                  const statusSummary = String(res.status?.summary || '').trim();
                  if (!statusSummary) return;
                  const liveState = res.status.gatewayRunning
                    ? t('chat.openclaw.watchdog.gatewayUp', '网关在线')
                    : t('chat.openclaw.watchdog.gatewayDown', '网关离线');
                  upsertOpenClawWatchdogHint(
                    st,
                    {
                      healthLine: tf('chat.openclaw.watchdog.health', '主动查询结果：{{state}} · {{summary}}', {
                        state: liveState,
                        summary: statusSummary,
                      }),
                    },
                  );
                })
                .catch(() => {
                  if (generation !== streamGenerationRef.current) return;
                  upsertOpenClawWatchdogHint(
                    st,
                    {
                      healthLine: t('chat.openclaw.watchdog.healthFail', '主动查询 OpenClaw 状态失败，将继续等待板端回传。'),
                    },
                  );
                })
                .finally(() => {
                  const next = toolTimelineRef.current[toolId];
                  if (next) {
                    next.watchdogProbePending = false;
                    next.watchdogProbeCount = (next.watchdogProbeCount ?? 0) + 1;
                  }
                });
            }
            if (openclawActiveToolIds.size === 0) {
              stopOpenClawWatchdog?.();
            }
          }, OPENCLAW_WATCHDOG_TICK_MS);
        };

        let toolStepNo = 0;

        const { done, abort } = streamAgentChat(
          requestMessage,
          currentDevice?.id,
          sessionIdRef.current,
          userIdRef.current,
          {
            attachments: requestAttachments,
            studioResponseMode,
            ...(regen ? { studioRegenerate: true } : {}),
          },
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
                    pushAiBlock({
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
                const executor = String(event.data.executor || 'rdkclaw_local');
                const phase = String(event.data.phase || 'start');
                const message = String(event.data.message || t('chat.stream.start', '开始处理请求'));

                if (phase === 'setup') {
                  pushAiBlock({
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
                  /** 短文案不再用可折叠卡，避免标题与「运行说明」正文完全重复 */
                  const shortRuntimeNote = message.length <= 200;
                  const runBlock = shortRuntimeNote
                    ? {
                        type: 'status' as const,
                        _rdkMetaRunning: true as const,
                        collapsible: false,
                        items: [{ label: t('chat.stream.runtimeNote', '运行说明'), value: message, ok: true }],
                      }
                    : {
                        type: 'status' as const,
                        _rdkMetaRunning: true as const,
                        collapsible: true,
                        defaultCollapsed: false,
                        summary: message.slice(0, 120),
                        items: [{ label: t('chat.stream.runtimeNote', '运行说明'), value: message, ok: true }],
                      };
                  if (runIdx >= 0) aiBlocks[runIdx] = runBlock;
                  else pushAiBlock(runBlock);
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
                  pushAiBlock({
                    type: 'status',
                    collapsible: true,
                    defaultCollapsed: false,
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

                /** phase=end 且无 run_metrics/subagent：旧版或占位 meta，勿再叠一张与「执行路径」雷同的状态卡 */
                if (phase === 'end') {
                  break;
                }

                /** 完整「编排上下文」卡仅对应 server 单次 phase=start（含委派/技能/模型能力），避免其它 meta 缺字段时用「默认」填空造成视觉重复 */
                if (phase !== 'start') {
                  pushAiBlock({
                    type: 'status',
                    collapsible: true,
                    defaultCollapsed: false,
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

                const skillsShort = formatMatchedSkillsShort(matchedSkills);
                const summaryParts = [executorLabel(executor), delegationMode];
                if (skillsShort) {
                  summaryParts.push(tf('chat.stream.skillsVal', '技能: {{list}}', { list: skillsShort }));
                }
                if (networkEnabled) summaryParts.push(t('chat.stream.network', '联网'));
                if (needsBoardCollaboration) summaryParts.push(t('chat.stream.board', '板端协同'));
                const summaryLine = capMetaSummaryLine(summaryParts, 100);

                /** 详情区：去掉与摘要重复的「执行路径」行；模型只展示名称（上下文/输出属排障信息，默认收起） */
                const metaItems: Array<{ label: string; value: string; ok: boolean }> = [
                  {
                    label: t('chat.stream.hit', '命中能力'),
                    value:
                      matchedSkills.length > 0
                        ? formatMatchedSkillsShort(matchedSkills, 4, 40)
                        : t('chat.stream.generic', '通用流程'),
                    ok: matchedSkills.length > 0,
                  },
                ];
                if (modelCaps?.model) {
                  const tierLabel =
                    modelCaps.tier === 'small' ? t('chat.stream.tierSmall', ' (精简模式)') : '';
                  metaItems.push({
                    label: t('chat.stream.model', '模型'),
                    value: `${modelCaps.model}${tierLabel}`,
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
                    summary: summaryLine,
                    items: metaItems,
                  };
                } else {
                  pushAiBlock({
                    type: 'status',
                    collapsible: true,
                    defaultCollapsed: true,
                    summary: summaryLine,
                    items: metaItems,
                  });
                }
                appendRunTimelineEntry(generation, {
                  kind: 'context',
                  title: t('chat.timeline.context', '运行上下文'),
                  detail: summaryLine,
                });
                updateAiMessage(aiText, aiBlocks, true);
                break;
              }
              case 'text': {
                appendMarkdownDelta((event.data.delta as string) || '');
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'thinking_delta': {
                const delta = String(event.data.delta ?? '');
                if (!delta) break;
                const idx = reasoningBlockIndexRef.current;
                const existing =
                  idx != null && idx < aiBlocks.length && aiBlocks[idx]?.type === 'reasoning'
                    ? (aiBlocks[idx] as Extract<ChatBlock, { type: 'reasoning' }>)
                    : null;
                if (existing) {
                  existing.text = sanitizeReasoningDisplayText(`${existing.text}${delta}`);
                } else {
                  reasoningBlockIndexRef.current = aiBlocks.length;
                  pushAiBlock({
                    type: 'reasoning',
                    text: sanitizeReasoningDisplayText(delta),
                    collapsible: true,
                    /**
                     * 与「工具调用」顺行交错：上一段在 tool_start 时已封口，本段在工具之后继续流式。
                     * 分段后单段较短，默认展开便于自上而下阅读。
                     */
                    defaultCollapsed: false,
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
                /** 结束当前思考块引用，使后续 thinking_delta 落在本工具卡片之后，形成「思考→工具→思考」顺行 */
                reasoningBlockIndexRef.current = null;
                toolStepNo += 1;
                const toolName = resolveToolName(event.data);
                const args = event.data.args as Record<string, unknown>;
                const executor = String(
                  event.data.executor || (isBoardOpenClawExecutorTool(toolName) ? 'board_openclaw' : 'rdkclaw_local'),
                );
                if (isBoardOpenClawCollabTool(toolName)) {
                  boardToolTimelineSigRef.current = '';
                }
                const phase = resolvePhase(event.data.phase);
                const argStr = summarizeToolArgs(args);
                const cardTitle = formatToolStatusTitle(toolName, args);
                /** 整文件写入等场景参数极长，用可折叠卡片默认收起，避免占满对话区 */
                const contentArg = args?.content;
                const hasLargeContentArg =
                  typeof contentArg === 'string' && contentArg.length > 200;
                const toolArgsHeavy =
                  argStr.length > 420 || argStr.split(/\n/).length > 6 || hasLargeContentArg;
                const statusIndex = aiBlocks.length;
                pushAiBlock({
                  type: 'status',
                  title: cardTitle,
                  ...(toolArgsHeavy
                    ? {
                        collapsible: true,
                        defaultCollapsed: true,
                        summary: cardTitle,
                      }
                    : {}),
                  items: [
                    {
                      label: executorLabel(executor),
                      value: `${phase} · ${argStr}`,
                      ok: true,
                    },
                  ],
                });
                const toolCallId = resolveToolId(event.data) || `${toolName}-${Date.now()}`;
                latestAnyToolCallIdRef.current = toolCallId;
                toolTimelineRef.current[toolCallId] = {
                  toolName,
                  executor,
                  startedAt: Date.now(),
                  statusIndex,
                  argDetail: argStr,
                  cardTitle,
                  ...(isBoardOpenClawCollabTool(toolName) ? { openclawStreamBuf: '' } : {}),
                };
                if (executor === 'board_openclaw') {
                  const st = toolTimelineRef.current[toolCallId];
                  st.watchdogLastNoticeAt = st.startedAt;
                  st.watchdogLastProbeAt = 0;
                  st.watchdogProbePending = false;
                  st.watchdogProbeCount = 0;
                  st.boardTaskSummary = summarizeBoardTask(toolName, args);
                  st.boardDoneCount = 0;
                  st.boardLastEventAt = st.startedAt;
                  st.boardLastEventText = t('chat.board.recent.waiting', '已发起任务，等待板端步骤事件');
                  st.boardCollabLastPaintAt = 0;
                  openclawActiveToolIds.add(toolCallId);
                  ensureOpenClawWatchdog();
                  upsertBoardStageStatus(st);
                }
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
                            : t(
                                'dock.collab.outboundDelegateSubtitle',
                                '协作上下文包（目标/约束/证据/验收；先对齐再执行，必要时回切本地快路径）',
                              );
                  pushAiBlock({
                    type: 'collab',
                    side: 'rdkclaw',
                    collabRole: 'outbound',
                    title: t('dock.collab.outboundTitle', '与板端 OpenClaw 协作上下文'),
                    subtitle: outboundSubtitle,
                    lines: linesOut,
                    collapsible: true,
                    previewLines: 12,
                  });
                }
                appendRunTimelineEntry(generation, {
                  kind: 'tool_start',
                  title: tf('chat.timeline.toolStart', '工具 · {{tool}}', { tool: toolName }),
                  detail: `${executorLabel(executor)} · ${phase} · ${argStr}`.slice(0, 500),
                });
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'tool_progress': {
                const toolName = resolveToolName(event.data);
                const rawChunk = String(event.data.chunk ?? '');
                if (!rawChunk) break;
                const progressSource = String((event.data as { progressSource?: string }).progressSource || 'board');
                const rawToolId = resolveToolId(event.data);
                const toolId =
                  rawToolId && toolTimelineRef.current[rawToolId]
                    ? rawToolId
                    : latestAnyToolCallIdRef.current || latestBoardToolRef.current || '';
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
                  state.watchdogLastNoticeAt = Date.now();
                  const boardEvents = parseBoardToolEvents(rawChunk);
                  if (boardEvents.length > 0) {
                    for (const evt of boardEvents) {
                      if (evt.phase === 'start' || evt.phase === 'update') {
                        state.boardActiveTool = toBoardToolLabel(evt.tool);
                      }
                      if (evt.phase === 'result' || evt.phase === 'error') {
                        state.boardDoneCount = (state.boardDoneCount ?? 0) + 1;
                      }
                      state.boardLastEventAt = Date.now();
                      state.boardLastEventText = tf('chat.board.recent.event', '{{tool}} · {{phase}}', {
                        tool: toBoardToolLabel(evt.tool),
                        phase: toBoardPhaseLabel(evt.phase),
                      });
                    }
                    upsertBoardStageStatus(state);
                  } else {
                    const vis = extractBoardVisibilityLine(rawChunk);
                    if (vis) {
                      state.boardLastEventAt = Date.now();
                      state.boardLastEventText = vis;
                      state.boardActiveTool = t('chat.board.active.streaming', '板端执行中');
                      upsertBoardStageStatus(state);
                    }
                  }
                  if (toolName === 'board_openclaw_chat' && progressSource === 'studio_wait') {
                    const more = rawChunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0);
                    if (typeof state.waitHintCollabIndex === 'number') {
                      const wb = aiBlocks[state.waitHintCollabIndex];
                      if (wb?.type === 'collab' && wb.side === 'rdkclaw' && wb.collabRole === 'wait_hint') {
                        wb.lines = [...wb.lines, ...more].slice(-24);
                      }
                    } else {
                      state.waitHintCollabIndex = aiBlocks.length;
                      pushAiBlock({
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
                      const now = Date.now();
                      const shouldRender =
                        /\[TOOL:(start|result|error)\]/i.test(rawChunk)
                        || /\[板端[·.]?/i.test(rawChunk)
                        || /\[预检\]/i.test(rawChunk)
                        || /\[板端 OpenClaw 正在推理/i.test(rawChunk)
                        || now - (state.boardCollabLastPaintAt ?? 0) > 1200;
                      if (shouldRender) {
                        const bufLines = collapseRepeatedBoardToolNotifyLines(state.openclawStreamBuf.split('\n'));
                        const readable = bufLines.map(humanizeBoardToolLine);
                        collabBlock.lines = readable.length > 240 ? readable.slice(-240) : readable;
                        state.boardCollabLastPaintAt = now;
                      }
                    }
                  } else {
                    state.collabIndex = aiBlocks.length;
                    state.openclawStreamBuf = rawChunk;
                    const bufLines = collapseRepeatedBoardToolNotifyLines(state.openclawStreamBuf.split('\n'));
                    const readable = bufLines.map(humanizeBoardToolLine);
                    const lines = readable.length > 240 ? readable.slice(-240) : readable;
                    pushAiBlock({
                      type: 'collab',
                      side: 'openclaw',
                      title: t('dock.collab.openclawTitle', '板端 OpenClaw'),
                      subtitle: openclawCollabSubtitle,
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
                        appendRunTimelineEntry(generation, {
                          kind: 'board_tool',
                          title: t('chat.timeline.boardTool', '板端工具'),
                          detail: sig,
                        });
                      }
                    }
                  }
                } else {
                  /** 勿对单包再 slice 行数：服务端可能一次下发多行，截断会导致时间顺序断裂、与「完成」状态错位 */
                  const progressLines = rawChunk
                    .split(/\r?\n/)
                    .map((line) => sanitizeTerminalDisplayText(line.trim()))
                    .filter(Boolean);
                  if (progressLines.length === 0) break;
                  if (typeof state.rawIndex === 'number') {
                    const rawBlock = aiBlocks[state.rawIndex];
                    if (rawBlock?.type === 'terminal') {
                      const merged = mergeTerminalProgressLines(rawBlock.lines, progressLines);
                      rawBlock.lines = collapseTerminalLinesIfDuplicateHalf(merged).slice(-240);
                    }
                  } else {
                    state.rawIndex = aiBlocks.length;
                    const cmdHint = toolShellCmdHintForLabel(state.argDetail);
                    pushAiBlock({
                      type: 'terminal',
                      label: cmdHint
                        ? tf('chat.tool.shellStreamingLabel', '{{tool}} · {{cmd}} · 运行中', {
                            tool: state.toolName,
                            cmd: cmdHint,
                          })
                        : tf('chat.tool.rawLabel', '{{tool}} · 原始中间输出', { tool: state.toolName }),
                      lines: collapseTerminalLinesIfDuplicateHalf(progressLines),
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
                const displayResult = sanitizeReasoningDisplayText(result);
                const isError = event.data.isError as boolean;
                const toolCallId = resolveToolId(event.data);
                const state = toolTimelineRef.current[toolCallId || ''];
                const elapsedMs = state ? Date.now() - state.startedAt : 0;
                if (state?.executor === 'board_openclaw' && toolCallId) {
                  openclawActiveToolIds.delete(toolCallId);
                  if (openclawActiveToolIds.size === 0) stopOpenClawWatchdog?.();
                }
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
                    if (isError && displayResult.trim()) {
                      const errOne = displayResult.trim().replace(/\s+/g, ' ').slice(0, 220);
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
                    if (parsed.__type === 'code_change') {
                      const scopeLabel =
                        parsed.scope === 'device'
                          ? t('chat.codeChange.device', '板端')
                          : t('chat.codeChange.workspace', '工作区');
                      const p = typeof parsed.path === 'string' ? parsed.path : '';
                      const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
                      pushAiBlock({
                        type: 'status',
                        title: tf('chat.codeChange.title', '{{scope}} · 代码变更', { scope: scopeLabel }),
                        summary: summary || p,
                        items: [
                          {
                            label: p || tf('chat.codeChange.path', '路径', {}),
                            value: summary || '—',
                            ok: !isError,
                          },
                        ],
                        collapsible: true,
                        defaultCollapsed: false,
                      });
                      const preview = typeof parsed.preview === 'string' ? parsed.preview : '';
                      if (preview.trim()) {
                        pushAiBlock({
                          type: 'code',
                          lang: 'diff',
                          content: preview,
                        });
                      }
                      mediaHandled = true;
                    } else if (parsed.__type === 'image_download') {
                      const fileName =
                        typeof parsed.fileName === 'string' && String(parsed.fileName).trim()
                          ? String(parsed.fileName).trim()
                          : '';
                      const fromUrl = typeof parsed.imageUrl === 'string' ? String(parsed.imageUrl).trim() : '';
                      const src =
                        fromUrl
                        || (fileName ? `/api/local-files/${encodeURIComponent(fileName)}` : '');
                      if (src) {
                        pushAiBlock({
                          type: 'image',
                          src,
                          caption: tf('chat.img.caption', '{{name}} ({{bytes}} bytes) — 来自设备', {
                            name: fileName || t('chat.media.image', '图片'),
                            bytes: String(parsed.bytes || 0),
                          }),
                        });
                        mediaHandled = true;
                      }
                    } else if (
                      parsed.__type === 'studio_local_preview' &&
                      typeof parsed.imageUrl === 'string' &&
                      parsed.ok === true
                    ) {
                      pushAiBlock({
                        type: 'image',
                        src: parsed.imageUrl as string,
                        caption: String(
                          parsed.fileName || t('chat.media.localPreview', '本地预览'),
                        ),
                      });
                      mediaHandled = true;
                    } else if (parsed.__type === 'video_download') {
                      const vName =
                        typeof parsed.fileName === 'string' && String(parsed.fileName).trim()
                          ? String(parsed.fileName).trim()
                          : '';
                      const fromV = typeof parsed.videoUrl === 'string' ? String(parsed.videoUrl).trim() : '';
                      const vSrc =
                        fromV
                        || (vName ? `/api/local-files/${encodeURIComponent(vName)}` : '');
                      if (vSrc) {
                        pushAiBlock({
                          type: 'video',
                          src: vSrc,
                          caption: tf('chat.video.caption', '{{name}} ({{mb}} MB) — 来自设备', {
                            name: vName || t('chat.media.video', '视频'),
                            mb: ((parsed.bytes as number) / 1024 / 1024).toFixed(1),
                          }),
                        });
                        mediaHandled = true;
                      }
                    } else if (parsed.localPath && typeof parsed.fileName === 'string') {
                      const ext = String(parsed.fileName).split('.').pop()?.toLowerCase() || '';
                      const imgExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']);
                      const vidExts = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v']);
                      const docExts = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'csv', 'txt', 'md', 'zip', 'rar', '7z']);
                      const fileUrl = `/api/local-files/${encodeURIComponent(parsed.fileName as string)}`;
                      if (imgExts.has(ext)) {
                        pushAiBlock({
                          type: 'image',
                          src: fileUrl,
                          caption: tf('chat.img.caption', '{{name}} ({{bytes}} bytes) — 来自设备', {
                            name: String(parsed.fileName),
                            bytes: String(parsed.bytes ?? 0),
                          }),
                        });
                        mediaHandled = true;
                      } else if (vidExts.has(ext)) {
                        pushAiBlock({
                          type: 'video',
                          src: fileUrl,
                          caption: tf('chat.video.caption', '{{name}} ({{mb}} MB) — 来自设备', {
                            name: String(parsed.fileName),
                            mb: ((Number(parsed.bytes) || 0) / 1024 / 1024).toFixed(1),
                          }),
                        });
                        mediaHandled = true;
                      } else if (docExts.has(ext)) {
                        pushAiBlock({
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
                      pushAiBlock({
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
                    pushAiBlock({
                      type: 'collab',
                      side: 'openclaw',
                      title: t('dock.collab.openclawTitle', '板端 OpenClaw'),
                      subtitle: openclawCollabSubtitle,
                      lines: cleaned.split('\n').slice(0, 80),
                      collapsible: true,
                      previewLines: 8,
                    });
                    pushReverseBlocks();
                  } else if (extracts.length > 0) {
                    pushReverseBlocks();
                  }
                  if (rdkHint) {
                    pushAiBlock({
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
                    const rSafe = sanitizeReasoningDisplayText(r);
                    if (rSafe) {
                      if (isError) {
                        const errLine = tf('chat.tool.errLine', '{{tool}} 失败：{{msg}}', { tool: toolName, msg: rSafe });
                        appendMarkdownParagraph(errLine);
                      } else {
                        appendMarkdownParagraph(rSafe);
                      }
                    }
                  } else if (displayResult.includes('\n') || displayResult.length > 100) {
                    const finalLines = collapseTerminalLinesIfDuplicateHalf(
                      normalizeToolTerminalLinesFromRaw(result).slice(0, 60),
                    );
                    const cmdHint = toolShellCmdHintForLabel(state?.argDetail);
                    const unifiedLabel = cmdHint
                      ? tf('chat.tool.shellOutputLabel', '{{tool}} · {{cmd}} · 输出', {
                          tool: toolName,
                          cmd: cmdHint,
                        })
                      : tf('chat.tool.finalLabel', '{{tool}} · 最终结果', { tool: toolName });
                    let skipDuplicateFinal = false;
                    if (state && typeof state.rawIndex === 'number') {
                      const rawBlock = aiBlocks[state.rawIndex];
                      if (rawBlock?.type === 'terminal' && streamCoversFinalTerminalBlock(rawBlock.lines, result)) {
                        rawBlock.label = unifiedLabel;
                        rawBlock.lines = finalLines;
                        skipDuplicateFinal = true;
                      }
                    }
                    if (!skipDuplicateFinal) {
                      pushAiBlock({
                        type: 'terminal',
                        lines: finalLines,
                        label: unifiedLabel,
                        collapsible: true,
                        previewLines: 10,
                      });
                    }
                  } else if (!state) {
                    const execFallback = String(
                      (event.data as { executor?: string }).executor || 'rdkclaw_local',
                    );
                    pushAiBlock({
                      type: 'status',
                      title: toolName,
                      items: [{
                        label: executorLabel(execFallback),
                        value: displayResult || (isError ? t('chat.tool.fail', '失败') : t('chat.tool.done', '完成')),
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
                  pushAiBlock({
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
                const reasoningChunksForDedupe = aiBlocks
                  .filter(
                    (b): b is Extract<ChatBlock, { type: 'reasoning' }> =>
                      b.type === 'reasoning' && Boolean((b as Extract<ChatBlock, { type: 'reasoning' }>).text?.trim()),
                  )
                  .map((b) => sanitizeReasoningDisplayText(b.text.replace(/\r\n/g, '\n')).trim())
                  .filter(Boolean)
                  .sort((a, b) => b.length - a.length);

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
                  stripMarkdownSlotsKeepBlocks();
                  if (reasoningWithText) {
                    // 用所有 reasoning chunks 做去重，避免单块比较遗漏
                    const deduped = reasoningChunksForDedupe.length
                      ? stripVisibleAssistantDuplicateOfReasoning(serverTrim, reasoningChunksForDedupe)
                      : serverTrim;
                    aiText = !serverTrim || !deduped ? '' : stripInternalDraftMonologue(deduped);
                  } else {
                    aiText = stripInternalDraftMonologue(serverFill);
                  }
                  if (aiText.trim()) {
                    contentSlots.push({ kind: 'markdown', text: aiText });
                  }
                } else if (reasoningChunksForDedupe.length) {
                  const next = stripVisibleAssistantDuplicateOfReasoning(aiText, reasoningChunksForDedupe);
                  if (next !== aiText) {
                    aiText = next;
                    rebuildContentSlotsFromBlocksAndText(aiBlocks, aiText);
                  }
                }
                if (/<client-action\b/i.test(aiText)) {
                  applyClientActionsAcrossMarkdownSlots();
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
                pushAiBlock({
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
                pushAiBlock({
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
                const userHint = String(event.data.userHint ?? '').trim();
                const pos = Number(event.data.position ?? 0);
                const current = String(event.data.currentTask ?? '');
                const channel = String(event.data.currentChannel ?? '');
                const channelLabel = channel === 'feishu'
                  ? t('chat.queue.feishu', '飞书')
                  : channel === 'weixin'
                    ? t('chat.queue.weixin', '微信')
                    : channel === 'studio'
                      ? t('chat.queue.studio', '工作台')
                      : channel === 'autonomy'
                        ? t('chat.queue.autonomy', '定时任务')
                        : channel || t('chat.queue.other', '其他渠道');
                const posLabel = pos > 0
                  ? tf('chat.queue.pos', '排在第 {{n}} 位', { n: pos })
                  : t('chat.queue.waiting', '正在排队');
                pushAiBlock({
                  type: 'status',
                  items: [
                    { label: t('chat.queue.state', '队列状态'), value: posLabel, ok: false },
                    ...(current ? [{ label: t('chat.queue.current', '当前任务'), value: `${channelLabel}: ${current}`, ok: true }] : []),
                  ],
                  summary: userHint || tf('chat.queue.busy', '设备正忙，{{pos}}，请稍候...', { pos: posLabel }),
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

                pushAiBlock({
                  type: 'status',
                  items: [{ label: t('chat.err.hint', '提示'), value: friendlyDetail, ok: false }],
                });
                rebuildContentSlotsFromBlocksAndText(aiBlocks, friendlyText);
                aiText = friendlyText;
                updateAiMessage(aiText, aiBlocks, true);
                break;
              }
              case 'done':
                /** 不在气泡内展示 Token/耗时等遥测卡，仅刷新正文与 client-action */
                if (/<client-action\b/i.test(aiText)) {
                  applyClientActionsAcrossMarkdownSlots();
                }
                updateAiMessage(aiText, aiBlocks, true);
                break;
              case 'run_progress': {
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
                  pushAiBlock(progressBlock);
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
                  reconcileSlotsAfterBlockRemoved(progressIdx);
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
                    : stopReason === 'max_turns_reached' || stopReason === 'tool_followup_cap_reached'
                      ? t('chat.runComplete.maxTurns', '✓ 已完成（已达轮次上限）')
                      : t('chat.runComplete.ok', '✓ 回复完成');
                appendRunTimelineEntry(generation, {
                  kind: 'complete',
                  title: label,
                  detail: detail.length > 0 ? detail.join(' · ') : undefined,
                });
                if (stopReason === 'max_turns_reached' || stopReason === 'tool_followup_cap_reached') {
                  pushAiBlock({
                    type: 'continue-run',
                    stopReason: stopReason as 'max_turns_reached' | 'tool_followup_cap_reached',
                    hint: stopHint || undefined,
                  });
                }
                if (/<client-action\b/i.test(aiText)) {
                  applyClientActionsAcrossMarkdownSlots();
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
        const blocksAfterStream = pendingBlocks.length > 0 ? pendingBlocks : aiBlocks;
        const reasoningChunksFinal = blocksAfterStream
          .filter(
            (b): b is Extract<ChatBlock, { type: 'reasoning' }> =>
              b.type === 'reasoning' && Boolean((b as Extract<ChatBlock, { type: 'reasoning' }>).text?.trim()),
          )
          .map((b) => sanitizeReasoningDisplayText(b.text.replace(/\r\n/g, '\n')).trim())
          .filter(Boolean)
          .sort((a, b) => b.length - a.length);
        let combinedAfterDedupe = pendingText || aiText;
        if (reasoningChunksFinal.length) {
          const stripped = stripVisibleAssistantDuplicateOfReasoning(combinedAfterDedupe, reasoningChunksFinal);
          if (stripped !== combinedAfterDedupe) {
            combinedAfterDedupe = stripped;
            aiText = stripped;
            pendingText = stripped;
            rebuildContentSlotsFromBlocksAndText(blocksAfterStream, stripped);
            updateAiMessage(aiText, blocksAfterStream, true);
          }
        }
        const cleanedMonologueText = stripInternalDraftMonologue(combinedAfterDedupe);
        if (cleanedMonologueText !== combinedAfterDedupe) {
          aiText = cleanedMonologueText;
          pendingText = cleanedMonologueText;
          rebuildContentSlotsFromBlocksAndText(blocksAfterStream, cleanedMonologueText);
          updateAiMessage(aiText, blocksAfterStream, true);
        }
        let bodyTrim = (pendingText || aiText).trim();
        if (/<client-action\b/i.test(bodyTrim)) {
          applyClientActionsAcrossMarkdownSlots();
          bodyTrim = aiText.trim();
        }
        if (!bodyTrim) {
          const fallback = t(
            'chat.err.emptyReply',
            '未收到可见回复。请重试一次；仍无输出时请检查模型与网络，或改用「快捷回答」。',
          );
          const b = [...pendingBlocks];
          const fallbackSlots: AiDockContentSlot[] = [];
          for (let i = 0; i < b.length; i++) {
            fallbackSlots.push({ kind: 'block', index: i });
          }
          fallbackSlots.push({ kind: 'markdown', text: fallback });
          setChatMessages((prev) => prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  text: fallback,
                  blocks: b,
                  contentSlots: fallbackSlots,
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
        stopOpenClawWatchdog?.();
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

  const watchSingleRunStop = (runId: string, markerMsgId: number) => {
    const maxAttempts = 10;
    const intervalMs = 1500;
    let attempts = 0;
    const tick = () => {
      getActiveRDKClawRuns()
        .then((res) => {
          if (!res?.ok) return;
          const stillRunning = res.runs.includes(runId);
          if (!stillRunning) {
            setChatMessages((prev) => prev.map((m) => (
              m.id === markerMsgId
                ? {
                    ...m,
                    blocks: [{
                      type: 'task-result',
                      success: true,
                      title: t('chat.stop.title', '已请求停止任务'),
                      detail: tf('chat.stop.confirmed', 'runId: {{id}}（已确认停止）', { id: runId }),
                    }],
                  }
                : m
            )));
            return;
          }
          attempts += 1;
          if (attempts >= maxAttempts) {
            setChatMessages((prev) => [...prev, {
              id: Date.now(),
              role: 'ai',
              text: '',
              blocks: [{
                type: 'status',
                items: [{
                  label: t('chat.stop.watchdog', '停止跟踪'),
                  value: tf('chat.stop.watchdogHint', '停止请求已发送，但 run 仍在执行（runId: {{id}}）。建议点「全部停止」或检查后端日志。', { id: runId }),
                  ok: false,
                }],
              }],
            }]);
            return;
          }
          window.setTimeout(tick, intervalMs);
        })
        .catch(() => {
          attempts += 1;
          if (attempts < maxAttempts) window.setTimeout(tick, intervalMs);
        });
    };
    window.setTimeout(tick, intervalMs);
  };

  const watchAllRunsStop = (markerMsgId: number) => {
    const maxAttempts = 10;
    const intervalMs = 1500;
    let attempts = 0;
    const tick = () => {
      getActiveRDKClawRuns()
        .then((res) => {
          if (!res?.ok) return;
          const runningCount = res.runs.length;
          if (runningCount === 0) {
            setChatMessages((prev) => prev.map((m) => (
              m.id === markerMsgId
                ? {
                    ...m,
                    blocks: [{
                      type: 'task-result',
                      success: true,
                      title: t('chat.stopAll.done', '已确认全部停止'),
                      detail: t('chat.stopAll.doneHint', '当前无运行中的任务。'),
                    }],
                  }
                : m
            )));
            return;
          }
          attempts += 1;
          if (attempts >= maxAttempts) {
            setChatMessages((prev) => [...prev, {
              id: Date.now(),
              role: 'ai',
              text: '',
              blocks: [{
                type: 'status',
                items: [{
                  label: t('chat.stopAll.watchdog', '停止跟踪'),
                  value: tf('chat.stopAll.watchdogHint', '仍有 {{n}} 个任务未停止，建议检查后端终端日志或再次执行「全部停止」。', { n: runningCount }),
                  ok: false,
                }],
              }],
            }]);
            return;
          }
          window.setTimeout(tick, intervalMs);
        })
        .catch(() => {
          attempts += 1;
          if (attempts < maxAttempts) window.setTimeout(tick, intervalMs);
        });
    };
    window.setTimeout(tick, intervalMs);
  };

  const stopCurrentRun = () => {
    const runId = currentRunIdRef.current;
    abortInFlightRun(false);
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
    currentRunIdRef.current = '';
    commandLockRef.current = false;
    setAiTyping(false);
    if (runId) {
      void cancelRDKClawRun(runId)
        .then((res) => {
          if (res.alreadyEnded) {
            setChatMessages((prev) => prev.map((m) => (
              m.id === stopSentTs
                ? {
                    ...m,
                    text: t(
                      'chat.stop.sentAlreadyEnded',
                      '该运行已结束（无活跃任务时「停止」为安全空操作）。可继续输入新指令。',
                    ),
                    blocks: [{
                      type: 'task-result',
                      success: true,
                      title: t('chat.stop.title', '已请求停止任务'),
                      detail: t(
                        'chat.stop.detailAlreadyEnded',
                        '后端无活跃 run（可能已跑完或已停止）。无需重试。',
                      ),
                    }],
                  }
                : m
            )));
          } else {
            watchSingleRunStop(runId, stopSentTs);
          }
        })
        .catch(() => {
          addToast(t('chat.stop.failRetry', '停止任务失败，请重试“全部停止”'), 'error');
        });
    } else {
      void cancelAllRDKClawRuns()
        .then(() => {
          watchAllRunsStop(stopSentTs);
        })
        .catch(() => {
          addToast(t('chat.stop.failRetry', '停止任务失败，请重试“全部停止”'), 'error');
        });
    }
  };

  const stopAllRuns = () => {
    abortInFlightRun(false);
    currentRunIdRef.current = '';
    commandLockRef.current = false;
    setAiTyping(false);
    const stopAllTs = Date.now();
    setChatMessages((prev) => [...prev, {
      id: stopAllTs,
      role: 'ai',
      text: '',
      blocks: [{
        type: 'task-result',
        success: true,
        title: t('chat.stopAll.submitting', '已提交停止请求'),
        detail: t('chat.stopAll.submittingHint', '正在通知后端取消任务，计数稍后更新…'),
      }],
      source: 'studio',
    }]);
    setBackgroundRuns((prev) => prev.map((item) => ({ ...item, status: 'ended' as const })));
    void cancelAllRDKClawRuns()
      .then((res) => {
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
        setChatMessages((prev) => prev.map((m) => (
          m.id === stopAllTs
            ? {
                ...m,
                blocks: [{
                  type: 'task-result',
                  success: true,
                  title: tf('chat.stopAll.title', '已停止所有运行中的任务（{{n}} 个）', { n: count }),
                  detail: detailParts.join(t('chat.stopAll.sep', '；')),
                }],
              }
            : m
        )));
        watchAllRunsStop(stopAllTs);
        addToast(tf('chat.stopAll.toast', '已停止 {{n}} 个运行中的任务', { n: count }), 'info');
      })
      .catch(() => {
        addToast(t('chat.stopAll.fail', '停止所有任务失败'), 'error');
      });
  };

  const backgroundCurrentRun = () => {
    const runId = currentRunIdRef.current;
    if (!runId) return;
    streamGenerationRef.current += 1;
    streamAbortRef.current?.();
    streamAbortRef.current = null;
    currentRunIdRef.current = '';
    commandLockRef.current = false;
    setAiTyping(false);
    setBackgroundRuns((prev) => [
      ...prev,
      { runId, status: 'running' as const, detachedAt: Date.now() },
    ]);
    const bgTs = Date.now();
    setChatMessages((prev) => [...prev, {
      id: bgTs,
      role: 'ai',
      text: t('chat.bg.moved', '任务已移至后台继续执行，你可以发新消息。'),
      blocks: [{
        type: 'status',
        items: [{
          label: t('chat.bg.label', '后台任务'),
          value: tf('chat.bg.runId', 'runId: {{id}}', { id: runId }),
          ok: true,
        }],
      }],
      source: 'studio',
    }]);
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

      /** 与 debounce flush 完全一致（含 cmdRef、全局 legacy），避免切换后「今日线程」未落盘而从列表消失 */
      flushChatPersistToStorage();

      persistStudioChatSessionId(nextDeviceId, sid);

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

      /** 全局会话不取消当前设备选中，与工作台/终端/文件共用「当前设备」 */
      if (nextDeviceId !== GLOBAL_CHAT_DEVICE_ID && toChatDeviceId(currentDevice?.id) !== nextDeviceId) {
        setActiveDevice(nextDeviceId);
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
      currentDevice?.id,
      flushChatPersistToStorage,
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
    let cancelled = false;
    reportActiveSession('init');
    reportActiveDevice('init');
    getActiveRDKClawRuns()
      .then((res) => {
        if (cancelled) return;
        if (res?.ok && res.runs.length > 0) {
          setBackgroundRuns((prev) => {
            const existing = new Set(prev.map((r) => r.runId));
            const newRuns = res.runs
              .filter((id) => !existing.has(id))
              .map((runId) => ({ runId, status: 'running' as const, detachedAt: Date.now() }));
            return newRuns.length > 0 ? [...prev, ...newRuns] : prev;
          });
        }
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const nextDeviceId = toChatDeviceId(currentDevice?.id);
    const prevDeviceId = chatDeviceIdRef.current;
    if (nextDeviceId === prevDeviceId) return;

    /** 与防抖 flush 一致，避免仅用闭包 chatMessages/cmd 漏写或漏 legacy */
    flushChatPersistToStorage();

    chatDeviceIdRef.current = nextDeviceId;
    sessionIdRef.current = getOrCreateStudioChatSessionId(nextDeviceId);

    const loadedForDevice = loadChatHistoryFromStorage(nextDeviceId, sessionIdRef.current);
    if (prevDeviceId === GLOBAL_CHAT_DEVICE_ID && nextDeviceId !== GLOBAL_CHAT_DEVICE_ID) {
      const merged = mergeChatMessagesById(chatMessages, loadedForDevice);
      setChatMessages(merged);
      try {
        const mergedSave = stripHeavyDataUrlsForStorage(merged.slice(-50));
        localStorage.setItem(
          chatHistoryStorageKey(nextDeviceId, sessionIdRef.current),
          JSON.stringify(mergedSave),
        );
        if (nextDeviceId === GLOBAL_CHAT_DEVICE_ID) {
          localStorage.setItem(CHAT_HISTORY_LEGACY_KEY, JSON.stringify(mergedSave));
        }
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
  // chatMessages 仅用于 global→device 合并；故意不加入 deps，避免每条消息触发切设备
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id, flushChatPersistToStorage]);

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
          accountId?: string;
          errorKind?: string;
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
      if (
        detail.type === 'channel_message_error'
        && payload.channel === 'weixin'
        && (payload.errorKind === 'session_expired' || /会话已过期|会话过期/.test(message))
      ) {
        const dedupeKey = `weixin:session_expired:${String(payload.accountId || '').trim() || message}`;
        const now = Date.now();
        const windowMs = 20_000;
        const prev = channelErrorMirrorAtRef.current.get(dedupeKey);
        if (prev !== undefined && now - prev < windowMs) return;
        channelErrorMirrorAtRef.current.set(dedupeKey, now);
        for (const [k, t] of channelErrorMirrorAtRef.current) {
          if (now - t > 120_000) channelErrorMirrorAtRef.current.delete(k);
        }
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
    chatPersistTimerRef.current = setTimeout(() => {
      chatPersistTimerRef.current = null;
      flushChatPersistToStorage();
    }, aiTyping ? 2000 : 300);
    return () => {
      const pending = chatPersistTimerRef.current;
      if (pending) {
        clearTimeout(pending);
        chatPersistTimerRef.current = null;
        flushChatPersistToStorage();
      }
    };
  }, [chatMessages, aiTyping, cmd, flushChatPersistToStorage]); /* chatMessages 参与调度；正文用 ref 避免闭包与 sessionId 不同步 */

  useEffect(() => {
    const onFlush = () => {
      flushChatPersistToStorage();
    };
    window.addEventListener('beforeunload', onFlush);
    /** Electron / 移动 WebView 等关页时 beforeunload 不可靠 */
    window.addEventListener('pagehide', onFlush);
    const onVis = () => {
      if (document.visibilityState === 'hidden') onFlush();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('beforeunload', onFlush);
      window.removeEventListener('pagehide', onFlush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [flushChatPersistToStorage]);

  // Cleanup task intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(taskIntervalsRef.current).forEach(id => clearInterval(id));
      taskIntervalsRef.current = {};
    };
  }, []);

  const hasRunningBgRuns = backgroundRuns.some((r) => r.status === 'running');
  useEffect(() => {
    if (!hasRunningBgRuns) return;
    const timer = setInterval(() => {
      getActiveRDKClawRuns()
        .then((res) => {
          if (!res?.ok) return;
          const activeSet = new Set(res.runs);
          setBackgroundRuns((prev) =>
            prev.map((item) =>
              item.status === 'running' && !activeSet.has(item.runId)
                ? { ...item, status: 'ended' as const }
                : item,
            ),
          );
        })
        .catch(() => { /* silent */ });
    }, 10_000);
    return () => clearInterval(timer);
  }, [hasRunningBgRuns]);

  // Close chat panel on tab change（副屏常驻展开，不受主导航切换影响）
  useEffect(() => {
    if (getRdkEmbedPanel()) return;
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
        addToast(translate(isEn, 'dock.export.ok', '运行诊断包已保存'), 'success');
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

  const exportDebugBundleForThread = useCallback(
    async (opts: {
      archiveDevId: string;
      sessionId: string;
      snapshotMessages: ChatMessage[];
      includeBoardLogs?: boolean;
    }) => {
      const sessionId = String(opts.sessionId || '').trim();
      if (!sessionId) {
        addToast(translate(isEn, 'dock.export.noSession', '无法导出：缺少会话 ID'), 'warning');
        return;
      }
      const archiveDevNorm = toChatDeviceId(opts.archiveDevId);
      const apiDeviceId =
        archiveDevNorm !== GLOBAL_CHAT_DEVICE_ID ? archiveDevNorm : undefined;
      const isLive =
        sessionId === String(sessionIdRef.current || '').trim()
        && archiveDevNorm === chatDeviceIdRef.current;

      try {
        const devMeta = apiDeviceId ? devices.find((d) => d.id === apiDeviceId) : undefined;
        const uiSnapshot = isLive
          ? {
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
            }
          : {
              exportedAt: new Date().toISOString(),
              studioSessionId: sessionId,
              chatDeviceId: archiveDevNorm,
              studioResponseMode,
              device: devMeta
                ? { id: devMeta.id, ip: devMeta.ip, name: devMeta.name }
                : apiDeviceId
                  ? { id: apiDeviceId }
                  : null,
              exportSource: 'dock-chat-sessions-archived-thread',
              chatMessages: stripHeavyDataUrlsForStorage(opts.snapshotMessages),
            };

        await downloadRdkclawDebugBundle({
          sessionId,
          deviceId: apiDeviceId,
          userId: userIdRef.current,
          includeBoardLogs: opts.includeBoardLogs !== false,
          uiSnapshot,
        });
        addToast(translate(isEn, 'dock.export.ok', '运行诊断包已保存'), 'success');
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
      devices,
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
    exportDebugBundleForThread,
    getStudioChatSessionId,
    getStudioChatDeviceId,
  };

  return React.createElement(AIChatContext.Provider, { value }, children);
}
