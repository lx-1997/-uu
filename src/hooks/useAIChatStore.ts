import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatBlock, AgentPlan, AgentExecutionState } from '../app-types';
import { CMD_SUGGESTIONS } from '../constants';
import { fetchAIReply, fetchAgentPlan, runOpenClawAgentAction } from '../api';
import { orchestrate } from '../ai';
import type { AppActions, Task, IntentId } from '../ai';
import { useToastStore } from './useToastStore';
import { useDeviceStore } from './useDeviceStore';
import { useUIStore } from './useUIStore';
import { useTerminalStore } from './useTerminalStore';

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
}

const AIChatContext = createContext<AIChatStoreState | null>(null);

export function useAIChatStore(): AIChatStoreState {
  const ctx = useContext(AIChatContext);
  if (!ctx) throw new Error('useAIChatStore must be used within AIChatProvider');
  return ctx;
}

export function AIChatProvider({ children }: { children: React.ReactNode }) {
  const { addToast, addActivity } = useToastStore();
  const { currentDevice, scanForDevices } = useDeviceStore();
  const {
    activeTab, setActiveTab, openWorkspace,
    startFlash, appendTransferTask, startVncSession, runFlowValidation,
    setDiagnosticOpen, setDiagnosticStep, setRosRecording, setShowSettings,
  } = useUIStore();
  const { createSession, runTerminalCommand } = useTerminalStore();

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

  // ── Task animation ──
  const startTaskAnimation = (task: Task, resultTitle: string, resultDetail: string, extraBlocks?: ChatBlock[]) => {
    const runningTask: Task = { ...task, status: 'running' };
    setTaskHistory(prev => [runningTask, ...prev].slice(0, 20));
    activeTaskCountRef.current++;

    const progressMsgId = Date.now() + Math.random() * 1000;
    const taskLabel = (() => {
      const labels: Record<string, string> = {
        flash: '镜像烧录', terminal: '终端', terminal_cmd: '执行命令',
        file_upload: '文件上传', file_download: '文件下载', vnc: '远程桌面',
        openclaw_start: 'OpenClaw', openclaw_status: 'OpenClaw 状态',
        openclaw_switch: '切换模型', hardware_check: '硬件诊断',
        ros_scan: 'ROS2 扫描', ros_record_start: 'ROS 录制',
        model_deploy: '模型部署', model_list: '模型列表',
        example_run: '运行示例', workflow: '流程编排',
        device_scan: '设备扫描',
      };
      return labels[task.capabilityId] || task.capabilityId;
    })();

    setChatMessages(prev => [...prev, {
      id: progressMsgId,
      role: 'ai',
      text: `⚡ ${taskLabel} — 正在执行...`,
      blocks: [{ type: 'progress', steps: task.steps, taskId: task.id }],
    }]);

    let step = 0;
    const totalSteps = task.steps.length;
    const iv = window.setInterval(() => {
      if (cancelledTasksRef.current.has(task.id)) {
        clearInterval(iv);
        return;
      }
      step++;
      if (step < totalSteps) {
        const updated = task.steps.map((s, i) => ({
          label: s.label,
          status: (i < step ? 'done' : i === step ? 'running' : 'pending') as 'done' | 'running' | 'pending',
        }));
        setChatMessages(prev => prev.map(m =>
          m.id === progressMsgId ? { ...m, blocks: [{ type: 'progress', steps: updated, taskId: task.id }] } : m,
        ));
        setTaskHistory(prev => prev.map(t =>
          t.id === task.id ? { ...t, steps: updated, status: 'running' } : t,
        ));
      } else {
        clearInterval(iv);
        delete taskIntervalsRef.current[task.id];
        const allDone = task.steps.map(s => ({ label: s.label, status: 'done' as const }));
        setChatMessages(prev => prev.map(m =>
          m.id === progressMsgId ? { ...m, text: `✅ ${taskLabel} — 执行完成`, blocks: [{ type: 'progress', steps: allDone, taskId: task.id }] } : m,
        ));
        setTaskHistory(prev => prev.map(t =>
          t.id === task.id ? { ...t, steps: allDone, status: 'done', result: { success: true, title: resultTitle, detail: resultDetail } } : t,
        ));
        activeTaskCountRef.current = Math.max(0, activeTaskCountRef.current - 1);
        setTimeout(() => {
          const resultBlocks: ChatMessage['blocks'] = [
            { type: 'task-result', success: true, title: resultTitle, detail: resultDetail },
          ];
          if (extraBlocks) resultBlocks.push(...extraBlocks);
          setChatMessages(prev => [...prev, {
            id: Date.now() + Math.random() * 1000, role: 'ai', text: `${taskLabel}完成！`, blocks: resultBlocks,
          }]);
          if (activeTaskCountRef.current === 0) {
            setAiTyping(false);
          }
        }, 400);
      }
    }, 800);
    taskIntervalsRef.current[task.id] = iv;
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
    setChatMessages(prev => prev.map(m => {
      const hasTask = m.blocks?.some(b => b.type === 'progress' && 'taskId' in b && b.taskId === taskId);
      if (!hasTask) return m;
      return {
        ...m,
        text: `⛔ ${m.text?.replace(/^⚡\s*/, '').replace(/ — .+$/, '')} — 已取消`,
        blocks: m.blocks?.map(b =>
          b.type === 'progress' && 'taskId' in b && b.taskId === taskId
            ? { ...b, steps: b.steps.map(s => s.status === 'running' ? { ...s, status: 'pending' as const } : s) }
            : b
        ),
      };
    }));
    addToast('任务已取消', 'info');
  };

  // ── OpenClaw board-side helpers ──
  const openClawStartOnBoard = async () => {
    const result = await runOpenClawAgentAction('start', { host: currentDevice?.ip, username: 'root' });
    if (result.error) {
      addToast(`OpenClaw 启动失败: ${result.error}`, 'error');
      addActivity(`OpenClaw 板端启动失败: ${result.error}`);
      return { ok: false, error: result.error };
    }
    const output = 'output' in result ? result.output : '';
    addToast('OpenClaw 板端启动完成', 'success');
    addActivity('OpenClaw 板端启动完成');
    return { ok: true, output };
  };

  const openClawStatusOnBoard = async () => {
    const result = await runOpenClawAgentAction('status', { host: currentDevice?.ip, username: 'root' });
    if (result.error) {
      addToast(`OpenClaw 状态读取失败: ${result.error}`, 'warning');
      addActivity(`OpenClaw 状态读取失败: ${result.error}`);
      return { ok: false, error: result.error };
    }
    const output = 'output' in result ? result.output : '';
    addToast('OpenClaw 状态已刷新', 'success');
    addActivity('OpenClaw 状态刷新完成');
    return { ok: true, output };
  };

  const openClawSwitchOnBoard = async (modelName: string) => {
    const result = await runOpenClawAgentAction('switch', { modelName, host: currentDevice?.ip, username: 'root' });
    if (result.error) {
      addToast(`OpenClaw 切换失败: ${result.error}`, 'error');
      addActivity(`OpenClaw 模型切换失败: ${result.error}`);
      return { ok: false, error: result.error };
    }
    const output = 'output' in result ? result.output : '';
    addToast(`OpenClaw 已切换到 ${modelName}`, 'success');
    addActivity(`OpenClaw 模型切换完成: ${modelName}`);
    return { ok: true, output };
  };

  // ── Agent step runner ──
  const intentWhitelist = new Set<IntentId>([
    'flash', 'terminal', 'terminal_cmd', 'file_upload', 'file_download', 'vnc',
    'openclaw_start', 'openclaw_status', 'openclaw_switch', 'hardware_check',
    'ros_scan', 'ros_record_start', 'ros_record_stop', 'model_deploy', 'model_list',
    'example_run', 'workflow', 'device_scan', 'nav', 'settings', 'general',
  ]);

  const commandLockRef = useRef(false);

  const buildActions = (): AppActions => ({
    openWorkspace, setActiveTab,
    startFlash, createSession, runTerminalCommand,
    appendTransferTask, startVncSession, runFlowValidation,
    setDiagnosticOpen, setDiagnosticStep,
    setRosRecording, scanForDevices,
    openClawStartOnBoard, openClawStatusOnBoard, openClawSwitchOnBoard,
    setShowSettings,
    addToast, addActivity,
    currentDeviceName: currentDevice?.name ?? '未连接设备',
    currentDeviceIp: currentDevice?.ip ?? 'N/A',
  });

  const runAgentStep = async (userMsg: string, step: { title: string; intent: string; param?: string; reason: string }, actions: AppActions, msgId: number) => {
    const intent = intentWhitelist.has(step.intent as IntentId) ? (step.intent as IntentId) : 'general';

    const emitStepResult = (ok: boolean, detail: string) => {
      setChatMessages(prev => [...prev, {
        id: msgId + Math.random() * 1000,
        role: 'ai',
        text: `${ok ? '✅' : '❌'} ${step.title}`,
        blocks: [{ type: 'task-result', success: ok, title: step.title, detail }],
      }]);
    };

    if (intent === 'openclaw_start' || intent === 'openclaw_status' || intent === 'openclaw_switch') {
      let result = intent === 'openclaw_start'
        ? await actions.openClawStartOnBoard()
        : intent === 'openclaw_status'
          ? await actions.openClawStatusOnBoard()
          : await actions.openClawSwitchOnBoard(step.param || 'qwen3.5-plus');

      if (!result.ok) {
        result = intent === 'openclaw_start'
          ? await actions.openClawStartOnBoard()
          : intent === 'openclaw_status'
            ? await actions.openClawStatusOnBoard()
            : await actions.openClawSwitchOnBoard(step.param || 'qwen3.5-plus');
      }

      emitStepResult(!!result.ok, result.ok ? (result.output || '板端执行成功') : (result.error || '板端执行失败'));
      return !!result.ok;
    }

    const aiResponse = `${step.title}[[intent:${intent}${step.param ? `|${step.param}` : ''}]]`;

    const output = orchestrate({
      aiResponse,
      userText: userMsg,
      actions,
      registerConfirm: (confirmId, action) => {
        pendingActionsRef.current[confirmId] = action;
      },
      startTaskAnimation,
    });

    setChatMessages(prev => [...prev, {
      id: msgId + Math.random() * 1000,
      role: 'ai',
      text: output.text || `执行步骤：${step.title}`,
      blocks: output.blocks,
    }]);

    if (output.sideEffect) {
      setTimeout(() => output.sideEffect?.(), 200);
    }
    return true;
  };

  // ── Main command handler ──
  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim() || commandLockRef.current) return;
    const userMsg = cmd.trim();
    const msgId = Date.now();
    setChatMessages(prev => [...prev, { id: msgId, role: 'user', text: userMsg }]);
    setChatExpanded(true);
    setCmd('');
    setShowSuggestions(false);
    setAiTyping(true);
    commandLockRef.current = true;

    (async () => {
      try {
        const lower = userMsg.toLowerCase();
        const askEnableAgent = /(开启|启用|进入).*(agent|智能服务|自动调度)/i.test(userMsg) || lower === '/agent on';
        const askDisableAgent = /(关闭|退出).*(agent|智能服务|自动调度)/i.test(userMsg) || lower === '/agent off';
        const askStopAgent = /(停止|中止|取消).*(agent|计划|自动执行)/i.test(userMsg) || lower === '/agent stop';
        const askAgentStatus = /(agent状态|当前计划|执行进度)/i.test(userMsg) || lower === '/agent status';

        if (askEnableAgent) {
          setAgentMode(true);
          setChatMessages(prev => [...prev, { id: msgId + 1, role: 'ai', text: '已开启 Agent 模式。我会先规划再自动调度执行，并实时回传进度。' }]);
          setAiTyping(false);
          return;
        }
        if (askDisableAgent) {
          setAgentMode(false);
          setAgentPlan(null);
          setAgentExecution({ running: false, currentStep: 0, totalSteps: 0 });
          agentAbortRef.current = false;
          setChatMessages(prev => [...prev, { id: msgId + 1, role: 'ai', text: 'Agent 模式已关闭，恢复为普通对话执行模式。' }]);
          setAiTyping(false);
          return;
        }
        if (askStopAgent) {
          agentAbortRef.current = true;
          setAgentExecution(prev => ({ ...prev, running: false }));
          setChatMessages(prev => [...prev, { id: msgId + 1, role: 'ai', text: '已收到中止指令，正在停止后续自动步骤。' }]);
          setAiTyping(false);
          return;
        }
        if (askAgentStatus) {
          const running = taskHistory.filter(t => t.status === 'running').length;
          const stepCount = agentPlan?.steps.length ?? 0;
          setChatMessages(prev => [...prev, {
            id: msgId + 1,
            role: 'ai',
            text: `Agent 状态：${agentMode ? '开启' : '关闭'}；当前计划 ${stepCount} 步；并行任务 ${running} 个。`,
            blocks: agentPlan ? [{
              type: 'status',
              items: [
                { label: '计划摘要', value: agentPlan.summary, ok: true },
                { label: '风险提示', value: agentPlan.risk, ok: true },
                { label: '完成判定', value: agentPlan.done, ok: true },
              ],
            }] : undefined,
          }]);
          setAiTyping(false);
          return;
        }

        const actions = buildActions();

        if (agentMode) {
          const plan = await fetchAgentPlan(userMsg, currentDevice?.name, currentDevice?.ip);

          if (plan?.steps?.length) {
            agentAbortRef.current = false;
            setAgentPlan(plan);
            setAgentExecution({ running: true, currentStep: 0, totalSteps: plan.steps.length });

            setChatMessages(prev => [...prev, {
              id: msgId + 1,
              role: 'ai',
              text: `Agent 计划已生成：${plan.summary}`,
              blocks: [{
                type: 'status',
                items: [
                  { label: '步骤数', value: `${plan.steps.length} 步`, ok: true },
                  { label: '风险', value: plan.risk, ok: true },
                  { label: '完成标准', value: plan.done, ok: true },
                ],
              }],
            }]);

            for (let idx = 0; idx < plan.steps.length; idx++) {
              if (agentAbortRef.current) {
                setAgentExecution(prev => ({ ...prev, running: false, currentStep: idx }));
                setChatMessages(prev => [...prev, { id: msgId + 2 + idx, role: 'ai', text: `Agent 已在第 ${idx + 1} 步前停止。` }]);
                break;
              }
              const step = plan.steps[idx];
              setAgentExecution(prev => ({ ...prev, currentStep: idx + 1, running: true }));
              const ok = await runAgentStep(userMsg, step, actions, msgId + 1000 + idx * 100);
              if (!ok) {
                const err = `步骤失败：${step.title}`;
                setAgentExecution(prev => ({ ...prev, running: false, lastError: err }));
                setChatMessages(prev => [...prev, { id: msgId + 9000 + idx, role: 'ai', text: `Agent 已停止：${err}` }]);
                agentAbortRef.current = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 450));
            }

            if (!agentAbortRef.current) {
              setAgentExecution(prev => ({ ...prev, running: false, currentStep: prev.totalSteps }));
              setChatMessages(prev => [...prev, { id: msgId + 9999, role: 'ai', text: 'Agent 自动调度已执行完当前计划。你可以继续下一个目标。' }]);
            }

            if (activeTaskCountRef.current === 0) {
              setAiTyping(false);
            }
            return;
          }

          addToast('Agent 规划失败，已切换为普通执行', 'warning');
        }

        const history = chatMessages.slice(-6).map(m => ({
          role: m.role as string,
          content: m.text,
        }));
        history.push({ role: 'user', content: userMsg });
        const aiRaw = await fetchAIReply(history, currentDevice?.name, currentDevice?.ip);

        if (aiRaw === null) {
          addToast('AI 助手暂时离线，使用本地匹配', 'warning');
        }

        const output = orchestrate({
          aiResponse: aiRaw,
          userText: userMsg,
          actions,
          registerConfirm: (confirmId, action) => {
            pendingActionsRef.current[confirmId] = action;
          },
          startTaskAnimation,
        });

        setChatMessages(prev => [...prev, {
          id: msgId + 1, role: 'ai', text: output.text, blocks: output.blocks,
        }]);

        if (activeTaskCountRef.current === 0) {
          setAiTyping(false);
        }

        if (output.sideEffect) {
          setTimeout(() => output.sideEffect!(), 300);
        }
      } finally {
        commandLockRef.current = false;
      }
    })();
  };

  // ── Effects ──

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
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask,
  };

  return React.createElement(AIChatContext.Provider, { value }, children);
}
