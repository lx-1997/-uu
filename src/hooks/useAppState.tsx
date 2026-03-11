import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Tab, Device, Toast, TerminalSession, TransferItem, Activity, ChatMessage, ConfirmDialogState } from '../app-types';
import { MOCK_DEVICES, TERMINAL_PROFILES, FLASH_IMAGES, CMD_SUGGESTIONS } from '../constants';

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

  const filteredSuggestions = cmd.trim()
    ? CMD_SUGGESTIONS.filter((s) => s.text.includes(cmd) || s.keyword.includes(cmd.toLowerCase()))
    : CMD_SUGGESTIONS;

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
    window.setTimeout(() => {
      const lowerCmd = userMsg.toLowerCase();
      let aiText = '';
      let action: { label: string; tab: Tab } | undefined;
      let blocks: ChatMessage['blocks'];
      if (lowerCmd.includes('烧录') || lowerCmd.includes('镜像') || lowerCmd.includes('flash')) {
        aiText = `好的，为 ${currentDevice?.name} 准备镜像烧录工具。当前支持以下镜像版本，建议先确认目标介质类型。`;
        action = { label: '打开烧录工具', tab: 'flasher' };
        blocks = [
          { type: 'status', items: [
            { label: 'Ubuntu 22.04', value: '2.1 GB', ok: true },
            { label: 'ROS2 Humble', value: '3.4 GB', ok: true },
            { label: 'TROS AI', value: '4.2 GB', ok: true },
          ]},
        ];
      } else if (lowerCmd.includes('终端') || lowerCmd.includes('terminal') || lowerCmd.includes('ssh')) {
        aiText = `正在连接 ${currentDevice?.name} (${currentDevice?.ip})，SSH 终端已就绪。`;
        action = { label: '打开终端', tab: 'terminal' };
        blocks = [
          { type: 'terminal', lines: [
            `$ ssh ${currentDevice?.ip}`,
            `Welcome to Ubuntu 22.04.3 LTS (RDK X5)`,
            `Last login: ${new Date().toLocaleString()}`,
            `${currentDevice?.name}@rdk:~$ _`,
          ]},
        ];
      } else if (lowerCmd.includes('文件') || lowerCmd.includes('sftp') || lowerCmd.includes('上传')) {
        aiText = `文件管理器已就绪，当前使用 SFTP 协议连接到 ${currentDevice?.ip}。`;
        action = { label: '打开文件管理器', tab: 'files' };
      } else if (lowerCmd.includes('vnc') || lowerCmd.includes('桌面')) {
        aiText = '远程桌面准备就绪。建议在带宽受限时选择"流畅优先"模式，局域网环境下可使用"清晰优先"获得最佳画质。';
        action = { label: '连接远程桌面', tab: 'vnc' };
      } else if (lowerCmd.includes('流程') || lowerCmd.includes('编排') || lowerCmd.includes('node-red')) {
        aiText = '流程编排工作台包含三套模板，选好模板后可在画布上拖拽节点。';
        action = { label: '打开流程编排', tab: 'lowcode' };
        blocks = [
          { type: 'code', lang: 'json', content: '{\n  "templates": [\n    "视觉感知流水线",\n    "设备运维自动化",\n    "社区示例合集"\n  ]\n}' },
        ];
      } else if (lowerCmd.includes('小龙虾') || lowerCmd.includes('openclaw') || lowerCmd.includes('网关') || lowerCmd.includes('大模型')) {
        aiText = 'OpenClaws 网关运行状态如下：';
        action = { label: '管理网关配置', tab: 'openclaw' };
        blocks = [
          { type: 'status', items: [
            { label: '服务状态', value: 'Running', ok: true },
            { label: '今日调用', value: '1,247 次', ok: true },
            { label: '模型密钥', value: '已配置', ok: true },
            { label: '飞书接入', value: '未连接', ok: false },
          ]},
        ];
      } else if (lowerCmd.includes('硬件') || lowerCmd.includes('bpu') || lowerCmd.includes('温度') || lowerCmd.includes('cpu')) {
        aiText = `${currentDevice?.name} 当前硬件状态：`;
        action = { label: '查看详细诊断', tab: 'hardware' };
        blocks = [
          { type: 'status', items: [
            { label: 'BPU 占用', value: '68%', ok: true },
            { label: '芯片温度', value: '61.8°C', ok: false },
            { label: '内存使用', value: '5.2/8 GB', ok: true },
            { label: '系统运行', value: '3d 14h', ok: true },
          ]},
          { type: 'terminal', lines: [
            '$ cat /sys/class/thermal/thermal_zone0/temp',
            '61800',
            '$ cat /proc/meminfo | head -3',
            'MemTotal:    8167040 kB',
            'MemFree:     2982912 kB',
            'MemAvailable: 3014656 kB',
          ]},
        ];
      } else if (lowerCmd.includes('示例') || lowerCmd.includes('demo') || lowerCmd.includes('跟随')) {
        aiText = '示例应用目录包含三个 Demo，每个都会在启动前检查硬件依赖。';
        action = { label: '浏览示例应用', tab: 'examples' };
        blocks = [
          { type: 'status', items: [
            { label: '视觉跟随', value: '可运行', ok: true },
            { label: '手势控制', value: '可运行', ok: true },
            { label: '双摄测距', value: '缺少依赖', ok: false },
          ]},
        ];
      } else if (lowerCmd.includes('ros') || lowerCmd.includes('topic') || lowerCmd.includes('话题')) {
        aiText = '当前设备有 4 个活跃 ROS2 话题：';
        action = { label: '打开 ROS 可视化', tab: 'ros' };
        blocks = [
          { type: 'terminal', lines: [
            '$ ros2 topic list',
            '/hobot_dnn/bbox',
            '/camera/image_raw',
            '/imu/data',
            '/odom',
          ]},
          { type: 'image', src: '', caption: '/hobot_dnn/bbox · 目标 3 个 · 29 FPS' },
        ];
      } else if (lowerCmd.includes('模型') || lowerCmd.includes('model') || lowerCmd.includes('推理')) {
        aiText = `设备上已部署 2 个 BPU 优化模型，推理帧率 25-30 FPS。`;
        action = { label: '管理模型仓库', tab: 'models' };
        blocks = [
          { type: 'status', items: [
            { label: 'YOLOv5s', value: '已部署 · 30 FPS', ok: true },
            { label: 'FCOS', value: '已部署 · 25 FPS', ok: true },
            { label: 'ResNet50', value: '待转换', ok: false },
            { label: 'MobileNetV2', value: '待转换', ok: false },
          ]},
        ];
      } else {
        aiText = `收到！关于"${userMsg}"，我可以帮你在 ${currentDevice?.name} 上执行相关操作。你可以尝试更具体的描述，比如"帮我烧录镜像"、"查看 ROS 话题"或"检查硬件温度"。`;
      }
      setChatMessages((prev) => [...prev, { id: msgId + 1, role: 'ai', text: aiText, action, blocks }]);
      setAiTyping(false);
    }, 1200);
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
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
