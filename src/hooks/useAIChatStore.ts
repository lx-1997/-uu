import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatBlock, AgentPlan, AgentExecutionState, ChatAttachment } from '../app-types';
import { CMD_SUGGESTIONS } from '../constants';
import {
  bindRDKClawFeishuCode,
  cancelRDKClawRun,
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
  type AgentAttachmentPayload,
  type AgentSSEEvent,
} from '../api';
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
  stopCurrentRun: () => void;
  backgroundCurrentRun: () => void;
  backgroundRuns: Array<{
    runId: string;
    status: 'running' | 'ended';
    detachedAt: number;
  }>;
  stopBackgroundRun: (runId: string) => void;
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
  const [backgroundRuns, setBackgroundRuns] = useState<Array<{
    runId: string;
    status: 'running' | 'ended';
    detachedAt: number;
  }>>([]);

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
  }>>({});
  const latestBoardToolRef = useRef<string | null>(null);
  const approvalBlockRef = useRef<Record<string, number>>({});
  const sessionStorageKey = 'rdk:chat:session-id';
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
      localStorage.setItem(sessionStorageKey, next);
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
        text: '当前任务已结束。你可以继续输入新的指令。',
        blocks: [{
          type: 'task-result',
          success: false,
          title: '任务已结束',
          detail: runId ? `已发送结束指令（runId: ${runId}）` : '已结束当前流式响应',
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
    const requestMessage = userMsg || '请结合我刚上传的附件继续处理当前请求。';
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
          setChatMessages(prev => [...prev, { id: msgId + 1, role: 'ai', text: '已打开设置面板。' }]);
          setAiTyping(false);
          return;
        }

        const resolveOneShotPrompt = () => {
          if (requestAttachments.length > 0) return '';
          const explicit = userMsg.match(/^(?:\/one-shot-app|一句话生成(?:rdk)?应用)\s+(.+)$/i);
          if (explicit) return explicit[1].trim();
          if (userMsg.startsWith('/')) return '';
          const implicit = /(?:生成|创建|做一个|写一个).{0,24}(?:rdk).{0,24}(?:应用|app|项目|脚手架)/i.test(userMsg)
            || /(?:rdk).{0,24}(?:应用|app|项目).{0,24}(?:生成|创建|搭建)/i.test(userMsg);
          return implicit ? userMsg.trim() : '';
        };
        const oneShotPrompt = resolveOneShotPrompt();
        if (oneShotPrompt) {
          const prompt = oneShotPrompt;
          try {
            const result = await generateOneShotApp(prompt);
            let validationText = '未执行';
            let validationBlocks: ChatBlock[] = [];
            try {
              const validation = await validateOneShotApp(result.app.rootDir);
              validationText = validation.validation.ok ? '通过' : '未通过';
              validationBlocks = [{
                type: 'status',
                collapsible: true,
                defaultCollapsed: true,
                summary: `自动校验 · ${validationText}`,
                items: validation.validation.checks.map((c) => ({
                  label: c.name,
                  value: c.detail,
                  ok: c.ok,
                })),
              }];
            } catch {
              validationText = '校验失败';
            }
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: '已完成应用骨架生成。',
              source: 'studio',
              blocks: [
                {
                  type: 'status',
                  items: [
                    { label: '应用名称', value: result.app.name, ok: true },
                    { label: '生成目录', value: result.app.rootDir, ok: true },
                    { label: '文件数量', value: String(result.app.files.length), ok: true },
                    { label: '运行命令', value: result.app.runCommand, ok: true },
                    { label: '生成模式', value: result.app.usedFallback ? '模板兜底' : 'AI 规划', ok: true },
                    { label: '自动校验', value: validationText, ok: validationText === '通过' },
                  ],
                },
                {
                  type: 'terminal',
                  label: '已生成文件',
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
              text: `应用生成失败：${error instanceof Error ? error.message : '未知错误'}`,
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
              text: '还没有可运行的生成应用，请先执行一句话生成。',
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
              text: run.ok ? '应用已执行完成。' : '应用执行失败。',
              source: 'studio',
              blocks: [
                {
                  type: 'status',
                  items: [
                    { label: '运行命令', value: run.run.runner || runCommand, ok: true },
                    { label: '执行结果', value: run.ok ? (run.run.timedOut ? '运行中（超时中断）' : '成功') : '失败', ok: run.ok },
                    { label: '应用目录', value: appDir, ok: true },
                  ],
                },
                {
                  type: 'terminal',
                  label: '运行输出',
                  lines: outputLines.length > 0 ? outputLines : ['[无输出]'],
                  collapsible: true,
                  previewLines: 10,
                },
              ],
            }]);
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: `应用执行失败：${error instanceof Error ? error.message : '未知错误'}`,
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
              text: '请先连接目标设备，再执行部署。',
              source: 'studio',
            }]);
            setAiTyping(false);
            return;
          }
          if (!appDir) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: '还没有可部署的生成应用，请先执行一句话生成。',
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
              text: '应用已部署到设备。',
              source: 'studio',
              blocks: [
                {
                  type: 'status',
                  items: [
                    { label: '目标设备', value: `${currentDevice.name} (${currentDevice.ip})`, ok: true },
                    { label: '部署目录', value: deploy.deploy.remoteDir, ok: true },
                    { label: '文件数量', value: String(deploy.deploy.fileCount), ok: true },
                    { label: '运行命令', value: deploy.deploy.runCommand || deployRunCommand, ok: true },
                    { label: '运行结果', value: deploy.deploy.run?.ok ? '成功' : '失败', ok: Boolean(deploy.deploy.run?.ok) },
                    ...(suggestions.length > 0 ? [{ label: '修复建议', value: `${suggestions.length} 条`, ok: true }] : []),
                  ],
                },
                ...(runOutput.length > 0 ? [{
                  type: 'terminal' as const,
                  label: '设备运行输出',
                  lines: runOutput,
                  collapsible: true,
                  previewLines: 10,
                }] : []),
                ...(suggestions.length > 0 ? [{
                  type: 'terminal' as const,
                  label: '建议下一步',
                  lines: suggestions.map((item, idx) => {
                    const cmd = item.command ? ` | 命令: ${item.command}` : '';
                    return `${idx + 1}. ${item.title}: ${item.detail}${cmd}`;
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
              text: `部署失败：${error instanceof Error ? error.message : '未知错误'}`,
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
              text: '暂无可执行修复建议，请先完成一次部署并产生建议。',
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
              text: `第 ${index} 条建议没有可执行命令，请手动处理。`,
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
              output: error instanceof Error ? error.message : '自动重试运行失败',
            }));
            const retryLines = String(retryResult.output || '').split(/\r?\n/).filter(Boolean).slice(0, 60);
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: `已执行修复建议 #${index}：${selected.title}，并自动重试运行。`,
              source: 'studio',
              blocks: [
                {
                  type: 'status',
                  items: [
                    { label: '修复项', value: selected.title, ok: true },
                    { label: '执行目录', value: fixState.remoteDir, ok: true },
                    { label: '命令', value: selected.command || '', ok: true },
                    { label: '重试命令', value: fixState.runCommand || 'python main.py', ok: true },
                    { label: '重试运行', value: retryResult.ok ? '成功' : '失败', ok: Boolean(retryResult.ok) },
                  ],
                },
                {
                  type: 'terminal',
                  label: '修复输出',
                  lines: lines.length > 0 ? lines : ['[无输出]'],
                  collapsible: true,
                  previewLines: 10,
                },
                {
                  type: 'terminal',
                  label: '重试运行输出',
                  lines: retryLines.length > 0 ? retryLines : ['[无输出]'],
                  collapsible: true,
                  previewLines: 10,
                },
              ],
            }]);
          } catch (error) {
            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: `修复执行失败：${error instanceof Error ? error.message : '未知错误'}`,
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

        const stopTaskMatch = requestAttachments.length === 0
          ? userMsg.match(/^(?:停止任务|暂停任务|stop\s*task)\s+([a-zA-Z0-9_-]+)$/i)
          : null;
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
        const resolveDecisionSourceLabel = (source: string) => {
          if (source === 'user_mode') return '用户指定';
          if (source === 'skill_policy') return '技能策略';
          if (source === 'task_analysis') return '任务可完成性判断';
          if (source === 'policy_rule') return '规则命中';
          if (source === 'persona') return '人格/策略配置';
          return '默认策略';
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
            switch (event.type) {
              case 'meta': {
                currentRunId = String(event.data.runId || currentRunId || '');
                currentRunIdRef.current = currentRunId;
                const executor = String(event.data.executor || 'rdkclaw_local');
                const phase = resolvePhase(event.data.phase);
                const message = String(event.data.message || '开始处理请求');
                const networkEnabled = Boolean(event.data.network_enabled);
                const networkMaxFetchChars = Number(event.data.network_max_fetch_chars || 0);
                const attachmentsCount = Number(event.data.attachments_count || 0);
                const newAttachmentsCount = Number(event.data.new_attachments_count || 0);
                const audioTranscriptCount = Number(event.data.audio_transcript_count || 0);
                const newAudioTranscriptCount = Number(event.data.new_audio_transcript_count || 0);
                const decisionSource = String(event.data.decision_source || 'default');
                const decisionReason = String(event.data.decision_reason || '未提供');
                const delegationMode = String(event.data.delegation_mode || '默认');
                const delegationExpectation = String(event.data.delegation_expectation || '');
                const canLocalComplete = Boolean(event.data.can_local_complete);
                const needsBoardCollaboration = Boolean(event.data.needs_board_collaboration);
                const confidenceRaw = Number(event.data.confidence || 0);
                const confidence = Number.isFinite(confidenceRaw)
                  ? `${Math.round(Math.max(0, Math.min(1, confidenceRaw)) * 100)}%`
                  : 'N/A';
                const matchedSkills = Array.isArray(event.data.matched_skills)
                  ? (event.data.matched_skills as string[]).filter(Boolean)
                  : [];
                const attachmentTypes = Array.isArray(event.data.attachment_types)
                  ? (event.data.attachment_types as string[]).filter(Boolean).join(' / ')
                  : '';
                aiBlocks.push({
                  type: 'status',
                  collapsible: true,
                  defaultCollapsed: true,
                  summary: `${executorLabel(executor)} · ${message}`,
                  items: [
                    { label: `执行主体: ${executorLabel(executor)}`, value: `${phase} · ${message}`, ok: true },
                    {
                      label: '多模态上下文',
                      value: attachmentsCount > 0
                        ? `已接入 ${attachmentsCount} 个附件${newAttachmentsCount > 0 ? `（本轮新增 ${newAttachmentsCount}）` : ''}${attachmentTypes ? ` · ${attachmentTypes}` : ''}${newAudioTranscriptCount > 0 ? ` · 本轮语音已转写 ${newAudioTranscriptCount} 个` : audioTranscriptCount > 0 ? ` · 累计已转写 ${audioTranscriptCount} 个语音` : ''}`
                        : '本轮无附件',
                      ok: attachmentsCount > 0,
                    },
                    {
                      label: '联网能力',
                      value: networkEnabled ? `已启用 · 上限 ${networkMaxFetchChars || 0} chars` : '已禁用',
                      ok: networkEnabled,
                    },
                    {
                      label: '任务路径判定',
                      value: `${delegationMode} · ${resolveDecisionSourceLabel(decisionSource)} · 置信度 ${confidence}`,
                      ok: true,
                    },
                    {
                      label: '调度依据',
                      value: decisionReason,
                      ok: true,
                    },
                    {
                      label: '执行路径说明',
                      value: delegationExpectation || '未提供',
                      ok: true,
                    },
                    {
                      label: '本地可独立完成',
                      value: canLocalComplete ? '是' : '否',
                      ok: canLocalComplete,
                    },
                    {
                      label: '需要板端协同',
                      value: needsBoardCollaboration ? '是' : '否',
                      ok: !needsBoardCollaboration || Boolean(currentDevice?.id),
                    },
                    {
                      label: '命中能力',
                      value: matchedSkills.length > 0 ? matchedSkills.join(' / ') : '无明显技能命中，按通用流程执行',
                      ok: matchedSkills.length > 0,
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
                    { label: `第 ${toolStepNo} 步 · ${toolName} · ${executorLabel(executor)}`, value: `${phase}... ${argStr}`, ok: true },
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

                let imageHandled = false;
                if (!isError && result.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(result) as Record<string, unknown>;
                    if (parsed.__type === 'image_download' && typeof parsed.imageUrl === 'string') {
                      aiBlocks.push({
                        type: 'image',
                        src: parsed.imageUrl as string,
                        caption: `${parsed.fileName || '图片'} (${parsed.bytes || 0} bytes) — 来自设备`,
                      });
                      imageHandled = true;
                    }
                  } catch {
                    // not JSON, fall through to normal handling
                  }
                }

                if (!imageHandled) {
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
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'turn_start': {
                if (!showDebugTurnsRef.current) break;
                const turn = Math.max(1, Number(event.data.turn || 0));
                const existing = aiBlocks.find(
                  (b) => b.type === 'status' && b.summary?.startsWith('思考轮次'),
                );
                if (existing && existing.type === 'status') {
                  existing.items[0] = { label: '思考轮次', value: `第 ${turn} 轮`, ok: true };
                  existing.summary = `思考轮次 · 第 ${turn} 轮`;
                } else {
                  aiBlocks.push({
                    type: 'status',
                    collapsible: true,
                    defaultCollapsed: true,
                    summary: `思考轮次 · 第 ${turn} 轮`,
                    items: [{ label: '思考轮次', value: `第 ${turn} 轮`, ok: true }],
                  });
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'turn_end': {
                if (!showDebugTurnsRef.current) break;
                const turn = Math.max(1, Number(event.data.turn || 0));
                const existing = aiBlocks.find(
                  (b) => b.type === 'status' && b.summary?.startsWith('思考轮次'),
                );
                if (existing && existing.type === 'status') {
                  existing.items[0] = { label: '思考轮次', value: `共 ${turn} 轮`, ok: true };
                  existing.summary = `思考轮次 · 共 ${turn} 轮`;
                }
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'message_end': {
                if (!aiText.trim()) {
                  aiText = String(event.data.text || '');
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
                  const delegationStats = event.data.delegation as {
                    mode?: string;
                    expected?: string;
                    source?: string;
                    reason?: string;
                    confidence?: number;
                    canLocalComplete?: boolean;
                    needsBoardCollaboration?: boolean;
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
                  if (tokenUsage || contextStats || executionStats || delegationStats || performanceStats) {
                    const usageItems: Array<{ label: string; value: string; ok: boolean }> = [];
                    if (tokenUsage) {
                      const promptTokens = Math.max(0, Number(tokenUsage.promptTokens || 0));
                      const completionTokens = Math.max(0, Number(tokenUsage.completionTokens || 0));
                      const totalTokens = Math.max(0, Number(tokenUsage.totalTokens || (promptTokens + completionTokens)));
                      usageItems.push(
                        { label: 'Prompt Tokens', value: String(promptTokens), ok: true },
                        { label: 'Completion Tokens', value: String(completionTokens), ok: true },
                        { label: 'Total Tokens', value: String(totalTokens), ok: true },
                        { label: '统计方式', value: tokenUsage.estimated ? '估算' : '模型返回', ok: true },
                      );
                    }
                    if (contextStats) {
                      const compactionCount = Math.max(0, Number(contextStats.compactionCount || 0));
                      const droppedMessages = Math.max(0, Number(contextStats.droppedMessages || 0));
                      const overflowRecoveryCount = Math.max(0, Number(contextStats.overflowRecoveryCount || 0));
                      usageItems.push(
                        { label: '上下文压缩次数', value: String(compactionCount), ok: compactionCount === 0 || droppedMessages > 0 },
                        { label: '压缩历史消息数', value: String(droppedMessages), ok: true },
                        { label: '超限自动恢复', value: String(overflowRecoveryCount), ok: overflowRecoveryCount === 0 || compactionCount > 0 },
                      );
                      if (contextStats.policy) {
                        usageItems.push(
                          { label: '上下文预算', value: `${Math.max(0, Number(contextStats.policy.contextTokens || 0))} tokens`, ok: true },
                          { label: '历史占比上限', value: `${Number(contextStats.policy.maxHistoryShare || 0).toFixed(2)}`, ok: true },
                          { label: 'Soft/Hard 阈值', value: `${Number(contextStats.policy.softTrimRatio || 0).toFixed(2)} / ${Number(contextStats.policy.hardClearRatio || 0).toFixed(2)}`, ok: true },
                          { label: '保留助手消息', value: `${Math.max(0, Number(contextStats.policy.keepLastAssistants || 0))} 条`, ok: true },
                        );
                      }
                    }
                    if (executionStats) {
                      const boardToolCalls = Math.max(0, Number(executionStats.boardToolCalls || 0));
                      const localToolCalls = Math.max(0, Number(executionStats.localToolCalls || 0));
                      const totalCalls = boardToolCalls + localToolCalls;
                      usageItems.push(
                        { label: '实际执行（板端）', value: `${boardToolCalls} 次`, ok: boardToolCalls > 0 || totalCalls === 0 },
                        { label: '实际执行（本地）', value: `${localToolCalls} 次`, ok: true },
                      );
                      if (Array.isArray(executionStats.toolCallNames) && executionStats.toolCallNames.length > 0) {
                        usageItems.push({
                          label: '实际调用工具',
                          value: executionStats.toolCallNames.join(' / '),
                          ok: true,
                        });
                      }
                    }
                    if (delegationStats) {
                      const delegationConfidence = Number.isFinite(Number(delegationStats.confidence))
                        ? `${Math.round(Math.max(0, Math.min(1, Number(delegationStats.confidence))) * 100)}%`
                        : 'N/A';
                      const canLocalComplete = Boolean(delegationStats.canLocalComplete);
                      const needsBoardCollaboration = Boolean(delegationStats.needsBoardCollaboration);
                      usageItems.push(
                        { label: '任务路径判定', value: String(delegationStats.mode || '未提供'), ok: true },
                        { label: '执行路径说明', value: String(delegationStats.expected || '未提供'), ok: true },
                        { label: '决策置信度', value: delegationConfidence, ok: true },
                        { label: '本地可独立完成', value: canLocalComplete ? '是' : '否', ok: canLocalComplete },
                        { label: '需要板端协同', value: needsBoardCollaboration ? '是' : '否', ok: !needsBoardCollaboration || Boolean(currentDevice?.id) },
                      );
                    }
                    if (performanceStats) {
                      const firstEventMs = Number(performanceStats.firstEventMs);
                      const firstTextDeltaMs = Number(performanceStats.firstTextDeltaMs);
                      usageItems.push(
                        { label: '首事件耗时', value: Number.isFinite(firstEventMs) ? `${Math.max(0, Math.round(firstEventMs))} ms` : 'N/A', ok: true },
                        { label: '首文本耗时', value: Number.isFinite(firstTextDeltaMs) ? `${Math.max(0, Math.round(firstTextDeltaMs))} ms` : 'N/A', ok: true },
                        { label: '总耗时', value: `${Math.max(0, Math.round(Number(performanceStats.totalElapsedMs || 0)))} ms`, ok: true },
                        { label: '准备阶段', value: `${Math.max(0, Math.round(Number(performanceStats.setupElapsedMs || 0)))} ms（workspace ${Math.max(0, Math.round(Number(performanceStats.workspaceInitMs || 0)))} / attachment ${Math.max(0, Math.round(Number(performanceStats.attachmentPrepareMs || 0)))} / board ${Math.max(0, Math.round(Number(performanceStats.boardSnapshotMs || 0)))}）`, ok: true },
                      );
                    }
                    if (usageItems.length > 0) {
                      aiBlocks.push({
                        type: 'status',
                        collapsible: true,
                        defaultCollapsed: true,
                        summary: '本轮资源消耗',
                        items: usageItems,
                      });
                      updateAiMessage(aiText, aiBlocks);
                    }
                  }
                }
                break;
            }
          },
        );
        streamAbortRef.current = abort;

        await done;
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

  const stopCurrentRun = () => {
    abortInFlightRun(true);
  };

  const backgroundCurrentRun = () => {
    const runId = currentRunIdRef.current;
    const nextSessionId = `ui-${Date.now()}`;
    persistSessionId(nextSessionId);
    reportActiveSession('background-detach');
    if (runId) {
      setBackgroundRuns((prev) => {
        if (prev.some((item) => item.runId === runId)) return prev;
        const next: typeof prev = [{ runId, status: 'running' as const, detachedAt: Date.now() }, ...prev].slice(0, 20);
        return next;
      });
    }
    setAiTyping(false);
    commandLockRef.current = false;
    setChatMessages((prev) => [...prev, {
      id: Date.now(),
      role: 'ai',
      text: '当前任务已转入后台继续执行，你可以直接继续新的对话。',
      blocks: [{
        type: 'task-result',
        success: true,
        title: '任务已转后台',
        detail: runId
          ? `后台运行中（runId: ${runId}），已切换到新会话继续对话`
          : '已切换到新会话继续对话',
      }],
    }]);
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
      text: '后台任务已结束。',
      blocks: [{
        type: 'task-result',
        success: false,
        title: '后台任务已结束',
        detail: `runId: ${runId}`,
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
      const title = detail.title || '系统推送';
      const message = detail.message || '收到新的系统事件';
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
        const executorLabel = payload.executor === 'board_openclaw' ? '板端 OpenClaw' : payload.executor ? String(payload.executor) : 'RDKClaw';
        if (payload.rdkEventKind === 'tool_start' || payload.rdkEventKind === 'tool_progress' || payload.rdkEventKind === 'tool_result') {
          const phaseText = payload.rdkEventKind === 'tool_start'
            ? '开始执行'
            : payload.rdkEventKind === 'tool_progress'
              ? '执行中'
              : (payload.isError ? '执行失败' : '执行完成');
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
                    items: [{ label: `飞书流程 · ${toolName}`, value: `${executorLabel} · ${phaseText}`, ok: true }],
                  },
                  ...(lines.length > 0 ? [{
                    type: 'terminal' as const,
                    label: `${toolName} · 实时反馈`,
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
                    label: `飞书流程 · ${toolName}`,
                    value: `${executorLabel} · ${phaseText}`,
                    ok: payload.rdkEventKind !== 'tool_result' || !payload.isError,
                  };
                }
              } else {
                nextBlocks.unshift({
                  type: 'status',
                  items: [{ label: `飞书流程 · ${toolName}`, value: `${executorLabel} · ${phaseText}`, ok: payload.rdkEventKind !== 'tool_result' || !payload.isError }],
                });
              }
              const terminalIdx = nextBlocks.findIndex((b) => b.type === 'terminal');
              if (terminalIdx >= 0) {
                const terminalBlock = nextBlocks[terminalIdx];
                if (terminalBlock?.type === 'terminal') {
                  terminalBlock.label = `${toolName} · 实时反馈`;
                  terminalBlock.lines = dedupeLines(terminalBlock.lines, lines);
                }
              } else if (lines.length > 0) {
                nextBlocks.push({
                  type: 'terminal',
                  label: `${toolName} · 实时反馈`,
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
                  items: [{ label: `飞书流程 · ${toolName}`, value: `${executorLabel} · ${phaseText}`, ok: payload.rdkEventKind !== 'tool_result' || !payload.isError }],
                },
                ...(lines.length > 0 ? [{
                  type: 'terminal' as const,
                  label: `${toolName} · 实时反馈`,
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
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask, handleApprovalAction, handleRecommendationChoice, stopCurrentRun, backgroundCurrentRun,
    backgroundRuns, stopBackgroundRun,
  };

  return React.createElement(AIChatContext.Provider, { value }, children);
}
