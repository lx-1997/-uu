import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Tab, Device, Toast, TerminalSession, TransferItem, Activity, ChatMessage, ConfirmDialogState, ChatBlock, AgentPlan, AgentExecutionState } from '../app-types';
import { MOCK_DEVICES, TERMINAL_PROFILES, FLASH_IMAGES, CMD_SUGGESTIONS } from '../constants';
import { fetchAIReply, fetchAgentPlan, runOpenClawAgentAction } from '../api';
import { orchestrate } from '../ai';
import type { AppActions, Task, IntentId } from '../ai';

// ---- State shape ----
export interface AppState {
  // Device
  activeDevice: string;
  setActiveDevice: (id: string) => void;
  devices: Device[];
  setDevices: React.Dispatch<React.SetStateAction<Device[]>>;
  currentDevice: Device | undefined;

  // Navigation
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;

  // Loading
  isLoading: boolean;
  loadingMsg: string;
  openWorkspace: (tab: Tab, message: string) => void;

  // Flash
  flashImage: string;
  setFlashImage: (v: string) => void;
  flashTarget: string;
  setFlashTarget: (v: string) => void;
  flashMode: 'safe' | 'fast' | 'recover';
  setFlashMode: (v: 'safe' | 'fast' | 'recover') => void;
  flashVerify: boolean;
  setFlashVerify: (v: boolean) => void;
  flashBackup: boolean;
  setFlashBackup: (v: boolean) => void;
  flashProgress: number;
  flashPhase: string;
  isFlashing: boolean;
  flashStep: number;
  setFlashStep: (v: number) => void;
  startFlash: () => void;

  // Terminal
  terminalProfile: string;
  setTerminalProfile: (v: string) => void;
  terminalDraft: string;
  setTerminalDraft: (v: string) => void;
  terminalSessions: TerminalSession[];
  activeSessionId: string;
  setActiveSessionId: (v: string) => void;
  currentSession: TerminalSession;
  createSession: () => void;
  runTerminalCommand: (cmd: string) => void;
  runTerminalAIAnalysis: () => void;

  // Files / Transfer
  transferProtocol: string;
  fileAction: 'upload' | 'download' | 'sync';
  setFileAction: (v: 'upload' | 'download' | 'sync') => void;
  transferQueue: TransferItem[];
  appendTransferTask: () => void;

  // VNC
  vncQuality: 'smooth' | 'balanced' | 'sharp';
  setVncQuality: (v: 'smooth' | 'balanced' | 'sharp') => void;
  vncLayout: 'fit' | 'pixel' | 'dual';
  setVncLayout: (v: 'fit' | 'pixel' | 'dual') => void;
  vncOverlay: boolean;
  vncConnected: boolean;
  vncProgress: number;
  vncPhase: string;
  startVncSession: () => void;

  // Lowcode
  flowTemplate: string;
  setFlowTemplate: (v: string) => void;
  flowMode: 'draft' | 'review' | 'staging';
  setFlowMode: (v: 'draft' | 'review' | 'staging') => void;
  flowCheckProgress: number;
  isFlowChecking: boolean;
  runFlowValidation: () => void;

  // OpenClaw
  openclawMode: string;
  setOpenclawMode: (v: string) => void;
  openclawThreshold: number;

  // Hardware
  hardwareRange: 'realtime' | '10m' | '1h';
  setHardwareRange: (v: 'realtime' | '10m' | '1h') => void;

  // Examples
  examplePreset: string;
  setExamplePreset: (v: string) => void;

  // ROS
  rosTopic: string;
  setRosTopic: (v: string) => void;
  rosRecording: boolean;
  setRosRecording: (v: boolean) => void;

  // Diagnostics
  diagnosticOpen: boolean;
  setDiagnosticOpen: (v: boolean) => void;
  diagnosticStep: number;
  setDiagnosticStep: (v: number) => void;

  // Toasts / Activity
  toasts: Toast[];
  addToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  activities: Activity[];
  addActivity: (text: string) => void;

  // Modals
  showAddDevice: boolean;
  setShowAddDevice: (v: boolean) => void;
  newDeviceName: string;
  setNewDeviceName: (v: string) => void;
  newDeviceIp: string;
  setNewDeviceIp: (v: string) => void;
  isScanning: boolean;
  scannedDevices: Array<{ name: string; ip: string }>;
  scanForDevices: () => void;
  addNewDevice: () => void;
  addScannedDevice: (dev: { name: string; ip: string }) => void;
  removeDevice: (id: string) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  settingsTab: 'general' | 'connection' | 'about';
  setSettingsTab: (v: 'general' | 'connection' | 'about') => void;
  autoReconnect: boolean;
  setAutoReconnect: (v: boolean) => void;
  connectionTimeout: number;
  setConnectionTimeout: (v: number) => void;
  language: string;
  setLanguage: (v: string) => void;
  confirmDialog: ConfirmDialogState | null;
  setConfirmDialog: (v: ConfirmDialogState | null) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;

  // AI Chat
  cmd: string;
  setCmd: (v: string) => void;
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  filteredSuggestions: typeof CMD_SUGGESTIONS;
  chatMessages: ChatMessage[];
  chatExpanded: boolean;
  setChatExpanded: (v: boolean) => void;
  aiTyping: boolean;
  handleCommand: (e: React.FormEvent) => void;
  executeConfirm: (confirmId: string) => void;
  dismissConfirm: (confirmId: string) => void;
  clearChatHistory: () => void;
  agentMode: boolean;
  setAgentMode: (v: boolean) => void;
  agentPlan: AgentPlan | null;
  agentExecution: AgentExecutionState;

  // Task tracking
  taskHistory: Task[];
  showTaskPanel: boolean;
  setShowTaskPanel: (v: boolean) => void;
  cancelRunningTask: (taskId: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  // ---- Device ----
  const [activeDevice, setActiveDevice] = useState(MOCK_DEVICES[0].id);
  const [devices, setDevices] = useState<Device[]>(MOCK_DEVICES);
  const currentDevice = devices.find((d) => d.id === activeDevice);

  // ---- Navigation ----
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  // ---- Loading ----
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const openWorkspace = (nextTab: Tab, message: string) => {
    setIsLoading(true);
    setLoadingMsg(message);
    window.setTimeout(() => { setActiveTab(nextTab); setIsLoading(false); }, 400);
  };

  // ---- Flash ----
  const [flashImage, setFlashImage] = useState('ubuntu-22.04');
  const [flashTarget, setFlashTarget] = useState('sd');
  const [flashMode, setFlashMode] = useState<'safe' | 'fast' | 'recover'>('safe');
  const [flashVerify, setFlashVerify] = useState(true);
  const [flashBackup, setFlashBackup] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);
  const [flashPhase, setFlashPhase] = useState('等待开始');
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashStep, setFlashStep] = useState(1);

  // ---- Terminal ----
  const [terminalProfile, setTerminalProfile] = useState('shell');
  const [terminalDraft, setTerminalDraft] = useState('');
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([
    { id: 'session-1', name: '主会话', profile: 'shell', status: 'attached', lines: ['Welcome to RDK OS.', 'root@rdk:~#'] },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('session-1');
  const currentSession = terminalSessions.find((s) => s.id === activeSessionId) ?? terminalSessions[0];

  // ---- File Transfer ----
  const [transferProtocol] = useState('sftp');
  const [fileAction, setFileAction] = useState<'upload' | 'download' | 'sync'>('upload');
  const [transferQueue, setTransferQueue] = useState<TransferItem[]>([
    { id: 'queue-1', name: 'models/yolov5.bin', direction: '上传', progress: 100, status: 'done' },
    { id: 'queue-2', name: 'logs/run-2026-03-10.tar.gz', direction: '下载', progress: 42, status: 'running' },
  ]);

  // ---- VNC ----
  const [vncQuality, setVncQuality] = useState<'smooth' | 'balanced' | 'sharp'>('balanced');
  const [vncLayout, setVncLayout] = useState<'fit' | 'pixel' | 'dual'>('fit');
  const [vncOverlay] = useState(true);
  const [vncConnected, setVncConnected] = useState(false);
  const [vncProgress, setVncProgress] = useState(0);
  const [vncPhase, setVncPhase] = useState('等待连接');

  // ---- Lowcode ----
  const [flowTemplate, setFlowTemplate] = useState('vision');
  const [flowMode, setFlowMode] = useState<'draft' | 'review' | 'staging'>('draft');
  const [flowCheckProgress, setFlowCheckProgress] = useState(0);
  const [isFlowChecking, setIsFlowChecking] = useState(false);

  // ---- OpenClaw ----
  const [openclawMode, setOpenclawMode] = useState('model');
  const [openclawThreshold] = useState(74);

  // ---- Hardware ----
  const [hardwareRange, setHardwareRange] = useState<'realtime' | '10m' | '1h'>('realtime');

  // ---- Examples ----
  const [examplePreset, setExamplePreset] = useState('follow');

  // ---- ROS ----
  const [rosTopic, setRosTopic] = useState('/hobot_dnn/bbox');
  const [rosRecording, setRosRecording] = useState(false);

  // ---- Diagnostics ----
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [diagnosticStep, setDiagnosticStep] = useState(0);

  // ---- Toasts / Activity ----
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = useRef(0);
  const addToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  };
  const [activities, setActivities] = useState<Activity[]>([
    { id: 1, text: '系统就绪，RDK Studio 启动完成', time: '刚刚' },
    { id: 2, text: 'RDK X3 - Local 设备已连接', time: '2 分钟前' },
    { id: 3, text: 'OpenClaws 网关服务运行中', time: '5 分钟前' },
  ]);
  const addActivity = (text: string) => {
    setActivities((prev) => [{ id: Date.now(), text, time: '刚刚' }, ...prev].slice(0, 10));
  };

  // ---- Modals ----
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceIp, setNewDeviceIp] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scannedDevices, setScannedDevices] = useState<Array<{ name: string; ip: string }>>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'connection' | 'about'>('general');
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [connectionTimeout, setConnectionTimeout] = useState(30);
  const [language, setLanguage] = useState('zh-CN');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ show: true, title, message, onConfirm });
  };
  const scanForDevices = () => {
    setIsScanning(true);
    setScannedDevices([]);
    window.setTimeout(() => {
      setScannedDevices([
        { name: 'RDK X3 (新发现)', ip: '192.168.1.110' },
        { name: 'RDK Ultra - 测试台', ip: '192.168.1.120' },
      ]);
      setIsScanning(false);
      addToast('局域网扫描完成，发现 2 台设备', 'success');
    }, 2000);
  };
  const addNewDevice = () => {
    if (!newDeviceName.trim() || !newDeviceIp.trim()) {
      addToast('请填写设备名称和 IP 地址', 'warning');
      return;
    }
    const id = String(devices.length + 1);
    setDevices((prev) => [...prev, { id, name: newDeviceName, status: 'online', ip: newDeviceIp }]);
    setShowAddDevice(false);
    setNewDeviceName('');
    setNewDeviceIp('');
    addToast(`设备 "${newDeviceName}" 已添加`, 'success');
    addActivity(`添加设备: ${newDeviceName} (${newDeviceIp})`);
  };
  const addScannedDevice = (device: { name: string; ip: string }) => {
    const id = String(devices.length + 1);
    setDevices((prev) => [...prev, { id, name: device.name, status: 'online', ip: device.ip }]);
    addToast(`设备 "${device.name}" 已添加到列表`, 'success');
    addActivity(`通过扫描添加设备: ${device.name}`);
  };
  const removeDevice = (id: string) => {
    const dev = devices.find(d => d.id === id);
    if (!dev) return;
    showConfirm('删除设备', `确定要删除设备 "${dev.name}" 吗？`, () => {
      setDevices(prev => {
        const remaining = prev.filter(d => d.id !== id);
        if (activeDevice === id && remaining.length > 0) {
          setActiveDevice(remaining[0].id);
        }
        return remaining;
      });
      addToast(`设备 "${dev.name}" 已删除`, 'info');
      addActivity(`删除设备: ${dev.name}`);
    });
  };

  // ---- AI Chat ----
  const [cmd, setCmd] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('rdk-chat-history');
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        // Strip non-serializable blocks (confirm actions are lost on reload)
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

  // Task tracking
  const [taskHistory, setTaskHistory] = useState<Task[]>([]);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [agentExecution, setAgentExecution] = useState<AgentExecutionState>({ running: false, currentStep: 0, totalSteps: 0 });
  const agentAbortRef = useRef(false);

  const filteredSuggestions = cmd.trim()
    ? CMD_SUGGESTIONS.filter((s) => s.text.includes(cmd) || s.keyword.includes(cmd.toLowerCase()))
    : CMD_SUGGESTIONS;



  /* ── Execute a confirmed action ── */
  const executeConfirm = (confirmId: string) => {
    const action = pendingActionsRef.current[confirmId];
    if (!action) return;
    delete pendingActionsRef.current[confirmId];
    // Replace confirm block with "已确认" marker
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

  /* ── Dismiss a confirmation ── */
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

  /* ── Task animation: show progress → result in chat ── */
  const startTaskAnimation = (task: Task, resultTitle: string, resultDetail: string, extraBlocks?: ChatBlock[]) => {
    // Track task start
    const runningTask: Task = { ...task, status: 'running' };
    setTaskHistory(prev => [runningTask, ...prev].slice(0, 20));
    activeTaskCountRef.current++;

    const progressMsgId = Date.now() + Math.random() * 1000;
    const taskLabel = (() => {
      // Import-free label lookup from capability id
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
      // Guard: if task was cancelled, stop processing
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
          // Only clear typing indicator when ALL tasks are done
          if (activeTaskCountRef.current === 0) {
            setAiTyping(false);
          }
        }, 400);
      }
    }, 800);
    taskIntervalsRef.current[task.id] = iv;
  };

  /* ── Cancel a running task ── */
  const cancelRunningTask = (taskId: string) => {
    // 1. Clear interval
    if (taskIntervalsRef.current[taskId]) {
      clearInterval(taskIntervalsRef.current[taskId]);
      delete taskIntervalsRef.current[taskId];
    }
    // 2. Decrement active count
    activeTaskCountRef.current = Math.max(0, activeTaskCountRef.current - 1);
    if (activeTaskCountRef.current === 0) setAiTyping(false);
    // 3. Update task history
    setTaskHistory(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'cancelled' } : t,
    ));
    // 4. Update progress block in chat to show cancelled
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

  /* ── Orchestrator: handle one user command ── */
  const commandLockRef = useRef(false);
  const intentWhitelist = new Set<IntentId>([
    'flash', 'terminal', 'terminal_cmd', 'file_upload', 'file_download', 'vnc',
    'openclaw_start', 'openclaw_status', 'openclaw_switch', 'hardware_check',
    'ros_scan', 'ros_record_start', 'ros_record_stop', 'model_deploy', 'model_list',
    'example_run', 'workflow', 'device_scan', 'nav', 'settings', 'general',
  ]);

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
        // Retry once for flaky board/network cases
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
          setChatMessages(prev => [...prev, {
            id: msgId + 1,
            role: 'ai',
            text: '已开启 Agent 模式。我会先规划再自动调度执行，并实时回传进度。',
          }]);
          setAiTyping(false);
          return;
        }

        if (askDisableAgent) {
          setAgentMode(false);
          setAgentPlan(null);
          setAgentExecution({ running: false, currentStep: 0, totalSteps: 0 });
          agentAbortRef.current = false;
          setChatMessages(prev => [...prev, {
            id: msgId + 1,
            role: 'ai',
            text: 'Agent 模式已关闭，恢复为普通对话执行模式。',
          }]);
          setAiTyping(false);
          return;
        }

        if (askStopAgent) {
          agentAbortRef.current = true;
          setAgentExecution(prev => ({ ...prev, running: false }));
          setChatMessages(prev => [...prev, {
            id: msgId + 1,
            role: 'ai',
            text: '已收到中止指令，正在停止后续自动步骤。',
          }]);
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

        const actions: AppActions = {
          openWorkspace, setActiveTab,
          startFlash, createSession, runTerminalCommand,
          appendTransferTask, startVncSession, runFlowValidation,
          setDiagnosticOpen, setDiagnosticStep,
          setRosRecording, scanForDevices,
          openClawStartOnBoard, openClawStatusOnBoard, openClawSwitchOnBoard,
          setShowSettings,
          addToast, addActivity,
          currentDeviceName: currentDevice?.name ?? 'RDK X5',
          currentDeviceIp: currentDevice?.ip ?? '192.168.1.100',
        };

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
                setChatMessages(prev => [...prev, {
                  id: msgId + 2 + idx,
                  role: 'ai',
                  text: `Agent 已在第 ${idx + 1} 步前停止。`,
                }]);
                break;
              }

              const step = plan.steps[idx];
              setAgentExecution(prev => ({ ...prev, currentStep: idx + 1, running: true }));
              const ok = await runAgentStep(userMsg, step, actions, msgId + 1000 + idx * 100);
              if (!ok) {
                const err = `步骤失败：${step.title}`;
                setAgentExecution(prev => ({ ...prev, running: false, lastError: err }));
                setChatMessages(prev => [...prev, {
                  id: msgId + 9000 + idx,
                  role: 'ai',
                  text: `Agent 已停止：${err}`,
                }]);
                agentAbortRef.current = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 450));
            }

            if (!agentAbortRef.current) {
              setAgentExecution(prev => ({ ...prev, running: false, currentStep: prev.totalSteps }));
              setChatMessages(prev => [...prev, {
                id: msgId + 9999,
                role: 'ai',
                text: 'Agent 自动调度已执行完当前计划。你可以继续下一个目标。',
              }]);
            }

            if (activeTaskCountRef.current === 0) {
              setAiTyping(false);
            }
            return;
          }

          addToast('Agent 规划失败，已切换为普通执行', 'warning');
        }

        // 1. Build conversation history & call AI
        const history = chatMessages.slice(-6).map(m => ({
          role: m.role as string,
          content: m.text,
        }));
        history.push({ role: 'user', content: userMsg });
        const aiRaw = await fetchAIReply(history, currentDevice?.name, currentDevice?.ip);

        if (aiRaw === null) {
          addToast('AI 助手暂时离线，使用本地匹配', 'warning');
        }

        // 3. Orchestrate: intent → capability → handler → output
        const output = orchestrate({
          aiResponse: aiRaw,
          userText: userMsg,
          actions,
          registerConfirm: (confirmId, action) => {
            pendingActionsRef.current[confirmId] = action;
          },
          startTaskAnimation,
        });

        // 4. Emit AI message with blocks
        setChatMessages(prev => [...prev, {
          id: msgId + 1, role: 'ai', text: output.text, blocks: output.blocks,
        }]);

        // Only clear typing if no task animations are running
        if (activeTaskCountRef.current === 0) {
          setAiTyping(false);
        }

        // 5. Execute side effect (delayed for UI settle)
        if (output.sideEffect) {
          setTimeout(() => output.sideEffect!(), 300);
        }
      } finally {
        commandLockRef.current = false;
      }
    })();
  };


  // ---- Handlers ----
  const startFlash = () => {
    const doFlash = () => {
      setFlashProgress(0);
      setFlashPhase('准备扫描目标介质与系统镜像');
      setFlashStep(1);
      setIsFlashing(true);
      addToast('烧录流程已启动', 'info');
      addActivity(`开始烧录: ${FLASH_IMAGES.find((i) => i.id === flashImage)?.label || flashImage}`);
    };
    if (flashTarget === 'emmc') {
      showConfirm('⚠️ eMMC 烧录确认', '当前目标为 eMMC 内置存储，写入后将覆盖原有系统。此操作不可撤销，建议先备份重要数据。确认继续？', doFlash);
    } else {
      doFlash();
    }
  };

  const appendTransferTask = () => {
    const direction = fileAction === 'upload' ? '上传' : fileAction === 'download' ? '下载' : '同步';
    const name = fileAction === 'upload' ? 'configs/device-profile.yaml' : fileAction === 'download' ? 'userdata/trace.log' : 'workspace/rdk-demo/';
    setTransferQueue((prev) => [{ id: `queue-${prev.length + 1}`, name, direction, progress: 0, status: 'running' }, ...prev]);
    addToast(`${direction}任务已加入队列: ${name}`, 'info');
    addActivity(`新增${direction}任务: ${name}`);
  };

  const createSession = () => {
    const nextId = `session-${terminalSessions.length + 1}`;
    const profileLabel = TERMINAL_PROFILES.find((p) => p.id === terminalProfile)?.label ?? '系统 Shell';
    setTerminalSessions((prev) => [...prev, { id: nextId, name: `${profileLabel} ${prev.length}`, profile: terminalProfile, status: 'warm', lines: [`${profileLabel} 已建立上下文。`, 'root@rdk:~#'] }]);
    setActiveSessionId(nextId);
    addToast(`终端会话 "${profileLabel}" 已创建`, 'success');
    addActivity(`创建终端会话: ${profileLabel}`);
  };

  const runTerminalCommand = (commandText: string) => {
    if (!commandText.trim()) return;
    const nlPatterns: Array<{ match: RegExp; cmd: string }> = [
      { match: /查看.*话题|列出.*topic/i, cmd: 'ros2 topic list' },
      { match: /温度|发热|散热/i, cmd: 'cat /sys/class/thermal/thermal_zone0/temp' },
      { match: /内存|内存使用/i, cmd: 'free -h' },
      { match: /磁盘|存储空间/i, cmd: 'df -h' },
      { match: /进程|正在运行/i, cmd: 'top -bn1 | head -20' },
      { match: /日志|系统日志/i, cmd: 'tail -f /var/log/syslog' },
      { match: /网络|ip地址|ip 地址/i, cmd: 'ip addr show' },
      { match: /bpu|推理|加速器/i, cmd: 'hrut_smi' },
    ];
    const isNL = /[\u4e00-\u9fff]/.test(commandText) && !commandText.startsWith('/') && !commandText.includes('--');
    const nlHit = isNL ? nlPatterns.find((p) => p.match.test(commandText)) : null;
    const responseMap: Record<string, string[]> = {
      'ros2 topic list': ['/camera/color/image_raw', '/hobot_dnn/bbox', '/tf', '/cmd_vel'],
      hrut_smi: ['BPU0 68%', 'DDR 43%', 'TEMP 61.8C'],
      'tail -f /var/log/syslog': ['[mock] rsyslog 已进入跟随模式', '[mock] AI runtime ready'],
      'ls /userdata': ['models', 'records', 'cache', 'workspace'],
      top: ['CPU 31%  MEM 44%  Tasks 128', '[mock] 仅展示交互，不连接真实设备'],
      'cat /sys/class/thermal/thermal_zone0/temp': ['61800  (61.8°C)'],
      'free -h': ['              total   used   free', 'Mem:          8.0G   5.2G   2.8G'],
      'df -h': ['/dev/mmcblk0p3   28G  16G   12G  56%  /', '/dev/mmcblk0p4   32G  10G   22G  32%  /userdata'],
      'ip addr show': ['eth0: 192.168.1.100/24  UP', 'wlan0: <NO-CARRIER>  DOWN'],
      'ros2 node list': ['/hobot_dnn', '/mipi_cam', '/ros2_daemon', '/usb_cam_node'],
      'ros2 topic echo /hobot_dnn/bbox': ['[ai_msgs.PerceptionTargets] targets: [{type: "person", score: 0.92, bbox: [120,80,340,420]}]'],
      'ros2 bag record -a': ['[INFO] Subscribing to all topics... recording to rosbag2_2026_03_10/'],
      bputop: ['BPU0: 68%  |  Queue: 2  |  Freq: 1GHz  |  Temp: 61.8°C'],
      'dmesg | tail': ['[  12.001] hobot_bpu: initialized', '[  12.340] mipi_cam: stream ready'],
      'top -bn1 | head -20': ['PID  USER  CPU%  MEM%  CMD', '1284 root  23%   8%   hobot_dnn', '1301 root  12%   6%   mipi_cam'],
    };
    if (nlHit) {
      const output = responseMap[nlHit.cmd] ?? ['[执行完成]'];
      setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, lines: [...s.lines, `✨ AI 翻译: "${commandText}" → ${nlHit.cmd}`, `root@rdk:~# ${nlHit.cmd}`, ...output, 'root@rdk:~#'] } : s));
    } else {
      const output = responseMap[commandText] ?? ['[mock] 已接收命令，建议切换为真实 SSH 执行器后接入。'];
      setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, status: 'running', lines: [...s.lines, `root@rdk:~# ${commandText}`, ...output, 'root@rdk:~#'] } : s));
    }
    setTerminalDraft('');
  };

  const runTerminalAIAnalysis = () => {
    const lastLines = currentSession.lines.slice(-8).filter((l) => !l.startsWith('root@') && !l.startsWith('🤖'));
    const hasError = lastLines.some((l) => /error|fail|denied|not found/i.test(l));
    const analysis = hasError
      ? ['🔍 检测到异常输出，可能原因:', '   • 权限不足 — 尝试 sudo 执行', '   • 依赖缺失 — 运行 apt install 安装', '   • 路径错误 — 检查文件是否存在', '💡 建议: sudo !! 重试上一条命令']
      : ['🔍 终端输出分析:', `   • 共 ${currentSession.lines.length} 行输出，无明显错误`, '   • 系统状态正常，BPU/内存/网络指标在安全范围', '   • 建议: 定期运行 hrut_smi 监控硬件状态', '💡 一切正常，可继续操作。'];
    const allLines = ['🤖 ─── AI 分析 ───', ...analysis, '────────────', 'root@rdk:~#'];
    setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, lines: [...s.lines, '🤖 ─── AI 分析中... ───'] } : s));
    allLines.forEach((line, i) => {
      setTimeout(() => {
        setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, lines: i === 0 ? [...s.lines.slice(0, -1), line] : [...s.lines, line] } : s));
      }, (i + 1) * 200);
    });
    setTimeout(() => addToast('AI 分析完成', 'success'), allLines.length * 200 + 100);
  };

  const startVncSession = () => {
    setVncConnected(true);
    setVncProgress(8);
    setVncPhase('正在发起远程桌面握手');
    addToast('VNC 连接已发起', 'info');
    addActivity('发起 VNC 远程桌面连接');
  };

  const runFlowValidation = () => {
    setFlowCheckProgress(0);
    setIsFlowChecking(true);
    addToast('部署前检查已开始', 'info');
    addActivity('执行流程编排部署前检查');
  };

  const openClawStartOnBoard = async () => {
    const result = await runOpenClawAgentAction('start', { host: currentDevice?.ip, username: 'root' });
    if (result.error) {
      addToast(`OpenClaw 启动失败: ${result.error}`, 'error');
      addActivity(`OpenClaw 板端启动失败: ${result.error}`);
      return { ok: false, error: result.error };
    }
    addToast('OpenClaw 板端启动完成', 'success');
    addActivity('OpenClaw 板端启动完成');
    return { ok: true, output: result.output };
  };

  const openClawStatusOnBoard = async () => {
    const result = await runOpenClawAgentAction('status', { host: currentDevice?.ip, username: 'root' });
    if (result.error) {
      addToast(`OpenClaw 状态读取失败: ${result.error}`, 'warning');
      addActivity(`OpenClaw 状态读取失败: ${result.error}`);
      return { ok: false, error: result.error };
    }
    addToast('OpenClaw 状态已刷新', 'success');
    addActivity('OpenClaw 状态刷新完成');
    return { ok: true, output: result.output };
  };

  const openClawSwitchOnBoard = async (modelName: string) => {
    const result = await runOpenClawAgentAction('switch', { modelName, host: currentDevice?.ip, username: 'root' });
    if (result.error) {
      addToast(`OpenClaw 切换失败: ${result.error}`, 'error');
      addActivity(`OpenClaw 模型切换失败: ${result.error}`);
      return { ok: false, error: result.error };
    }
    addToast(`OpenClaw 已切换到 ${modelName}`, 'success');
    addActivity(`OpenClaw 模型切换完成: ${modelName}`);
    return { ok: true, output: result.output };
  };

  // ---- Effects ----

  // Persist chat history to localStorage
  useEffect(() => {
    try {
      // Keep last 50 messages to avoid bloating storage
      const toSave = chatMessages.slice(-50);
      localStorage.setItem('rdk-chat-history', JSON.stringify(toSave));
    } catch { /* quota exceeded — ignore */ }
  }, [chatMessages]);

  // Cleanup task intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(taskIntervalsRef.current).forEach(id => clearInterval(id));
      taskIntervalsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (chatExpanded) setChatExpanded(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const el = document.querySelector('.chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages, aiTyping]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        const input = document.querySelector('.cmd-input') as HTMLInputElement;
        input?.focus();
      }
      if (e.key === 'Escape') {
        if (chatExpanded) setChatExpanded(false);
        if (showSettings) setShowSettings(false);
        if (showAddDevice) setShowAddDevice(false);
        if (diagnosticOpen) setDiagnosticOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector('.cmd-input') as HTMLInputElement;
        input?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 't' && activeTab === 'terminal') {
        e.preventDefault();
        createSession();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setActiveTab(activeTab === 'terminal' ? 'dashboard' : 'terminal');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chatExpanded, showSettings, showAddDevice, diagnosticOpen, activeTab]);

  useEffect(() => {
    const viewport = document.querySelector('.canvas-viewport');
    if (viewport) viewport.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeTab]);

  useEffect(() => {
    if (!isFlashing) return;
    const timer = window.setInterval(() => {
      setFlashProgress((prev) => {
        const next = Math.min(prev + 12, 100);
        if (next < 20) { setFlashPhase('校验镜像与目标介质'); setFlashStep(2); }
        else if (next < 65) { setFlashPhase('写入系统分区与启动项'); setFlashStep(3); }
        else if (next < 100) { setFlashPhase(flashVerify ? '执行写后校验与启动检查' : '整理烧录报告与建议'); setFlashStep(4); }
        else { setFlashPhase('烧录流程完成，可进入首次启动向导'); setIsFlashing(false); addToast('🎉 烧录成功完成！可进入终端或文件管理器继续', 'success'); addActivity('系统镜像烧录完成'); }
        return next;
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [flashVerify, isFlashing]);

  useEffect(() => {
    const hasRunning = transferQueue.some((item) => item.status === 'running');
    if (!hasRunning) return;
    const timer = window.setInterval(() => {
      setTransferQueue((prev) => {
        let bumped = false;
        return prev.map((item) => {
          if (bumped || item.status !== 'running') return item;
          bumped = true;
          const next = Math.min(item.progress + 9, 100);
          return { ...item, progress: next, status: next >= 100 ? 'done' : 'running' };
        });
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [transferQueue]);

  useEffect(() => {
    if (!vncConnected || vncProgress >= 100) return;
    const timer = window.setInterval(() => {
      setVncProgress((prev) => {
        const next = Math.min(prev + 18, 100);
        if (next < 35) setVncPhase('协商分辨率与编码协议');
        else if (next < 75) setVncPhase('同步桌面帧缓冲与快捷键映射');
        else if (next < 100) setVncPhase('连接已稳定，正在启用辅助控制层');
        else { setVncPhase('远程桌面已接入'); addToast('🖥️ VNC 远程桌面连接成功', 'success'); addActivity('VNC 远程桌面连接就绪'); }
        return next;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [vncConnected, vncProgress]);

  useEffect(() => {
    if (!isFlowChecking) return;
    const timer = window.setInterval(() => {
      setFlowCheckProgress((prev) => {
        const next = Math.min(prev + 20, 100);
        if (next >= 100) setIsFlowChecking(false);
        return next;
      });
    }, 450);
    return () => window.clearInterval(timer);
  }, [isFlowChecking]);

  // ---- Context Value ----
  const value: AppState = {
    activeDevice, setActiveDevice, devices, setDevices, currentDevice,
    activeTab, setActiveTab,
    isLoading, loadingMsg, openWorkspace,
    flashImage, setFlashImage, flashTarget, setFlashTarget, flashMode, setFlashMode,
    flashVerify, setFlashVerify, flashBackup, setFlashBackup, flashProgress, flashPhase,
    isFlashing, flashStep, setFlashStep, startFlash,
    terminalProfile, setTerminalProfile, terminalDraft, setTerminalDraft,
    terminalSessions, activeSessionId, setActiveSessionId, currentSession,
    createSession, runTerminalCommand, runTerminalAIAnalysis,
    transferProtocol, fileAction, setFileAction, transferQueue, appendTransferTask,
    vncQuality, setVncQuality, vncLayout, setVncLayout, vncOverlay,
    vncConnected, vncProgress, vncPhase, startVncSession,
    flowTemplate, setFlowTemplate, flowMode, setFlowMode,
    flowCheckProgress, isFlowChecking, runFlowValidation,
    openclawMode, setOpenclawMode, openclawThreshold,
    hardwareRange, setHardwareRange,
    examplePreset, setExamplePreset,
    rosTopic, setRosTopic, rosRecording, setRosRecording,
    diagnosticOpen, setDiagnosticOpen, diagnosticStep, setDiagnosticStep,
    toasts, addToast, activities, addActivity,
    showAddDevice, setShowAddDevice, newDeviceName, setNewDeviceName, newDeviceIp, setNewDeviceIp,
    isScanning, scannedDevices, scanForDevices, addNewDevice, addScannedDevice, removeDevice,
    showSettings, setShowSettings, settingsTab, setSettingsTab,
    autoReconnect, setAutoReconnect, connectionTimeout, setConnectionTimeout,
    language, setLanguage, confirmDialog, setConfirmDialog, showConfirm,
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, chatExpanded, setChatExpanded, aiTyping, handleCommand,
    executeConfirm, dismissConfirm, clearChatHistory,
    agentMode, setAgentMode, agentPlan, agentExecution,
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
