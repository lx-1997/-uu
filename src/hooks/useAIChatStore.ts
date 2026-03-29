import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  fetchDeviceOpenClawHealth,
  type AgentAttachmentPayload,
  type AgentSSEEvent,
} from '../api';
import { persistOpenClawHealthSnapshot, persistGatewayStatusSnapshot } from '../studio-ui-hints';
import {
  CHAT_HISTORY_LEGACY_KEY,
  GLOBAL_CHAT_DEVICE_ID,
  chatHistoryStorageKey,
  loadChatHistoryFromStorage,
  toChatDeviceId,
} from '../utils/chat-history-storage';
import { fetchApi } from '../utils/apiBase';
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
} from './sse-helpers';

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
      attachments?: AgentAttachmentPayload[];
      displayAttachments?: ChatAttachment[];
    },
  ) => void;
  executeConfirm: (confirmId: string) => void;
  dismissConfirm: (confirmId: string) => void;
  clearChatHistory: () => void;
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
}

const AIChatContext = createContext<AIChatStoreState | null>(null);

/** 内存中对话条数上限，避免长会话撑爆渲染进程 */
const MAX_CHAT_MESSAGES_IN_MEMORY = 100;
const LARGE_DATA_URL_STORAGE_CHARS = 48_000;
const CHAT_SESSION_KEY_PREFIX = 'rdk:chat:session-id:';
const CHAT_DRAFT_KEY_PREFIX = 'rdk:chat:draft:';

function chatSessionStorageKey(deviceId: string) {
  return `${CHAT_SESSION_KEY_PREFIX}${toChatDeviceId(deviceId)}`;
}

function chatDraftStorageKey(deviceId: string) {
  return `${CHAT_DRAFT_KEY_PREFIX}${toChatDeviceId(deviceId)}`;
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
  const { currentDevice, setActiveDevice, devices } = useDeviceStore();
  const { activeTab, setShowSettings, language } = useUIStore();
  const isEn = language === 'en';
  const t = (key: string, zh: string) => translate(isEn, key, zh);
  const tf = (key: string, zh: string, vars: Record<string, string | number>) =>
    fillTemplate(t(key, zh), vars);
  const initialChatDeviceId = toChatDeviceId(currentDevice?.id);

  // ── State ──
  const [cmd, setCmd] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => loadChatHistoryFromStorage(initialChatDeviceId));

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
    setChatMessages([]);
    try {
      const deviceId = chatDeviceIdRef.current;
      localStorage.removeItem(chatHistoryStorageKey(deviceId));
      localStorage.removeItem(chatDraftStorageKey(deviceId));
      if (toChatDeviceId(deviceId) === GLOBAL_CHAT_DEVICE_ID) {
        localStorage.removeItem(CHAT_HISTORY_LEGACY_KEY);
      }
    } catch {
      // ignore
    }
    addToast(t('chat.store.historyCleared', '对话记录已清空'), 'info');
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
  const toolTimelineRef = useRef<Record<string, {
    toolName: string;
    executor: string;
    startedAt: number;
    statusIndex: number;
    rawIndex?: number;
    /** 板端 OpenClaw 协作流式块（与 terminal 二选一） */
    collabIndex?: number;
    /** board_openclaw_chat：Studio 插入的等待提示块（非板端输出） */
    waitHintCollabIndex?: number;
    /** 合并逐字/逐块 SSE，避免每个 chunk 被当成一行导致竖排假换行 */
    openclawStreamBuf?: string;
  }>>({});
  const latestBoardToolRef = useRef<string | null>(null);
  const approvalBlockRef = useRef<Record<string, number>>({});
  const chatDeviceIdRef = useRef<string>(initialChatDeviceId);
  const sessionStorageKey = chatSessionStorageKey(initialChatDeviceId);
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
  const sessionIdRef = useRef(readOrCreateStableId(sessionStorageKey, 'ui'));
  const userIdRef = useRef(readOrCreateStableId(userStorageKey, 'studio-user'));
  const persistSessionId = (value: string) => {
    const next = String(value || '').trim();
    if (!next) return;
    sessionIdRef.current = next;
    try {
      localStorage.setItem(chatSessionStorageKey(chatDeviceIdRef.current), next);
    } catch {
      // ignore persistence failures
    }
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
      setChatMessages((prev) => [...prev, {
        id: Date.now(),
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
      attachments?: AgentAttachmentPayload[];
      displayAttachments?: ChatAttachment[];
    },
  ) => {
    e.preventDefault();
    const userMsg = String(options?.messageOverride ?? cmd).trim();
    const requestAttachments = options?.attachments ?? [];
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
    const displayText = userMsg || transcriptText || '';
    reportActiveSession('user-command');
    reportActiveDevice('user-command');
    const msgId = Date.now();
    setChatMessages(prev => [...prev, {
      id: msgId,
      role: 'user',
      text: displayText,
      source: 'studio',
      attachments: displayAttachments.length > 0 ? displayAttachments : undefined,
    }]);
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
          setChatMessages(prev => [...prev, { id: msgId + 1, role: 'ai', text: t('chat.cmd.settingsOpened', '已打开设置面板。') }]);
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
              text: result.message || tf('chat.feishu.bindOk', '绑定成功，账号：{{id}}', { id: result.openId || '***' }),
              source: 'studio',
            }]);
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
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
                text: tf('chat.stop.task', '已停止任务：{{id}}（当前轮次会被中断，状态切换为 paused）', { id: taskId }),
                source: 'studio',
              }]);
            } catch (error) {
              setChatMessages(prev => [...prev, {
                id: msgId + 1,
                role: 'ai',
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
        const aiMsgId = msgId + 1;
        let aiText = '';
        const aiBlocks: ChatBlock[] = [];
        let currentRunId = '';
        currentRunIdRef.current = '';
        toolTimelineRef.current = {};
        latestBoardToolRef.current = null;
        approvalBlockRef.current = {};

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
          requestAttachments,
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
                const executor = String(event.data.executor || 'rdkclaw_local');
                const phase = String(event.data.phase || 'start');
                const message = String(event.data.message || t('chat.stream.start', '开始处理请求'));

                if (phase === 'setup') {
                  aiBlocks.push({
                    type: 'status',
                    items: [{ label: executorLabel(executor), value: message, ok: true }],
                  });
                  updateAiMessage(aiText, aiBlocks, true);
                  break;
                }

                if (phase === 'heartbeat') {
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
                updateAiMessage(aiText, aiBlocks, true);
                break;
              }
              case 'text': {
                aiText += (event.data.delta as string) || '';
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'tool_start': {
                toolStepNo += 1;
                const toolName = resolveToolName(event.data);
                const args = event.data.args as Record<string, unknown>;
                const executor = String(event.data.executor || (toolName === 'board_openclaw_delegate' ? 'board_openclaw' : 'rdkclaw_local'));
                const phase = resolvePhase(event.data.phase);
                const argStr = summarizeToolArgs(args);
                const statusIndex = aiBlocks.length;
                aiBlocks.push({
                  type: 'status',
                  items: [
                    {
                      label: tf('chat.tool.step', '第 {{n}} 步 · {{tool}} · {{exec}}', {
                        n: toolStepNo,
                        tool: toolName,
                        exec: executorLabel(executor),
                      }),
                      value: `${phase}... ${argStr}`,
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
                  ...((toolName === 'board_openclaw_delegate' || toolName === 'board_openclaw_chat')
                    ? { openclawStreamBuf: '' }
                    : {}),
                };
                if (toolName === 'board_openclaw_delegate' || toolName === 'board_openclaw_chat') {
                  latestBoardToolRef.current = toolCallId;
                  const outboundLines = formatBoardOutboundLines(toolName, args);
                  if (outboundLines.length > 0) {
                    aiBlocks.push({
                      type: 'collab',
                      side: 'rdkclaw',
                      collabRole: 'outbound',
                      title: t('dock.collab.outboundTitle', '发给板端 OpenClaw'),
                      subtitle: toolName === 'board_openclaw_chat'
                        ? t('dock.collab.outboundChatSubtitle', 'RDKClaw 发出的交流内容')
                        : t('dock.collab.outboundDelegateSubtitle', '委派任务与执行建议'),
                      lines: outboundLines,
                      collapsible: true,
                      previewLines: 12,
                    });
                  }
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
                const statusBlock = aiBlocks[state.statusIndex];
                if (statusBlock?.type === 'status' && statusBlock.items[0]) {
                  statusBlock.items[0].value = tf('chat.tool.runningVal', '执行中 · {{exec}} · 实时输出更新', {
                    exec: executorLabel(state.executor),
                  });
                }
                const isBoardOpenClaw =
                  toolName === 'board_openclaw_delegate'
                  || toolName === 'board_openclaw_chat'
                  || state.executor === 'board_openclaw';
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
                      const bufLines = state.openclawStreamBuf.split('\n');
                      collabBlock.lines = bufLines.length > 240 ? bufLines.slice(-240) : bufLines;
                    }
                  } else {
                    state.collabIndex = aiBlocks.length;
                    state.openclawStreamBuf = rawChunk;
                    const bufLines = state.openclawStreamBuf.split('\n');
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
                if (state) {
                  const statusBlock = aiBlocks[state.statusIndex];
                  if (statusBlock?.type === 'status' && statusBlock.items[0]) {
                    statusBlock.items[0] = {
                      label: tf('chat.tool.resultLabel', '{{tool}} · {{exec}}', {
                        tool: state.toolName,
                        exec: executorLabel(state.executor),
                      }),
                      value: tf('chat.tool.doneMs', '{{state}} · {{ms}}ms', {
                        state: isError ? t('chat.tool.fail', '失败') : t('chat.tool.done', '完成'),
                        ms: Math.max(1, elapsedMs),
                      }),
                      ok: !isError,
                    };
                  }
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
                  && (toolName === 'board_openclaw_delegate' || toolName === 'board_openclaw_chat')
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
                  if (result.includes('\n') || result.length > 100) {
                    aiBlocks.push({
                      type: 'terminal',
                      lines: result.split('\n').slice(0, 60),
                      label: tf('chat.tool.finalLabel', '{{tool}} · 最终结果', { tool: toolName }),
                      collapsible: true,
                      previewLines: 10,
                    });
                  } else if (!state) {
                    aiBlocks.push({
                      type: 'status',
                      items: [{
                        label: toolName,
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
                  aiText = String(event.data.text || '');
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
                const executor = String(event.data.executor || (toolName === 'board_openclaw_delegate' ? 'board_openclaw' : 'rdkclaw_local'));
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
                      updateAiMessage(aiText, aiBlocks, true);
                    }
                  }
                }
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
                  aiBlocks.push(progressBlock);
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'run_complete': {
                const progressIdx = aiBlocks.findIndex(
                  (b) => b.type === 'status' && (b as any)._runProgress,
                );
                if (progressIdx >= 0) {
                  aiBlocks[progressIdx] = { type: 'status' as const, items: [] };
                }
                const elapsed = String(event.data.elapsed_display || '');
                const calls = Number(event.data.tool_calls || 0);
                const isError = Boolean(event.data.error);
                const isCancelled = Boolean(event.data.cancelled);
                const detail: string[] = [];
                if (elapsed) detail.push(elapsed);
                if (calls > 0) detail.push(tf('chat.runComplete.steps', '{{n}} 步', { n: calls }));
                const label = isCancelled
                  ? t('chat.runComplete.cancelled', '⊘ 已取消')
                  : isError
                    ? t('chat.runComplete.err', '✗ 执行出错')
                    : t('chat.runComplete.ok', '✓ 回复完成');
                const ok = !isError && !isCancelled;
                aiBlocks.push({
                  type: 'status',
                  items: [{ label, value: detail.length > 0 ? detail.join(' · ') : '', ok }],
                });
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
        setAiTyping(false);
      } finally {
        if (generation === streamGenerationRef.current) {
          streamAbortRef.current = null;
          currentRunIdRef.current = '';
          commandLockRef.current = false;
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
      setChatMessages((prev) => [...prev, {
        id: Date.now(),
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
      setChatMessages((prev) => [...prev, {
        id: Date.now(),
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
      setChatMessages((prev) => [...prev, {
        id: Date.now(),
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
    setChatMessages((prev) => [...prev, {
      id: Date.now(),
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
      localStorage.setItem(chatHistoryStorageKey(prevDeviceId), JSON.stringify(prevToSave));
      localStorage.setItem(chatDraftStorageKey(prevDeviceId), cmd);
    } catch {
      // ignore
    }

    chatDeviceIdRef.current = nextDeviceId;
    setChatMessages(loadChatHistoryFromStorage(nextDeviceId));

    try {
      const nextDraft = localStorage.getItem(chatDraftStorageKey(nextDeviceId)) ?? '';
      setCmd(nextDraft);
    } catch {
      setCmd('');
    }

    sessionIdRef.current = readOrCreateStableId(chatSessionStorageKey(nextDeviceId), 'ui');
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
        const data = (await res.json()) as { running?: boolean; version?: string; feishuConnected?: boolean };
        persistGatewayStatusSnapshot(id, {
          running: !!data.running,
          version: typeof data.version === 'string' ? data.version : '',
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
          .map((line) => line.replace(/^board_openclaw_delegate:\s*/i, '').trim())
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
              return { ...item, blocks: nextBlocks };
            }));
            return;
          }

          const fallbackMessageId = ts + 1;
          if (streamKey) {
            feishuToolMessageRef.current[streamKey] = fallbackMessageId;
            feishuLastToolKeyRef.current = streamKey;
          }
          setChatMessages((prev) => [
            ...prev,
            {
              id: fallbackMessageId,
              role: 'ai',
              text: '',
              source: 'studio',
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
  const chatPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (chatPersistTimerRef.current) clearTimeout(chatPersistTimerRef.current);
    chatPersistTimerRef.current = setTimeout(() => {
      try {
        const toSave = stripHeavyDataUrlsForStorage(chatMessages.slice(-50));
        localStorage.setItem(chatHistoryStorageKey(chatDeviceIdRef.current), JSON.stringify(toSave));
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
  }, [chatMessages, aiTyping, cmd]);

  // Cleanup task intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(taskIntervalsRef.current).forEach(id => clearInterval(id));
      taskIntervalsRef.current = {};
    };
  }, []);

  // Close chat panel on tab change
  useEffect(() => {
    if (chatExpanded) setChatExpanded(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const value: AIChatStoreState = {
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, setChatMessages, chatExpanded, setChatExpanded,
    aiTyping, setAiTyping, handleCommand,
    executeConfirm, dismissConfirm, clearChatHistory,
    agentMode, setAgentMode, agentPlan, agentExecution,
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask, handleApprovalAction, handleRecommendationChoice, handleSoulUpdateDecision, stopCurrentRun, stopAllRuns, backgroundCurrentRun,
    backgroundRuns, stopBackgroundRun,
  };

  return React.createElement(AIChatContext.Provider, { value }, children);
}
