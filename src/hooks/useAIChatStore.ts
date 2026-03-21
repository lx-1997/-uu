import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatBlock, AgentPlan, AgentExecutionState } from '../app-types';
import { CMD_SUGGESTIONS } from '../constants';
import { streamAgentChat, type AgentSSEEvent } from '../api';
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
    const msgId = Date.now();
    setChatMessages(prev => [...prev, { id: msgId, role: 'user', text: userMsg }]);
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

        // ── Agent Loop (SSE) — primary path ──
        const aiMsgId = msgId + 1;
        let aiText = '';
        const aiBlocks: ChatBlock[] = [];

        setChatMessages(prev => [...prev, {
          id: aiMsgId, role: 'ai', text: '', blocks: [],
        }]);

        const updateAiMessage = (text: string, blocks: ChatBlock[]) => {
          setChatMessages(prev => prev.map(m =>
            m.id === aiMsgId ? { ...m, text, blocks: [...blocks] } : m
          ));
        };

        const { done } = streamAgentChat(
          userMsg,
          currentDevice?.id,
          undefined,
          (event: AgentSSEEvent) => {
            switch (event.type) {
              case 'text': {
                aiText += (event.data.delta as string) || '';
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'tool_start': {
                const toolName = event.data.toolName as string;
                const args = event.data.args as Record<string, unknown>;
                const argStr = summarizeToolArgs(args);
                aiBlocks.push({
                  type: 'status',
                  items: [
                    { label: toolName, value: `执行中... ${argStr}`, ok: true },
                  ],
                });
                updateAiMessage(aiText, aiBlocks);
                break;
              }
              case 'tool_result': {
                const toolName = event.data.toolName as string;
                const result = (event.data.result as string) || '';
                const isError = event.data.isError as boolean;
                const lastBlock = aiBlocks[aiBlocks.length - 1];
                if (lastBlock?.type === 'status' && lastBlock.items?.[0]?.label === toolName) {
                  aiBlocks.pop();
                }
                if (result.includes('\n') || result.length > 100) {
                  aiBlocks.push({
                    type: 'terminal',
                    lines: result.split('\n').slice(0, 60),
                    label: toolName,
                  });
                } else {
                  aiBlocks.push({
                    type: 'status',
                    items: [{ label: toolName, value: result || (isError ? '失败' : '完成'), ok: !isError }],
                  });
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

        await done;
        setAiTyping(false);
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
