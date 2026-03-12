import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Tab, Device, Toast, TerminalSession, TransferItem, Activity, ChatMessage, ConfirmDialogState } from '../app-types';
import { MOCK_DEVICES, TERMINAL_PROFILES, FLASH_IMAGES, CMD_SUGGESTIONS } from '../constants';
import { fetchAIReply } from '../api';

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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [aiTyping, setAiTyping] = useState(false);
  const pendingActionsRef = useRef<Record<string, () => void>>({});

  const filteredSuggestions = cmd.trim()
    ? CMD_SUGGESTIONS.filter((s) => s.text.includes(cmd) || s.keyword.includes(cmd.toLowerCase()))
    : CMD_SUGGESTIONS;

  /* ── Simulate an inline task: progress → result ── */
  const simulateTask = (steps: Array<{ label: string }>, resultTitle: string, resultDetail: string, extraBlocks?: ChatMessage['blocks']) => {
    const progressSteps = steps.map((s, i) => ({ label: s.label, status: (i === 0 ? 'running' : 'pending') as 'done' | 'running' | 'pending' }));
    const progressMsgId = Date.now() + 100;
    setChatMessages(prev => [...prev, { id: progressMsgId, role: 'ai', text: '正在执行...', blocks: [{ type: 'progress', steps: progressSteps }] }]);

    let step = 0;
    const iv = setInterval(() => {
      step++;
      if (step < steps.length) {
        const updated = steps.map((s, i) => ({ label: s.label, status: (i < step ? 'done' : i === step ? 'running' : 'pending') as 'done' | 'running' | 'pending' }));
        setChatMessages(prev => prev.map(m => m.id === progressMsgId ? { ...m, blocks: [{ type: 'progress', steps: updated }] } : m));
      } else {
        clearInterval(iv);
        const allDone = steps.map(s => ({ label: s.label, status: 'done' as const }));
        setChatMessages(prev => prev.map(m => m.id === progressMsgId ? { ...m, text: '执行完成', blocks: [{ type: 'progress', steps: allDone }] } : m));
        setTimeout(() => {
          const resultBlocks: ChatMessage['blocks'] = [{ type: 'task-result', success: true, title: resultTitle, detail: resultDetail }];
          if (extraBlocks) resultBlocks.push(...extraBlocks);
          setChatMessages(prev => [...prev, { id: Date.now(), role: 'ai', text: '任务完成！以下是结果：', blocks: resultBlocks }]);
          setAiTyping(false);
        }, 400);
      }
    }, 800);
  };

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

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    const userMsg = cmd.trim();
    const msgId = Date.now();
    setChatMessages((prev) => [...prev, { id: msgId, role: 'user', text: userMsg }]);
    setChatExpanded(true);
    setCmd('');
    setShowSuggestions(false);
    setAiTyping(true);

    /* Fire async processing */
    (async () => {
      /* 1. Call AI API for intelligent text (runs in parallel with intent detection) */
      const history = chatMessages.slice(-6).map((m) => ({
        role: m.role as string,
        content: m.text,
      }));
      history.push({ role: 'user', content: userMsg });

      const aiReplyPromise = fetchAIReply(history, currentDevice?.name, currentDevice?.ip);

      /* 2. Keyword-based intent detection for structured blocks */
      const lowerCmd = userMsg.toLowerCase();
      let fallbackText = '';
      let blocks: ChatMessage['blocks'];
      type PostAction = 'simulateTask' | 'none';
      let postAction: PostAction = 'none';
      let taskSteps: Array<{ label: string }> = [];
      let taskTitle = '';
      let taskDetail = '';
      let taskExtraBlocks: ChatMessage['blocks'];

      /* ── Flashing: confirm → execute inline ── */
      if (lowerCmd.includes('烧录') || lowerCmd.includes('镜像') || lowerCmd.includes('flash')) {
        const cid = `flash-${msgId}`;
        fallbackText = `好的，为 ${currentDevice?.name} 准备镜像烧录。以下是可用镜像版本：`;
        blocks = [
          { type: 'status', items: [
            { label: 'Ubuntu 22.04', value: '2.1 GB', ok: true },
            { label: 'ROS2 Humble', value: '3.4 GB', ok: true },
            { label: 'TROS AI', value: '4.2 GB', ok: true },
          ]},
          { type: 'confirm', text: `确认烧录 Ubuntu 22.04 到 ${currentDevice?.name}？此操作将覆盖目标存储`, confirmId: cid },
        ];
        pendingActionsRef.current[cid] = () => {
          simulateTask(
            [{ label: '检查存储介质' }, { label: '下载镜像' }, { label: '写入镜像' }, { label: '校验完整性' }],
            '烧录完成', `${currentDevice?.name} 镜像烧录成功 · Ubuntu 22.04 · 2.1 GB`,
          );
        };

      /* ── Terminal / SSH ── */
      } else if (lowerCmd.includes('终端') || lowerCmd.includes('terminal') || lowerCmd.includes('ssh') || lowerCmd.includes('命令')) {
        fallbackText = `正在连接 ${currentDevice?.name} (${currentDevice?.ip})，SSH 已就绪。`;
        blocks = [
          { type: 'terminal', lines: [
            `$ ssh root@${currentDevice?.ip}`,
            `Welcome to Ubuntu 22.04.3 LTS (RDK X5)`,
            `Last login: ${new Date().toLocaleString()}`,
            `${currentDevice?.name}@rdk:~$`,
          ]},
        ];

      /* ── File operations ── */
      } else if (lowerCmd.includes('文件') || lowerCmd.includes('sftp') || lowerCmd.includes('上传') || lowerCmd.includes('下载') || lowerCmd.includes('同步')) {
        const isUpload = lowerCmd.includes('上传') || lowerCmd.includes('同步');
        fallbackText = isUpload ? `正在将文件同步到 ${currentDevice?.name}...` : `正在从 ${currentDevice?.name} 拉取文件...`;
        postAction = 'simulateTask';
        taskSteps = [{ label: '建立 SFTP 连接' }, { label: isUpload ? '上传文件' : '下载文件' }, { label: '校验' }];
        taskTitle = isUpload ? '文件上传完成' : '文件下载完成';
        taskDetail = `${currentDevice?.ip} · SFTP · 3 文件 · 12.4 MB`;
        taskExtraBlocks = [{ type: 'terminal', lines: [`$ sftp root@${currentDevice?.ip}`, `Connected to ${currentDevice?.ip}`, `sftp> put ./models/*.bin /userdata/models/`, `Uploading... done (3 files, 12.4 MB)`] }];

      /* ── VNC ── */
      } else if (lowerCmd.includes('vnc') || lowerCmd.includes('桌面')) {
        fallbackText = `正在连接 ${currentDevice?.name} 远程桌面...`;
        postAction = 'simulateTask';
        taskSteps = [{ label: '启动 VNC 服务' }, { label: '建立连接' }, { label: '渲染桌面' }];
        taskTitle = '远程桌面已连接';
        taskDetail = `${currentDevice?.ip}:5900 · 1280×720 · 清晰优先`;
        taskExtraBlocks = [{ type: 'image', src: '', caption: `VNC · ${currentDevice?.ip}:5900 · 已连接` }];

      /* ── OpenClaw ── */
      } else if (lowerCmd.includes('小龙虾') || lowerCmd.includes('openclaw') || lowerCmd.includes('网关') || lowerCmd.includes('agent') || lowerCmd.includes('大模型')) {
        if (lowerCmd.includes('启动') || lowerCmd.includes('start') || lowerCmd.includes('开启')) {
          fallbackText = '正在启动 OpenClaw 网关...';
          postAction = 'simulateTask';
          taskSteps = [{ label: '加载配置' }, { label: '初始化 Agent' }, { label: '注册技能' }, { label: '启动服务' }];
          taskTitle = 'OpenClaw 已启动';
          taskDetail = 'port 18789 · 7 技能 · 通义千问 qwen3.5-plus';
          taskExtraBlocks = [{ type: 'status', items: [
            { label: '服务状态', value: 'Running', ok: true },
            { label: '端口', value: ':18789', ok: true },
            { label: '模型', value: 'qwen3.5-plus', ok: true },
            { label: '技能数', value: '7 已加载', ok: true },
          ]}];
        } else if (lowerCmd.includes('切换') || lowerCmd.includes('switch') || lowerCmd.includes('换')) {
          const targetModel = lowerCmd.includes('deepseek') ? 'deepseek-chat' : lowerCmd.includes('gpt') ? 'gpt-4o' : lowerCmd.includes('claude') ? 'claude-sonnet-4-20250514' : 'deepseek-chat';
          const cid = `switch-model-${msgId}`;
          fallbackText = `检测到你想切换模型到 ${targetModel}，切换后当前会话将使用新模型。`;
          blocks = [
            { type: 'status', items: [
              { label: '当前模型', value: 'qwen3.5-plus', ok: true },
              { label: '目标模型', value: targetModel, ok: true },
            ]},
            { type: 'confirm', text: `确认切换到 ${targetModel}？`, confirmId: cid },
          ];
          pendingActionsRef.current[cid] = () => {
            simulateTask(
              [{ label: '验证 API Key' }, { label: '切换模型' }, { label: '重载配置' }],
              '模型切换完成', `已切换到 ${targetModel}`,
            );
          };
        } else {
          fallbackText = 'OpenClaw 网关当前状态：';
          blocks = [
            { type: 'status', items: [
              { label: '服务状态', value: 'Running', ok: true },
              { label: '今日调用', value: '1,247 次', ok: true },
              { label: '模型', value: 'qwen3.5-plus', ok: true },
              { label: '技能', value: '7 已加载', ok: true },
            ]},
            { type: 'terminal', lines: [
              '$ openclaw status',
              '✓ Gateway running on :18789',
              '✓ Agent: qwen3.5-plus (通义千问)',
              '✓ Skills: device_control, ros_topic, exec, web_search, file_ops, model_inference, camera_stream',
              `✓ Uptime: 3d 14h`,
            ]},
          ];
        }

      /* ── Hardware diagnostics ── */
      } else if (lowerCmd.includes('硬件') || lowerCmd.includes('bpu') || lowerCmd.includes('温度') || lowerCmd.includes('cpu') || lowerCmd.includes('体检') || lowerCmd.includes('诊断') || lowerCmd.includes('检查')) {
        fallbackText = `正在检测 ${currentDevice?.name} 硬件状态...`;
        postAction = 'simulateTask';
        taskSteps = [{ label: '读取芯片温度' }, { label: '检测 BPU 占用' }, { label: '检测内存' }, { label: '检测网络' }];
        taskTitle = '诊断完成';
        taskDetail = `${currentDevice?.name} · 整体健康`;
        taskExtraBlocks = [
          { type: 'status', items: [
            { label: 'BPU 占用', value: '68%', ok: true },
            { label: '芯片温度', value: '61.8°C', ok: false },
            { label: '内存使用', value: '5.2/8 GB', ok: true },
            { label: '系统运行', value: '3d 14h', ok: true },
          ]},
          { type: 'terminal', lines: [
            '$ cat /sys/class/thermal/thermal_zone0/temp',
            '61800',
            '$ hrut_smi',
            'BPU0: 68%  BPU1: 42%  DDR: 43%',
            '$ free -h',
            'total    used    free    available',
            '7.8G     5.2G    1.4G    2.6G',
          ]},
        ];

      /* ── ROS topics ── */
      } else if (lowerCmd.includes('ros') || lowerCmd.includes('topic') || lowerCmd.includes('话题')) {
        fallbackText = `正在扫描 ${currentDevice?.name} 上的 ROS2 话题...`;
        postAction = 'simulateTask';
        taskSteps = [{ label: '连接 ROS2 DDS' }, { label: '枚举话题' }, { label: '采样频率' }];
        taskTitle = 'ROS2 话题扫描完成';
        taskDetail = '4 个活跃话题 · DDS 正常';
        taskExtraBlocks = [
          { type: 'terminal', lines: [
            '$ ros2 topic list',
            '/hobot_dnn/bbox      [30 Hz]',
            '/camera/image_raw    [25 Hz]',
            '/imu/data            [100 Hz]',
            '/odom                [50 Hz]',
          ]},
          { type: 'image', src: '', caption: '/hobot_dnn/bbox · 目标 3 个 · 29 FPS' },
        ];

      /* ── Models ── */
      } else if (lowerCmd.includes('模型') || lowerCmd.includes('model') || lowerCmd.includes('推理') || lowerCmd.includes('yolo') || lowerCmd.includes('部署')) {
        if (lowerCmd.includes('部署') || lowerCmd.includes('deploy') || lowerCmd.includes('转换')) {
          const cid = `deploy-model-${msgId}`;
          fallbackText = '检测到部署请求。以下是待部署模型：';
          blocks = [
            { type: 'status', items: [
              { label: 'YOLOv5s', value: '已部署 · 30 FPS', ok: true },
              { label: 'ResNet50', value: '待转换', ok: false },
            ]},
            { type: 'confirm', text: '确认将 ResNet50 转换并部署到 BPU？', confirmId: cid },
          ];
          pendingActionsRef.current[cid] = () => {
            simulateTask(
              [{ label: 'ONNX → Horizon' }, { label: '量化校准' }, { label: '编译 BPU bin' }, { label: '部署到设备' }],
              '模型部署完成', 'ResNet50 · BPU 优化 · 推理 45 FPS',
            );
          };
        } else {
          fallbackText = `${currentDevice?.name} 上已部署的模型：`;
          blocks = [
            { type: 'status', items: [
              { label: 'YOLOv5s', value: '已部署 · 30 FPS', ok: true },
              { label: 'FCOS', value: '已部署 · 25 FPS', ok: true },
              { label: 'ResNet50', value: '待转换', ok: false },
              { label: 'MobileNetV2', value: '待转换', ok: false },
            ]},
          ];
        }

      /* ── Examples / Demos ── */
      } else if (lowerCmd.includes('示例') || lowerCmd.includes('demo') || lowerCmd.includes('跟随') || lowerCmd.includes('运行')) {
        const cid = `run-demo-${msgId}`;
        fallbackText = '可用示例应用如下，选择一个运行：';
        blocks = [
          { type: 'status', items: [
            { label: '视觉跟随', value: '可运行', ok: true },
            { label: '手势控制', value: '可运行', ok: true },
            { label: '双摄测距', value: '缺少依赖', ok: false },
          ]},
          { type: 'confirm', text: '确认运行「视觉跟随」示例？', confirmId: cid },
        ];
        pendingActionsRef.current[cid] = () => {
          simulateTask(
            [{ label: '检查依赖' }, { label: '启动摄像头' }, { label: '加载检测模型' }, { label: '运行跟随算法' }],
            '视觉跟随已启动', '摄像头 0 · YOLOv5s · 29 FPS · 跟随中',
            [{ type: 'image', src: '', caption: '视觉跟随 · 检测 2 个目标 · 跟随中' }],
          );
        };

      /* ── Workflow / low-code ── */
      } else if (lowerCmd.includes('流程') || lowerCmd.includes('编排') || lowerCmd.includes('node-red') || lowerCmd.includes('工作流')) {
        fallbackText = '流程编排工作台包含三套模板：';
        blocks = [
          { type: 'code', lang: 'json', content: '{\n  "templates": [\n    "视觉感知流水线",\n    "设备运维自动化",\n    "社区示例合集"\n  ]\n}' },
          { type: 'status', items: [
            { label: '视觉感知', value: '7 节点', ok: true },
            { label: '设备运维', value: '5 节点', ok: true },
            { label: '社区合集', value: '12 节点', ok: true },
          ]},
        ];
      }
      /* Catch-all: no fallbackText, rely entirely on AI */

      /* 3. Await AI reply */
      const aiReply = await aiReplyPromise;

      /* 4. Determine final text: AI reply > fallback > generic */
      const aiText = aiReply || fallbackText || `收到！我可以直接在对话中帮你完成以下操作，无需切换页面：检查硬件温度、启动 OpenClaw、查看 ROS 话题、部署模型、烧录镜像、同步文件等。你想做什么？`;

      /* 5. Emit message + optional post-action */
      setChatMessages((prev) => [...prev, { id: msgId + 1, role: 'ai', text: aiText, blocks }]);
      setAiTyping(false);

      if (postAction === 'simulateTask' && taskSteps.length > 0) {
        simulateTask(taskSteps, taskTitle, taskDetail, taskExtraBlocks);
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

  // ---- Effects ----
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
    executeConfirm, dismissConfirm,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
