import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatBlock, AgentPlan, AgentExecutionState } from '../app-types';
import { CMD_SUGGESTIONS } from '../constants';
import { bindRDKClawFeishuCode, cancelRDKClawRun, decideRDKClawApproval, setActiveRdkclawDevice, setActiveRdkclawSession, stopRDKClawTask, streamAgentChat, type AgentSSEEvent } from '../api';
import type { Task } from '../ai';
import { useToastStore } from './useToastStore';
import { useDeviceStore } from './useDeviceStore';
import { useUIStore } from './useUIStore';

export interface AIChatStoreState {
  cmd: string;
  setCmd: (v: string) => void;
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  filteredSuggestions: typeof CMD_SUGGESTIONS;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  chatExpanded: boolean;
  setChatExpanded: (v: boolean) => void;
  aiTyping: boolean;
  setAiTyping: React.Dispatch<React.SetStateAction<boolean>>;
  handleCommand: (e: React.FormEvent) => void;
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
  stopCurrentRun: () => void;
}

const AIChatContext = createContext<AIChatStoreState | null>(null);

export function useAIChatStore(): AIChatStoreState {
  const ctx = useContext(AIChatContext);
  if (!ctx) throw new Error('useAIChatStore must be used within AIChatProvider');
  return ctx;
}

export function AIChatProvider({ children }: { children: React.ReactNode }) {
  const { addToast } = useToastStore();
  const { currentDevice } = useDeviceStore();
  const { activeTab, setShowSettings } = useUIStore();

  // ── State ──
  const [cmd, setCmd] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('rdk-chat-history');
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        return parsed.map(m => ({
          ...m,
          blocks: m.blocks?.filter(b => b.type !== 'confirm' && b.type !== 'progress'),
        }));
      }
    } catch { /* ignore */ }
    return [];
  });
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

  const filteredSuggestions = cmd.trim()
    ? CMD_SUGGESTIONS.filter((s) => s.text.includes(cmd) || s.keyword.includes(cmd.toLowerCase()))
    : CMD_SUGGESTIONS;

  // ── Confirm / Dismiss ──
  const executeConfirm = (confirmId: string) => {
    const action = pendingActionsRef.current[confirmId];
    if (!action) return;
    delete pendingActionsRef.current[confirmId];
    setChatMessages(prev => prev.map(msg => ({
      ...msg,
      blocks: msg.blocks?.map(b => b.type === 'confirm' && b.confirmId === confirmId
        ? { type: 'task-result' as const, success: true, title: '已确认', detail: '正在执行...' }
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
        ? { type: 'task-result' as const, success: false, title: '已取消', detail: '操作已取消' }
        : b
      ),
    })));
  };

  const clearChatHistory = () => {
    setChatMessages([]);
    localStorage.removeItem('rdk-chat-history');
    addToast('对话记录已清空', 'info');
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
    addToast('任务已取消', 'info');
  };

  const commandLockRef = useRef(false);
  const currentRunIdRef = useRef('');
  const streamAbortRef = useRef<null | (() => void)>(null);
  const toolTimelineRef = useRef<Record<string, {
    toolName: string;
    executor: string;
    startedAt: number;
    statusIndex: number;
    rawIndex?: number;
  }>>({});
  const latestBoardToolRef = useRef<string | null>(null);
  const approvalBlockRef = useRef<Record<string, number>>({});
  const sessionIdRef = useRef(`ui-${Date.now()}`);
  const feishuMirrorSeenRef = useRef<Set<string>>(new Set());
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
          addToast('会话同步上报失败，飞书可能无法接入当前会话', 'warning');
        }
      });
  };
  const reportActiveDevice = (reason: string) => {
    const deviceId = String(currentDevice?.id || '').trim();
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
          addToast('设备同步上报失败，飞书可能无法复用当前设备', 'warning');
        }
      });
  };

  const summarizeToolArgs = (args: Record<string, unknown>) => {
    const entries = Object.entries(args || {});
    if (entries.length === 0) return '无参数';
    return entries.map(([k, v]) => {
      if (typeof v === 'string') {
        if (k === 'content') return `${k}: <${v.length} chars>`;
        const compact = v.replace(/\s+/g, ' ').trim();
        const limit = k === 'command' ? 120 : 80;
        return `${k}: ${compact.slice(0, limit)}${compact.length > limit ? '...' : ''}`;
      }
      if (v && typeof v === 'object') return `${k}: [object]`;
      return `${k}: ${String(v)}`;
    }).join(' | ');
  };

  // ── Main command handler ──
  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim() || commandLockRef.current) return;
    const userMsg = cmd.trim();
    reportActiveSession('user-command');
    reportActiveDevice('user-command');
    const msgId = Date.now();
    setChatMessages(prev => [...prev, { id: msgId, role: 'user', text: userMsg, source: 'studio' }]);
    setChatExpanded(true);
    setCmd('');
    setShowSuggestions(false);
    setAiTyping(true);
    commandLockRef.current = true;

    (async () => {
      try {
        // /settings — quick command to open settings
        if (userMsg === '/settings') {
          setShowSettings(true);
          setChatMessages(prev => [...prev, { id: msgId + 1, role: 'ai', text: '已打开设置面板。' }]);
          setAiTyping(false);
          return;
        }

        const bindMatch = userMsg.match(/^(?:绑定飞书|飞书绑定|bind\s*feishu)\s+(\d{6})$/i);
        if (bindMatch) {
          const code = bindMatch[1];
          try {
            const result = await bindRDKClawFeishuCode(code, sessionIdRef.current);
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: result.message || `绑定成功，账号：${result.openId || '***'}`,
              source: 'studio',
            }]);
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: `绑定失败：${error instanceof Error ? error.message : '授权码无效或已过期'}`,
              source: 'studio',
            }]);
          }
          setAiTyping(false);
          return;
        }

        const stopTaskMatch = userMsg.match(/^(?:停止任务|暂停任务|stop\s*task)\s+([a-zA-Z0-9_-]+)$/i);
        if (stopTaskMatch) {
          const taskId = stopTaskMatch[1];
          try {
            await stopRDKClawTask(taskId);
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: `已停止任务：${taskId}（当前轮次会被中断，状态切换为 paused）`,
              source: 'studio',
            }]);
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: `停止任务失败：${error instanceof Error ? error.message : '未知错误'}`,
              source: 'studio',
            }]);
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

        const updateAiMessage = (text: string, blocks: ChatBlock[]) => {
          setChatMessages(prev => prev.map(m =>
            m.id === aiMsgId ? { ...m, text, blocks: [...blocks] } : m
          ));
        };
        const executorLabel = (executor: string) =>
          executor === 'board_openclaw' ? '板端 OpenClaw' : 'RDK Studio Claw';
        const resolveToolName = (data: Record<string, unknown>) =>
          String(data.toolName || data.name || 'unknown_tool');
        const resolveToolId = (data: Record<string, unknown>) =>
          String(data.toolCallId || '');
        const resolvePhase = (phase: unknown) => {
          if (phase === 'start') return '准备中';
          if (phase === 'running') return '执行中';
          if (phase === 'end') return '已完成';
          if (phase === 'error') return '失败';
          return '执行中';
        };

        const { done, abort } = streamAgentChat(
          userMsg,
          currentDevice?.id,
          sessionIdRef.current,
          (event: AgentSSEEvent) => {
            switch (event.type) {
              case 'meta': {
                currentRunId = String(event.data.runId || currentRunId || '');
                currentRunIdRef.current = currentRunId;
                const executor = String(event.data.executor || 'rdkclaw_local');
                const phase = resolvePhase(event.data.phase);
                const message = String(event.data.message || '开始处理请求');
                const networkEnabled = Boolean(event.data.network_enabled);
                const networkMaxFetchChars = Number(event.data.network_max_fetch_chars || 0);
                aiBlocks.push({
                  type: 'status',
                  items: [
                    { label: `执行主体: ${executorLabel(executor)}`, value: `${phase} · ${message}`, ok: true },
                    {
                      label: '联网能力',
                      value: networkEnabled ? `已启用 · 上限 ${networkMaxFetchChars || 0} chars` : '已禁用',
                      ok: networkEnabled,
                    },
                  ],
                });
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'text': {
                aiText += (event.data.delta as string) || '';
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'tool_start': {
                const toolName = resolveToolName(event.data);
                const args = event.data.args as Record<string, unknown>;
                const executor = String(event.data.executor || (toolName === 'board_openclaw_delegate' ? 'board_openclaw' : 'rdkclaw_local'));
                const phase = resolvePhase(event.data.phase);
                const argStr = summarizeToolArgs(args);
                const statusIndex = aiBlocks.length;
                aiBlocks.push({
                  type: 'status',
                  items: [
                    { label: `${toolName} · ${executorLabel(executor)}`, value: `${phase}... ${argStr}`, ok: true },
                  ],
                });
                const toolCallId = resolveToolId(event.data) || `${toolName}-${Date.now()}`;
                toolTimelineRef.current[toolCallId] = {
                  toolName,
                  executor,
                  startedAt: Date.now(),
                  statusIndex,
                };
                if (toolName === 'board_openclaw_delegate') {
                  latestBoardToolRef.current = toolCallId;
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'tool_progress': {
                const toolName = resolveToolName(event.data);
                const chunk = String(event.data.chunk || '').trim();
                if (!chunk) break;
                const rawToolId = resolveToolId(event.data);
                const fallbackId = latestBoardToolRef.current || '';
                const toolId = rawToolId && toolTimelineRef.current[rawToolId] ? rawToolId : fallbackId;
                if (!toolId || !toolTimelineRef.current[toolId]) break;
                const state = toolTimelineRef.current[toolId];
                const statusBlock = aiBlocks[state.statusIndex];
                if (statusBlock?.type === 'status' && statusBlock.items[0]) {
                  statusBlock.items[0].value = `执行中 · ${executorLabel(state.executor)} · 实时输出更新`;
                }
                const progressLines = chunk.split('\n').map((line) => line.trim()).filter(Boolean).slice(-20);
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
                    label: `${state.toolName} · 原始中间输出`,
                    lines: progressLines,
                    collapsible: true,
                    previewLines: 10,
                  });
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
                      label: `${state.toolName} · ${executorLabel(state.executor)}`,
                      value: `${isError ? '失败' : '完成'} · ${Math.max(1, elapsedMs)}ms`,
                      ok: !isError,
                    };
                  }
                }
                if (result.includes('\n') || result.length > 100) {
                  aiBlocks.push({
                    type: 'terminal',
                    lines: result.split('\n').slice(0, 60),
                    label: `${toolName} · 最终结果`,
                    collapsible: true,
                    previewLines: 10,
                  });
                } else if (!state) {
                  aiBlocks.push({
                    type: 'status',
                    items: [{ label: toolName, value: result || (isError ? '失败' : '完成'), ok: !isError }],
                  });
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'approval_required': {
                const approvalId = String(event.data.approvalId || '');
                if (!approvalId) break;
                const toolName = resolveToolName(event.data);
                const risk = String(event.data.risk || 'medium') as 'low' | 'medium' | 'high';
                const runId = String(event.data.runId || currentRunId || '');
                const executor = String(event.data.executor || (toolName === 'board_openclaw_delegate' ? 'board_openclaw' : 'rdkclaw_local'));
                const summary = `${toolName} · ${executorLabel(executor)} · 风险 ${risk.toUpperCase()}`;
                approvalBlockRef.current[approvalId] = aiBlocks.length;
                aiBlocks.push({
                  type: 'approval',
                  approvalId,
                  runId,
                  risk,
                  executor,
                  text: `需要你的确认后才能执行：${summary}`,
                });
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'approval_decision': {
                const approvalId = String(event.data.approvalId || '');
                const decision = String(event.data.decision || 'allow_once');
                const index = approvalBlockRef.current[approvalId];
                if (typeof index === 'number') {
                  aiBlocks[index] = {
                    type: 'task-result',
                    success: decision !== 'deny',
                    title: decision === 'deny' ? '已拒绝执行' : '已确认执行',
                    detail: `审批决策：${decision}`,
                  };
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'error': {
                const errorMsg = (event.data.error as string) || 'Agent 执行出错';
                let friendlyText = '';
                let friendlyDetail = errorMsg;

                if (errorMsg.includes('未配置 AI 模型')) {
                  friendlyText = '请先配置 AI 模型。打开设置 → AI 模型，选择服务商并填写 API Key。';
                  friendlyDetail = '点击右上角 ⚙️ 设置图标即可配置';
                } else if (errorMsg.includes('401') || errorMsg.includes('Incorrect API key')) {
                  friendlyText = 'API Key 无效或已过期，请在设置中重新配置。';
                  friendlyDetail = '打开设置 → AI 模型，更新 API Key';
                } else if (errorMsg.includes('Connection error') || errorMsg.includes('ECONNREFUSED')) {
                  friendlyText = '无法连接到 AI 服务，请检查网络或 API 地址。';
                  friendlyDetail = '如果使用通义千问 sk-sp- 开头的 Key，请确认 Base URL 是否正确';
                } else {
                  friendlyText = aiText || '请求出错，请稍后重试。';
                }

                aiBlocks.push({
                  type: 'status',
                  items: [{ label: '提示', value: friendlyDetail, ok: false }],
                });
                updateAiMessage(friendlyText, aiBlocks);
                break;
              }
              case 'done':
                break;
            }
          },
        );
        streamAbortRef.current = abort;

        await done;
        setAiTyping(false);
      } finally {
        streamAbortRef.current = null;
        currentRunIdRef.current = '';
        commandLockRef.current = false;
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
        blocks: [{ type: 'task-result', success: false, title: '已取消当前任务', detail: `runId: ${runId}` }],
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
          title: ok ? '已提交审批决策' : '已拒绝执行',
          detail: ok ? `策略：${action}` : '该步骤不会执行',
        };
      }),
    })));
  };

  const stopCurrentRun = () => {
    const runId = currentRunIdRef.current;
    streamAbortRef.current?.();
    streamAbortRef.current = null;
    if (runId) {
      cancelRDKClawRun(runId).catch(() => null);
    }
    setAiTyping(false);
    commandLockRef.current = false;
    setChatMessages((prev) => [...prev, {
      id: Date.now(),
      role: 'ai',
      text: '',
      blocks: [{
        type: 'task-result',
        success: false,
        title: '已停止当前执行',
        detail: runId ? `runId: ${runId}` : '已中断当前流式响应',
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
    if (!currentDevice?.id) return;
    reportActiveDevice('device-change');
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        };
      }>;
      const detail = e.detail ?? {};
      const ts = detail.ts ?? Date.now();
      const title = detail.title || '系统推送';
      const message = detail.message || '收到新的系统事件';
      const ok = detail.level !== 'error';
      const payload = detail.payload || {};
      const isFeishuMirror = detail.type?.startsWith('channel_message_') && payload.channel === 'feishu';
      if (isFeishuMirror) {
        if (payload.sessionId && payload.sessionId !== sessionIdRef.current) {
          // 飞书会话优先作为统一上下文，自动接管当前 Studio 会话键
          sessionIdRef.current = payload.sessionId;
          reportActiveSession('feishu-mirror-switch');
        }
        const dedupKey = `${payload.messageId || ''}:${detail.type || ''}:${payload.direction || ''}`;
        if (dedupKey !== '::' && feishuMirrorSeenRef.current.has(dedupKey)) return;
        if (dedupKey !== '::') feishuMirrorSeenRef.current.add(dedupKey);
        setChatExpanded(true);
        if (payload.direction === 'ack' || payload.direction === 'error') {
          const label = payload.direction === 'error' ? '飞书通道' : '飞书回执';
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
  }, []);

  // Persist chat history
  useEffect(() => {
    try {
      const toSave = chatMessages.slice(-50);
      localStorage.setItem('rdk-chat-history', JSON.stringify(toSave));
    } catch { /* quota exceeded */ }
  }, [chatMessages]);

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

  // Auto-scroll chat
  useEffect(() => {
    const el = document.querySelector('.chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages, aiTyping]);

  const value: AIChatStoreState = {
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, setChatMessages, chatExpanded, setChatExpanded,
    aiTyping, setAiTyping, handleCommand,
    executeConfirm, dismissConfirm, clearChatHistory,
    agentMode, setAgentMode, agentPlan, agentExecution,
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask, handleApprovalAction, stopCurrentRun,
  };

  return React.createElement(AIChatContext.Provider, { value }, children);
}
