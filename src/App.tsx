import React, { useEffect, useState } from 'react';
import './styles.css';

type Tab = 'dashboard' | 'flasher' | 'terminal' | 'files' | 'vnc' | 'lowcode' | 'openclaw' | 'hardware' | 'examples' | 'ros' | 'models';

const MOCK_DEVICES = [
  { id: '1', name: 'RDK X3 - Local', status: 'online', ip: '192.168.1.100' },
  { id: '2', name: 'RDK Ultra - Lab', status: 'offline', ip: '192.168.1.105' },
];

type DashboardCard = {
  tab: Tab;
  title: string;
  description: string;
  loading: string;
  statusLabel: string;
  statusOk: boolean;
  miniStats: Array<{ label: string; value: string }>;
  cta: string;
  quickActions: Array<{ label: string; icon: string }>;
};

const DASHBOARD_CARDS: DashboardCard[] = [
  {
    tab: 'openclaw',
    title: '⚙️ OpenClaws Gateway',
    description: '大模型网关与 AI Agent 编排，直连 OpenAI / Qwen，飞书一键接入。',
    loading: '正在载入 OpenClaws 网关配置...',
    statusLabel: 'Gateway Running',
    statusOk: true,
    miniStats: [{ label: '已接入渠道', value: '2' }, { label: '今日调用', value: '1,247' }],
    cta: '管理网关配置 →',
    quickActions: [{ label: '配置密钥', icon: '🔑' }, { label: '查看日志', icon: '📋' }],
  },
  {
    tab: 'examples',
    title: '📦 示例应用中心',
    description: '视觉跟随、手势控制、双摄测距等深度学习 Demo，含依赖检查。',
    loading: '正在准备示例应用目录与运行前检查...',
    statusLabel: '3 个示例可用',
    statusOk: true,
    miniStats: [{ label: '可运行', value: '3' }, { label: '需配置', value: '1' }],
    cta: '浏览示例目录 →',
    quickActions: [{ label: '视觉跟随', icon: '👁️' }, { label: '手势控制', icon: '🖐️' }],
  },
  {
    tab: 'ros',
    title: '🕸️ ROS 话题可视化',
    description: '订阅 ROS2 话题，实时渲染点云、图像与 AI 推理框。',
    loading: '正在建立 ROS2 可视化工作区...',
    statusLabel: '4 个话题活跃',
    statusOk: true,
    miniStats: [{ label: '活跃 Topic', value: '4' }, { label: '录包', value: 'OFF' }],
    cta: '打开可视化面板 →',
    quickActions: [{ label: '开始录包', icon: '⏺️' }, { label: '话题列表', icon: '📡' }],
  },
  {
    tab: 'models',
    title: '🤖 模型仓库与部署',
    description: '管理 AI 推理模型，支持格式转换与 BPU 部署。',
    loading: '正在扫描模型仓库与部署状态...',
    statusLabel: '2 个模型已部署',
    statusOk: true,
    miniStats: [{ label: '已部署', value: '2' }, { label: '推理 FPS', value: '30' }],
    cta: '管理模型 →',
    quickActions: [{ label: '上传模型', icon: '⬆️' }, { label: '性能基准', icon: '📊' }],
  },
];

const FLASH_IMAGES = [
  { id: 'ubuntu-22.04', label: 'Ubuntu 22.04 LTS (官方推荐)', detail: '基础开发环境 + Docker runtime' },
  { id: 'ros2-humble', label: 'ROS2 Humble 预装版', detail: '预装 TogetherROS.b 与调试工具链' },
  { id: 'tros-ai', label: 'TROS AI 开发版', detail: '适合视觉算法与小龙虾示例快速验证' },
  { id: 'local', label: '浏览本地文件...', detail: '导入自定义镜像包并保留元数据校验' },
];

const STORAGE_TARGETS = [
  { id: 'sd', label: 'SD Card', path: '/dev/mmcblk0', safe: '可热插拔，适合开发调试' },
  { id: 'emmc', label: 'eMMC', path: '/dev/mmcblk1', safe: '适合稳定部署，需二次确认' },
  { id: 'usb', label: 'USB 启动盘', path: '/dev/sda', safe: '适合离线交付与系统恢复' },
];

const TERMINAL_PROFILES = [
  { id: 'shell', label: '系统 Shell', desc: '适合常规巡检、日志查看与环境配置' },
  { id: 'ros', label: 'ROS2 调试会话', desc: '默认加载 ROS2 环境变量与 Topic 快捷指令' },
  { id: 'diag', label: '硬件诊断会话', desc: '预置 bputop、hrut_smi、dmesg 等命令建议' },
];

const COMMAND_SUGGESTIONS = ['ros2 topic list', 'hrut_smi', 'tail -f /var/log/syslog', 'ls /userdata', 'top'];

const LOCAL_FILES = ['models/', 'records/', 'configs/', 'launch.py', 'README.md'];
const REMOTE_FILES = ['app/', 'userdata/', 'logs/', 'claw_pipeline.yaml', 'start_ros.sh'];

const FLOW_TEMPLATES = [
  { id: 'vision', name: '视觉感知流水线', desc: '摄像头输入 -> AI 推理 -> 结果发布' },
  { id: 'ops', name: '设备运维自动化', desc: 'SSH 指令 -> 结果判断 -> 报警与回滚' },
  { id: 'demo', name: '社区示例编排', desc: '算法启动 -> 资源检测 -> 可视化页面联动' },
];

const EXAMPLE_PRESETS = [
  { id: 'follow', name: '视觉跟随', tag: 'TogetherROS.b', readiness: '需摄像头 + 电机控制链路' },
  { id: 'gesture', name: '手势控制', tag: 'BPU Demo', readiness: '需 RGB 输入与动作映射' },
  { id: 'stereo', name: '双摄测距', tag: 'Depth', readiness: '需双目标定与时间同步' },
];

const ROS_TOPICS = ['/hobot_dnn/bbox', '/camera/color/image_raw', '/tf', '/cmd_vel'];

export default function App() {
  const [activeDevice, setActiveDevice] = useState(MOCK_DEVICES[0].id);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [cmd, setCmd] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [flashImage, setFlashImage] = useState('ubuntu-22.04');
  const [flashTarget, setFlashTarget] = useState('sd');
  const [flashMode, setFlashMode] = useState<'safe' | 'fast' | 'recover'>('safe');
  const [flashVerify, setFlashVerify] = useState(true);
  const [flashBackup, setFlashBackup] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);
  const [flashPhase, setFlashPhase] = useState('等待开始');
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashStep, setFlashStep] = useState(1);
  const [terminalProfile, setTerminalProfile] = useState('shell');
  const [terminalDraft, setTerminalDraft] = useState('');
  const [terminalSessions, setTerminalSessions] = useState([
    { id: 'session-1', name: '主会话', profile: 'shell', status: 'attached', lines: ['Welcome to RDK OS.', 'root@rdk:~#'] },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('session-1');
  const [transferProtocol, setTransferProtocol] = useState('sftp');
  const [fileAction, setFileAction] = useState<'upload' | 'download' | 'sync'>('upload');
  const [transferQueue, setTransferQueue] = useState([
    { id: 'queue-1', name: 'models/yolov5.bin', direction: '上传', progress: 100, status: 'done' },
    { id: 'queue-2', name: 'logs/run-2026-03-10.tar.gz', direction: '下载', progress: 42, status: 'running' },
  ]);
  const [vncQuality, setVncQuality] = useState<'smooth' | 'balanced' | 'sharp'>('balanced');
  const [vncLayout, setVncLayout] = useState<'fit' | 'pixel' | 'dual'>('fit');
  const [vncOverlay, setVncOverlay] = useState(true);
  const [vncConnected, setVncConnected] = useState(false);
  const [vncProgress, setVncProgress] = useState(0);
  const [vncPhase, setVncPhase] = useState('等待连接');
  const [flowTemplate, setFlowTemplate] = useState('vision');
  const [flowMode, setFlowMode] = useState<'draft' | 'review' | 'staging'>('draft');
  const [flowCheckProgress, setFlowCheckProgress] = useState(0);
  const [isFlowChecking, setIsFlowChecking] = useState(false);
  const [openclawMode, setOpenclawMode] = useState<string>('model');
  const [openclawThreshold, setOpenclawThreshold] = useState(74);
  const [hardwareRange, setHardwareRange] = useState<'realtime' | '10m' | '1h'>('realtime');
  const [examplePreset, setExamplePreset] = useState('follow');
  const [rosTopic, setRosTopic] = useState('/hobot_dnn/bbox');
  const [rosRecording, setRosRecording] = useState(false);

  // Interactive system states
  const [devices, setDevices] = useState(MOCK_DEVICES);
  const [toasts, setToasts] = useState<Array<{id: number; message: string; type: 'success' | 'warning' | 'info'}>>([]);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceIp, setNewDeviceIp] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scannedDevices, setScannedDevices] = useState<Array<{name: string; ip: string}>>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'connection' | 'about'>('general');
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [connectionTimeout, setConnectionTimeout] = useState(30);
  const [language, setLanguage] = useState('zh-CN');
  const [confirmDialog, setConfirmDialog] = useState<{show: boolean; title: string; message: string; onConfirm: () => void} | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{id: number; role: 'user' | 'ai'; text: string; action?: { label: string; tab: Tab }}>>([]);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [aiTyping, setAiTyping] = useState(false);
  const [activities, setActivities] = useState([
    { id: 1, text: '系统就绪，RDK Studio 启动完成', time: '刚刚' },
    { id: 2, text: 'RDK X3 - Local 设备已连接', time: '2 分钟前' },
    { id: 3, text: 'OpenClaws 网关服务运行中', time: '5 分钟前' },
  ]);

  const currentDevice = devices.find((device) => device.id === activeDevice);
  const currentSession = terminalSessions.find((session) => session.id === activeSessionId) ?? terminalSessions[0];

  const toastCounter = React.useRef(0);

  const addToast = (message: string, type: 'success' | 'warning' | 'info' = 'info') => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev, { id, message, type }]);
    window.setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  };

  const addActivity = (text: string) => {
    setActivities(prev => [{ id: Date.now(), text, time: '刚刚' }, ...prev].slice(0, 10));
  };

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
    setDevices(prev => [...prev, { id, name: newDeviceName, status: 'online', ip: newDeviceIp }]);
    setShowAddDevice(false);
    setNewDeviceName('');
    setNewDeviceIp('');
    addToast(`设备 "${newDeviceName}" 已添加`, 'success');
    addActivity(`添加设备: ${newDeviceName} (${newDeviceIp})`);
  };

  const addScannedDevice = (device: {name: string; ip: string}) => {
    const id = String(devices.length + 1);
    setDevices(prev => [...prev, { id, name: device.name, status: 'online', ip: device.ip }]);
    addToast(`设备 "${device.name}" 已添加到列表`, 'success');
    addActivity(`通过扫描添加设备: ${device.name}`);
  };

  const CMD_SUGGESTIONS = [
    { icon: '💽', text: '帮我烧录最新系统镜像', keyword: '烧录' },
    { icon: '💻', text: '打开SSH终端连接设备', keyword: '终端' },
    { icon: '📁', text: '上传模型文件到设备', keyword: '文件' },
    { icon: '🖥️', text: '连接VNC远程桌面', keyword: 'vnc' },
    { icon: '🕸️', text: '查看ROS话题数据', keyword: 'ros' },
    { icon: '🏥', text: '检查设备硬件温度', keyword: '温度' },
    { icon: '📦', text: '运行视觉跟随示例应用', keyword: '示例' },
    { icon: '⚙️', text: '配置OpenClaws AI网关', keyword: 'openclaw' },
  ];

  const filteredSuggestions = cmd.trim()
    ? CMD_SUGGESTIONS.filter(s => s.text.includes(cmd) || s.keyword.includes(cmd.toLowerCase()))
    : CMD_SUGGESTIONS;

  const openWorkspace = (nextTab: Tab, message: string) => {
    setIsLoading(true);
    setLoadingMsg(message);
    window.setTimeout(() => {
      setActiveTab(nextTab);
      setIsLoading(false);
    }, 400);
  };

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;

    const userMsg = cmd.trim();
    const msgId = Date.now();
    setChatMessages(prev => [...prev, { id: msgId, role: 'user', text: userMsg }]);
    setChatExpanded(true);
    setCmd('');
    setShowSuggestions(false);
    setAiTyping(true);

    window.setTimeout(() => {
      const lowerCmd = userMsg.toLowerCase();
      let aiText = '';
      let action: { label: string; tab: Tab } | undefined;

      if (lowerCmd.includes('烧录') || lowerCmd.includes('镜像') || lowerCmd.includes('flash')) {
        aiText = `好的，为 ${currentDevice?.name} 准备镜像烧录工具。当前支持 Ubuntu 22.04、ROS2 Humble 和 TROS AI 三个镜像版本，建议先确认目标介质类型。`;
        action = { label: '打开烧录工具', tab: 'flasher' };
      } else if (lowerCmd.includes('终端') || lowerCmd.includes('terminal') || lowerCmd.includes('ssh')) {
        aiText = `正在连接 ${currentDevice?.name} (${currentDevice?.ip})，已准备好 SSH 终端环境。可以选择系统 Shell、ROS2 调试会话或硬件诊断会话。`;
        action = { label: '打开终端', tab: 'terminal' };
      } else if (lowerCmd.includes('文件') || lowerCmd.includes('sftp') || lowerCmd.includes('上传')) {
        aiText = `文件管理器已就绪，当前使用 SFTP 协议连接到 ${currentDevice?.ip}。支持上传、下载和目录同步三种模式。`;
        action = { label: '打开文件管理器', tab: 'files' };
      } else if (lowerCmd.includes('vnc') || lowerCmd.includes('桌面')) {
        aiText = '远程桌面准备就绪。建议在带宽受限时选择"流畅优先"模式，局域网环境下可使用"清晰优先"获得最佳画质。';
        action = { label: '连接远程桌面', tab: 'vnc' };
      } else if (lowerCmd.includes('流程') || lowerCmd.includes('编排') || lowerCmd.includes('node-red')) {
        aiText = '流程编排工作台包含视觉感知、设备运维和社区示例三套模板。选好模板后可在画布上拖拽节点，发布前会自动执行环境检查。';
        action = { label: '打开流程编排', tab: 'lowcode' };
      } else if (lowerCmd.includes('小龙虾') || lowerCmd.includes('openclaw') || lowerCmd.includes('网关') || lowerCmd.includes('大模型')) {
        aiText = 'OpenClaws 网关当前状态正常 (Running)，今日已处理 1,247 次 API 调用。可以配置模型密钥、飞书接入或查看实时日志。';
        action = { label: '管理网关配置', tab: 'openclaw' };
      } else if (lowerCmd.includes('硬件') || lowerCmd.includes('bpu') || lowerCmd.includes('温度') || lowerCmd.includes('cpu')) {
        aiText = `${currentDevice?.name} 当前状态：BPU 占用 68%，芯片温度 61.8°C，内存 5.2/8 GB。整体运行正常，BPU 负载偏高建议保留余量。`;
        action = { label: '查看详细诊断', tab: 'hardware' };
      } else if (lowerCmd.includes('示例') || lowerCmd.includes('demo') || lowerCmd.includes('跟随')) {
        aiText = '示例应用目录包含视觉跟随、手势控制和双摄测距三个 Demo。每个都会在启动前检查硬件依赖，缺失项可一键修复。';
        action = { label: '浏览示例应用', tab: 'examples' };
      } else if (lowerCmd.includes('ros') || lowerCmd.includes('topic') || lowerCmd.includes('话题')) {
        aiText = '当前设备有 4 个活跃 ROS2 话题。推荐先订阅 /hobot_dnn/bbox 查看 AI 推理结果，也可以开启录包用于离线回放。';
        action = { label: '打开 ROS 可视化', tab: 'ros' };
      } else if (lowerCmd.includes('模型') || lowerCmd.includes('model') || lowerCmd.includes('推理')) {
        aiText = `设备上已部署 2 个 BPU 优化模型 (YOLOv5s, FCOS)，推理帧率 25-30 FPS。还有 2 个待转换模型需要通过 hb_mapper 工具链处理。`;
        action = { label: '管理模型仓库', tab: 'models' };
      } else {
        aiText = `收到！关于"${userMsg}"，我可以帮你在 ${currentDevice?.name} 上执行相关操作。你可以尝试更具体的描述，比如"帮我烧录镜像"、"查看 ROS 话题"或"检查硬件温度"。`;
      }

      setChatMessages(prev => [...prev, { id: msgId + 1, role: 'ai', text: aiText, action }]);
      setAiTyping(false);
    }, 1200);
  };

  useEffect(() => {
    const el = document.querySelector('.chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages, aiTyping]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        const input = document.querySelector('.cmd-input') as HTMLInputElement;
        input?.focus();
      }
      if (e.key === 'Escape' && chatExpanded) {
        setChatExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chatExpanded]);

  useEffect(() => {
    const viewport = document.querySelector('.canvas-viewport');
    if (viewport) viewport.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeTab]);

  useEffect(() => {
    if (!isFlashing) return;

    const timer = window.setInterval(() => {
      setFlashProgress((prev) => {
        const next = Math.min(prev + 12, 100);
        if (next < 20) {
          setFlashPhase('校验镜像与目标介质');
          setFlashStep(2);
        } else if (next < 65) {
          setFlashPhase('写入系统分区与启动项');
          setFlashStep(3);
        } else if (next < 100) {
          setFlashPhase(flashVerify ? '执行写后校验与启动检查' : '整理烧录报告与建议');
          setFlashStep(4);
        } else {
          setFlashPhase('烧录流程完成，可进入首次启动向导');
          setIsFlashing(false);
          addToast('🎉 烧录成功完成！可进入终端或文件管理器继续', 'success');
          addActivity('系统镜像烧录完成');
        }
        return next;
      });
    }, 700);

    return () => window.clearInterval(timer);
  }, [flashVerify, isFlashing]);

  useEffect(() => {
    const hasRunningQueue = transferQueue.some((item) => item.status === 'running');
    if (!hasRunningQueue) return;

    const timer = window.setInterval(() => {
      setTransferQueue((prev) => {
        let bumped = false;
        return prev.map((item) => {
          if (bumped || item.status !== 'running') {
            return item;
          }
          bumped = true;
          const next = Math.min(item.progress + 9, 100);
          return {
            ...item,
            progress: next,
            status: next >= 100 ? 'done' : 'running',
          };
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
        if (next < 35) {
          setVncPhase('协商分辨率与编码协议');
        } else if (next < 75) {
          setVncPhase('同步桌面帧缓冲与快捷键映射');
        } else if (next < 100) {
          setVncPhase('连接已稳定，正在启用辅助控制层');
        } else {
          setVncPhase('远程桌面已接入');
          addToast('🖥️ VNC 远程桌面连接成功', 'success');
          addActivity('VNC 远程桌面连接就绪');
        }
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
        if (next >= 100) {
          setIsFlowChecking(false);
        }
        return next;
      });
    }, 450);

    return () => window.clearInterval(timer);
  }, [isFlowChecking]);

  const startFlash = () => {
    const doFlash = () => {
      setFlashProgress(0);
      setFlashPhase('准备扫描目标介质与系统镜像');
      setFlashStep(1);
      setIsFlashing(true);
      addToast('烧录流程已启动', 'info');
      addActivity(`开始烧录: ${FLASH_IMAGES.find(i => i.id === flashImage)?.label || flashImage}`);
    };
    if (flashTarget === 'emmc') {
      showConfirm(
        '⚠️ eMMC 烧录确认',
        '当前目标为 eMMC 内置存储，写入后将覆盖原有系统。此操作不可撤销，建议先备份重要数据。确认继续？',
        doFlash
      );
    } else {
      doFlash();
    }
  };

  const appendTransferTask = () => {
    const direction = fileAction === 'upload' ? '上传' : fileAction === 'download' ? '下载' : '同步';
    const name = fileAction === 'upload' ? 'configs/device-profile.yaml' : fileAction === 'download' ? 'userdata/trace.log' : 'workspace/rdk-demo/';
    setTransferQueue((prev) => [
      { id: `queue-${prev.length + 1}`, name, direction, progress: 0, status: 'running' },
      ...prev,
    ]);
    addToast(`${direction}任务已加入队列: ${name}`, 'info');
    addActivity(`新增${direction}任务: ${name}`);
  };

  const createSession = () => {
    const nextId = `session-${terminalSessions.length + 1}`;
    const profileLabel = TERMINAL_PROFILES.find((profile) => profile.id === terminalProfile)?.label ?? '系统 Shell';
    setTerminalSessions((prev) => [
      ...prev,
      {
        id: nextId,
        name: `${profileLabel} ${prev.length}`,
        profile: terminalProfile,
        status: 'warm',
        lines: [`${profileLabel} 已建立上下文。`, 'root@rdk:~#'],
      },
    ]);
    setActiveSessionId(nextId);
    addToast(`终端会话 "${profileLabel}" 已创建`, 'success');
    addActivity(`创建终端会话: ${profileLabel}`);
  };

  const runTerminalCommand = (commandText: string) => {
    if (!commandText.trim()) return;
    const responseMap: Record<string, string[]> = {
      'ros2 topic list': ['/camera/color/image_raw', '/hobot_dnn/bbox', '/tf', '/cmd_vel'],
      hrut_smi: ['BPU0 68%', 'DDR 43%', 'TEMP 61.8C'],
      'tail -f /var/log/syslog': ['[mock] rsyslog 已进入跟随模式', '[mock] AI runtime ready'],
      'ls /userdata': ['models', 'records', 'cache', 'workspace'],
      top: ['CPU 31%  MEM 44%  Tasks 128', '[mock] 仅展示交互，不连接真实设备'],
    };

    const output = responseMap[commandText] ?? ['[mock] 已接收命令，建议切换为真实 SSH 执行器后接入。'];

    setTerminalSessions((prev) =>
      prev.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              status: 'running',
              lines: [...session.lines, `root@rdk:~# ${commandText}`, ...output, 'root@rdk:~#'],
            }
          : session,
      ),
    );
    setTerminalDraft('');
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

  const metricCards = [
    { label: 'BPU 占用', value: '68%', bar: 68, hint: '推理负载较高，建议保留 20% 峰值余量' },
    { label: 'CPU 占用', value: '34%', bar: 34, hint: '适合继续运行视觉与终端诊断任务' },
    { label: '内存使用', value: '5.2 / 8 GB', bar: 65, hint: '建议清理历史录包后再跑双摄应用' },
    { label: '芯片温度', value: '61.8°C', bar: 58, hint: '温度正常，可开启持续监控窗口' },
  ];

  const renderDashboard = () => (
    <div className="center-stage">
      <h2 className="hero-title">{currentDevice?.name || 'RDK Workspace'}</h2>
      <div className="hero-subtitle">基于 AI 驱动的边缘计算与开发节点</div>

      <div className="stats-strip">
        <div className="stat-card">
          <div className="stat-value">5.2<span className="stat-unit">/8G</span></div>
          <div className="stat-label">内存使用</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">61.8<span className="stat-unit">°C</span></div>
          <div className="stat-label">芯片温度</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">68<span className="stat-unit">%</span></div>
          <div className="stat-label">BPU 负载</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">3d<span className="stat-unit"> 14h</span></div>
          <div className="stat-label">系统运行</div>
        </div>
      </div>

      <div className="quick-grid">
        {DASHBOARD_CARDS.map((card) => (
          <div key={card.tab} className="startup-card" onClick={() => openWorkspace(card.tab, card.loading)}>
            <div className="card-top-row">
              <h3>{card.title}</h3>
              <span className={`card-status-badge ${card.statusOk ? 'ok' : 'warn'}`}>
                <span className="card-status-dot"></span>
                {card.statusLabel}
              </span>
            </div>
            <p>{card.description}</p>
            <div className="card-mini-stats">
              {card.miniStats.map(s => (
                <div key={s.label} className="card-mini-stat">
                  <span className="card-mini-value">{s.value}</span>
                  <span className="card-mini-label">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="card-quick-actions">
              {card.quickActions.map(a => (
                <span key={a.label} className="card-quick-action" onClick={(e) => { e.stopPropagation(); openWorkspace(card.tab, card.loading); }}>
                  {a.icon} {a.label}
                </span>
              ))}
            </div>
            <div className="card-action">{card.cta}</div>
          </div>
        ))}
      </div>

      <div className="activity-feed">
        <div className="section-label" style={{ margin: '24px 0 12px 0' }}>最近活动</div>
        {activities.slice(0, 5).map(act => (
          <div key={act.id} className="activity-item">
            <span className="activity-dot"></span>
            <span className="activity-text">{act.text}</span>
            <span className="activity-time">{act.time}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderFlasher = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">💽 镜像烧录工具 (Target: {currentDevice?.name})</div>
        <div className="desc-text">
          选择镜像、确认介质、设定策略，四步完成系统烧录。
        </div>

        <div className="stepper-row">
          {['镜像选择', '介质确认', '写入策略', '交付完成'].map((label, index) => (
            <div key={label} className={`step-chip ${flashStep >= index + 1 ? 'active' : ''}`}>
              <span>{index + 1}</span>
              {label}
            </div>
          ))}
        </div>

        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">镜像与目标</div>
            <div className="option-list">
              {FLASH_IMAGES.map((image) => (
                <button
                  key={image.id}
                  className={`select-card ${flashImage === image.id ? 'active' : ''}`}
                  onClick={() => setFlashImage(image.id)}
                >
                  <strong>{image.label}</strong>
                  <span>{image.detail}</span>
                </button>
              ))}
            </div>

            <div className="field-grid">
              {STORAGE_TARGETS.map((target) => (
                <button
                  key={target.id}
                  className={`select-card compact ${flashTarget === target.id ? 'active' : ''}`}
                  onClick={() => setFlashTarget(target.id)}
                >
                  <strong>
                    {target.label} <span className="muted-inline">{target.path}</span>
                  </strong>
                  <span>{target.safe}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">写入策略与风险兜底</div>
            <div className="segmented-row">
              {[
                ['safe', '安全模式'],
                ['fast', '极速模式'],
                ['recover', '恢复模式'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  className={`segment-btn ${flashMode === mode ? 'active' : ''}`}
                  onClick={() => setFlashMode(mode as 'safe' | 'fast' | 'recover')}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="toggle-row">
              <input type="checkbox" checked={flashVerify} onChange={(event) => setFlashVerify(event.target.checked)} />
              <span>写入后自动校验镜像完整性与启动扇区</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={flashBackup} onChange={(event) => setFlashBackup(event.target.checked)} />
              <span>保留当前引导分区快照，便于失败时回滚</span>
            </label>

            <div className="warning-banner">
              {flashTarget === 'emmc' ? '当前目标为 eMMC，默认启用双重确认并隐藏系统盘。' : '当前目标可安全替换，适合开发阶段快速迭代。'}
            </div>

            <div className="progress-box">
              <div className="progress-meta">
                <span>{flashPhase}</span>
                <strong>{flashProgress}%</strong>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${flashProgress}%` }}></div>
              </div>
            </div>

            <div className="action-row">
              <button className="clean-btn" onClick={startFlash}>
                {isFlashing ? '重新开始流程' : '开始烧录'}
              </button>
              <button className="clean-btn outline-btn" onClick={() => setFlashStep(1)}>
                重置步骤
              </button>
            </div>
          </div>
        </div>

        <div className="workspace-grid two-column lower-grid">
          <div className="panel-card">
            <div className="panel-title">过程反馈</div>
            <div className="timeline-list">
              {[
                '扫描镜像元信息与校验码',
                '检测目标介质容量、分区表与设备类型',
                '写入引导分区、系统分区与配置覆盖层',
                '生成可分享的烧录结果摘要与首次启动建议',
              ].map((item, index) => (
                <div key={item} className={`timeline-item ${flashStep >= index + 1 ? 'active' : ''}`}>
                  <span className="timeline-dot"></span>
                  <div>{item}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel-card">
            <div className="panel-title">烧录完成后</div>
            <div className="usage-list">
              <div className="usage-item">首次启动引导配置网络与 SSH。</div>
              <div className="usage-item">可跳转到终端、文件管理或示例应用。</div>
            </div>
            {flashProgress >= 100 && !isFlashing && (
              <div className="action-row" style={{ marginTop: '16px' }}>
                <button className="clean-btn" onClick={() => { setActiveTab('terminal'); addToast('已跳转到终端，可开始配置设备', 'info'); }}>
                  💻 打开终端
                </button>
                <button className="clean-btn outline-btn" onClick={() => { setActiveTab('files'); addToast('已跳转到文件管理器', 'info'); }}>
                  📁 文件管理
                </button>
                <button className="clean-btn outline-btn" onClick={() => { setActiveTab('examples'); addToast('已跳转到示例应用', 'info'); }}>
                  📦 示例应用
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderTerminal = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget terminal-shell">
        <div className="widget-header">💻 SSH 终端与多会话工作区</div>
        <div className="desc-text">多会话管理，支持预设配置与命令建议。</div>

        <div className="terminal-topbar">
          <div className="session-tabs">
            {terminalSessions.map((session) => (
              <button
                key={session.id}
                className={`session-tab ${activeSessionId === session.id ? 'active' : ''}`}
                onClick={() => setActiveSessionId(session.id)}
              >
                {session.name}
              </button>
            ))}
          </div>
          <div className="profile-controls">
            <select className="clean-input compact-input" value={terminalProfile} onChange={(event) => setTerminalProfile(event.target.value)}>
              {TERMINAL_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
            <button className="clean-btn" onClick={createSession}>新建会话</button>
          </div>
        </div>

        <div className="workspace-grid two-column terminal-grid">
          <div className="panel-card terminal-screen-card">
            <div className="panel-title">当前输出缓冲</div>
            <div className="terminal-screen">
              {currentSession.lines.map((line, index) => (
                <div key={`${line}-${index}`} className="terminal-line">{line}</div>
              ))}
            </div>
            <div className="terminal-input-row">
              <input
                className="clean-input terminal-input"
                value={terminalDraft}
                onChange={(event) => setTerminalDraft(event.target.value)}
                placeholder="输入模拟命令，例如 ros2 topic list"
              />
              <button className="clean-btn" onClick={() => runTerminalCommand(terminalDraft)}>执行</button>
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">会话策略与快捷动作</div>
            <div className="usage-list">
              {TERMINAL_PROFILES.map((profile) => (
                <div key={profile.id} className={`usage-item selectable ${terminalProfile === profile.id ? 'active' : ''}`} onClick={() => setTerminalProfile(profile.id)}>
                  <strong>{profile.label}</strong>
                  <span>{profile.desc}</span>
                </div>
              ))}
            </div>
            <div className="chip-cloud">
              {COMMAND_SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} className="chip-btn" onClick={() => runTerminalCommand(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderFiles = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📁 文件资源与传输队列</div>
        <div className="desc-text">SFTP 文件浏览、上传下载与传输队列管理。</div>

        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">连接配置</div>
            <div className="segmented-row">
              {['sftp', 'scp', 'ftp'].map((protocol) => (
                <button
                  key={protocol}
                  className={`segment-btn ${transferProtocol === protocol ? 'active' : ''}`}
                  onClick={() => setTransferProtocol(protocol)}
                >
                  {protocol.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="mini-form">
              <input className="clean-input" value={currentDevice?.ip || ''} readOnly />
              <input className="clean-input" value="root" readOnly />
              <input className="clean-input" value="站点已保存: 本地实验台 / 产线样机 / 社区样例板" readOnly />
            </div>
            <div className="usage-list">
              <div className="usage-item">保存站点配置可一键重连。</div>
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">操作方式</div>
            <div className="segmented-row">
              {[
                ['upload', '上传本地文件'],
                ['download', '下载远程结果'],
                ['sync', '目录同步'],
              ].map(([action, label]) => (
                <button
                  key={action}
                  className={`segment-btn ${fileAction === action ? 'active' : ''}`}
                  onClick={() => setFileAction(action as 'upload' | 'download' | 'sync')}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="clean-btn" onClick={appendTransferTask}>加入传输队列</button>
            <div className="warning-banner">主流远程工具会把传输队列显式展示出来，避免“点一下没反馈”的断层体验。</div>
          </div>
        </div>

        <div className="workspace-grid three-column">
          <div className="panel-card file-pane">
            <div className="panel-title">本地工作区</div>
            {LOCAL_FILES.map((file) => (
              <div key={file} className="file-row">📂 {file}</div>
            ))}
          </div>
          <div className="panel-card file-pane">
            <div className="panel-title">远程目录</div>
            {REMOTE_FILES.map((file) => (
              <div key={file} className="file-row">🛰️ {file}</div>
            ))}
          </div>
          <div className="panel-card">
            <div className="panel-title">传输队列</div>
            <div className="queue-list">
              {transferQueue.map((item) => (
                <div key={item.id} className="queue-item">
                  <div className="queue-head">
                    <strong>{item.name}</strong>
                    <span>{item.direction}</span>
                  </div>
                  <div className="progress-track thin">
                    <div className="progress-fill" style={{ width: `${item.progress}%` }}></div>
                  </div>
                  <div className="queue-meta">{item.status === 'done' ? '已完成，可继续下一步操作' : `执行中 ${item.progress}%`}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderVnc = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🖥️ 可视化桌面 (VNC)</div>
        <div className="desc-text">远程桌面连接，支持画质切换与快捷工具。</div>

        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">连接预设</div>
            <div className="segmented-row">
              {[
                ['smooth', '流畅优先'],
                ['balanced', '平衡模式'],
                ['sharp', '清晰优先'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  className={`segment-btn ${vncQuality === mode ? 'active' : ''}`}
                  onClick={() => setVncQuality(mode as 'smooth' | 'balanced' | 'sharp')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="segmented-row">
              {[
                ['fit', '窗口适配'],
                ['pixel', '1:1 像素'],
                ['dual', '双屏准备'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  className={`segment-btn ${vncLayout === mode ? 'active' : ''}`}
                  onClick={() => setVncLayout(mode as 'fit' | 'pixel' | 'dual')}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={vncOverlay} onChange={(event) => setVncOverlay(event.target.checked)} />
              <span>显示远程工具悬浮层与延迟提示</span>
            </label>
            <button className="clean-btn" onClick={startVncSession}>发起连接</button>
          </div>

          <div className="panel-card">
            <div className="panel-title">会话进度</div>
            <div className="progress-box">
              <div className="progress-meta">
                <span>{vncPhase}</span>
                <strong>{vncProgress}%</strong>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${vncProgress}%` }}></div>
              </div>
            </div>
            <div className="usage-list">
              <div className="usage-item">支持剪贴板共享、全屏与截屏。</div>
            </div>
          </div>
        </div>

        <div className="panel-card remote-desktop-card">
          <div className="panel-title">远程桌面视图</div>
          <div className={`remote-desktop ${vncConnected ? 'active' : ''}`}>
            <div className="desktop-window"></div>
            <div className="desktop-sidebar"></div>
            <div className="desktop-content">
              <div className="desktop-panel"></div>
              <div className="desktop-panel wide"></div>
            </div>
            {vncOverlay && (
              <div className="remote-overlay">
                <span>Quality: {vncQuality}</span>
                <span>Layout: {vncLayout}</span>
                <span>{vncConnected ? 'Session Ready' : 'Idle'}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderLowcode = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🧩 流程编排</div>
        <div className="desc-text">可视化流程编排，选择模板、拖拽节点、一键发布。</div>

        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">模板库</div>
            <div className="option-list">
              {FLOW_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  className={`select-card ${flowTemplate === template.id ? 'active' : ''}`}
                  onClick={() => setFlowTemplate(template.id)}
                >
                  <strong>{template.name}</strong>
                  <span>{template.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel-card">
            <div className="panel-title">发布阶段</div>
            <div className="segmented-row">
              {[
                ['draft', '草稿'],
                ['review', '待审核'],
                ['staging', '预发布'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  className={`segment-btn ${flowMode === mode ? 'active' : ''}`}
                  onClick={() => setFlowMode(mode as 'draft' | 'review' | 'staging')}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="clean-btn" onClick={runFlowValidation}>执行部署前检查</button>
            <div className="progress-box compact-box">
              <div className="progress-meta">
                <span>{isFlowChecking ? '检查进行中' : '检查可重复触发'}</span>
                <strong>{flowCheckProgress}%</strong>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${flowCheckProgress}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        <div className="workspace-grid three-column">
          <div className="panel-card">
            <div className="panel-title">节点素材区</div>
            {['摄像头输入', 'AI 推理', 'Topic 订阅', '文件同步', '告警通知'].map((node) => (
              <div key={node} className="file-row">◉ {node}</div>
            ))}
          </div>
          <div className="panel-card flow-canvas-card">
            <div className="panel-title">流程画布</div>
            <div className="flow-canvas">
              <div className="flow-node active">输入</div>
              <div className="flow-link"></div>
              <div className="flow-node">推理</div>
              <div className="flow-link"></div>
              <div className="flow-node">发布</div>
            </div>
          </div>
          <div className="panel-card">
            <div className="panel-title">部署说明</div>
            <div className="usage-list">
              <div className="usage-item">发布前自动检查环境变量与设备在线状态。</div>
              <div className="usage-item">支持版本历史管理与一键回滚。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderOpenClaw = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">⚙️ OpenClaws Agent Gateway</div>
        <div className="desc-text">大模型网关配置与渠道接入管理。</div>

        <div className="workspace-grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
          
          <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div className="panel-title">网关基础与渠道配置</div>
              <div className="usage-list">
                <div onClick={() => setOpenclawMode('model')} className={`usage-item selectable ${openclawMode === 'model' ? 'active' : ''}`} style={openclawMode === 'model' ? {borderColor: '#ff7a00', background: '#fff9f5'} : {}}>
                  <strong>🤖 模型配置 (Model Config)</strong>
                  <span>OpenAI, Qwen 等 API 接口密钥录入</span>
                </div>
                <div onClick={() => setOpenclawMode('feishu')} className={`usage-item selectable ${openclawMode === 'feishu' ? 'active' : ''}`} style={openclawMode === 'feishu' ? {borderColor: '#ff7a00', background: '#fff9f5'} : {}}>
                  <strong>🐦 飞书机器人 (Feishu Bot)</strong>
                  <span>获取回调地址并绑定自定义机器人</span>
                </div>
                <div onClick={() => setOpenclawMode('gateway')} className={`usage-item selectable ${openclawMode === 'gateway' ? 'active' : ''}`} style={openclawMode === 'gateway' ? {borderColor: '#ff7a00', background: '#fff9f5'} : {}}>
                  <strong>🌐 网关信息 (Gateway Info)</strong>
                  <span>本地运行状态与限流调用详情</span>
                </div>
                <div onClick={() => setOpenclawMode('install')} className={`usage-item selectable ${openclawMode === 'install' ? 'active' : ''}`} style={openclawMode === 'install' ? {borderColor: '#ff7a00', background: '#fff9f5'} : {}}>
                  <strong>📥 快速部署 (Installation)</strong>
                  <span>Node.js 网关代码拉取与 Docker 宏配置</span>
                </div>
              </div>
            </div>
            
            <button className="clean-btn" style={{ marginTop: 'auto', background: '#f1f5f9', color: '#334155' }}>
              检查容器运行状态 (Health Check)
            </button>
          </div>

          <div className="panel-card" style={{ background: '#f8fafc', animation: 'fadeIn 0.3s ease-in-out' }}>
            {openclawMode === 'model' && (
              <div style={{ padding: '16px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>大语言模型 (LLM) 密钥配置</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>选择模型提供商</label>
                    <select className="clean-input" style={{ width: '100%', background: 'white' }}>
                      <option>OpenAI (或兼容接口如 DeepSeek)</option>
                      <option>阿里云 Qwen (通义千问)</option>
                      <option>本地 Ollama 服务</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>API 访问地址 (Endpoint)</label>
                    <input type="text" className="clean-input" defaultValue="https://api.openai.com/v1" style={{ width: '100%', background: 'white' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>API 密钥 (API Key)</label>
                    <input type="password" className="clean-input" placeholder="sk-..." style={{ width: '100%', background: 'white' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>默认调用模型 (Model Name)</label>
                    <input type="text" className="clean-input" defaultValue="gpt-4" style={{ width: '100%', background: 'white' }} />
                  </div>
                  <button className="clean-btn" style={{ background: '#ff7a00', color: 'white', marginTop: '12px' }} onClick={() => {  setTimeout(()=>window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'}), 100); }}>
                    保存配置并前往底端对话框测试
                  </button>
                </div>
              </div>
            )}

            {openclawMode === 'feishu' && (
              <div style={{ padding: '16px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>应用集成：企业飞书机器人</h3>
                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
                  <span style={{ color: '#ff6b00', fontWeight: 'bold', fontSize: '0.9rem' }}>步骤 1: 配置请求地址 (Webhook URL)</span>
                  <div style={{ marginTop: '8px', padding: '8px', background: '#f1f5f9', borderRadius: '4px', fontFamily: 'monospace', color: '#334155' }}>
                    http://192.168.1.100:8000/api/wechat/lark
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '8px', marginBottom: 0 }}>请复制上游地址，前往 飞书开放平台 → 事件订阅中按判验证。</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <span style={{ color: '#ff6b00', fontWeight: 'bold', fontSize: '0.9rem' }}>步骤 2: 绑定 App 凭证</span>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>应用凭证配置</label>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <input type="text" className="clean-input" placeholder="App ID (cli_...)" style={{ flex: 1, minWidth: '150px', background: 'white' }} />
                      <input type="password" className="clean-input" placeholder="App Secret" style={{ flex: 1, minWidth: '150px', background: 'white' }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>Encrypt Key (事件加解密，可选)</label>
                    <input type="password" className="clean-input" placeholder="输入密钥" style={{ width: '100%', background: 'white' }} />
                  </div>
                  <button className="clean-btn" style={{ background: '#ff7a00', color: 'white', marginTop: '12px' }}>模拟发送消息测试卡片</button>
                </div>
              </div>
            )}

            {openclawMode === 'gateway' && (
              <div style={{ padding: '16px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>本地服务信息监控</h3>
                <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="metric-box" style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b', fontSize: '0.85rem' }}>网关代理状态</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, marginTop: '4px', color: '#22c55e' }}>● Running</div>
                  </div>
                  <div className="metric-box" style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b', fontSize: '0.85rem' }}>API 限流策略并发配置</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, marginTop: '4px' }}>120 QPS</div>
                  </div>
                </div>
                <div style={{ marginTop: '20px' }}>
                  <strong style={{ display: 'block', marginBottom: '12px' }}>实时请求调用日志 (Mock)</strong>
                  <div className="terminal-screen" style={{ minHeight: '160px', padding: '12px', background: '#0f172a', borderRadius: '8px', fontSize: '0.85rem' }}>
                    <div className="terminal-line" style={{ color: '#94a3b8', marginBottom: '4px' }}>[10:45:01] OpenClaws Gateway initialized on port 8000</div>
                    <div className="terminal-line" style={{ color: '#3b82f6', marginBottom: '4px' }}>[10:45:12] Model Endpoint linked & verified</div>
                    <div className="terminal-line" style={{ color: '#22c55e', marginBottom: '4px' }}>[10:46:05] POST /v1/chat/completions - 200 OK (212ms) - 1.2k tokens</div>
                    <div className="terminal-line" style={{ color: '#22c55e', marginBottom: '4px' }}>[10:46:06] POST /api/wechat/lark - 200 OK (89ms)</div>
                  </div>
                </div>
              </div>
            )}

            {openclawMode === 'install' && (
              <div style={{ padding: '16px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>快速安装与容器托管指南</h3>
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '8px', color: 'white', fontFamily: 'monospace', marginBottom: '20px', fontSize: '0.85rem' }}>
                  <div style={{ color: '#64748b', marginBottom: '8px' }}># 1. 下载构建源码并安装 Node.js 依赖</div>
                  <div style={{ marginBottom: '16px' }}>git clone https://github.com/openclaws/openclaws.git<br/>cd openclaws && npm install</div>
                  
                  <div style={{ color: '#64748b', marginBottom: '8px' }}># 2. 启动代理和回调网关</div>
                  <div style={{ marginBottom: '16px' }}>npm run start:gateway</div>
                </div>

                <div className="usage-item" style={{ background: 'white', border: '1px solid #e2e8f0' }}>
                  想要利用 Docker 进行脱机部署？点击下方生成您的专属 Compose 文件可以关联自带 Redis 和 PostgreSQL 保存消息上下文。
                </div>

                <button className="clean-btn" style={{ background: '#ff7a00', color: 'white', marginTop: '16px' }}>
                  获取 Docker-compose.yaml 初始化文件
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );

  const renderHardware = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🏥 硬件诊断监控</div>
        <div className="desc-text">实时硬件看板，异常检测与处置建议。</div>
        <div className="segmented-row hardware-mode-row">
          {[
            ['realtime', '实时窗口'],
            ['10m', '最近 10 分钟'],
            ['1h', '最近 1 小时'],
          ].map(([range, label]) => (
            <button
              key={range}
              className={`segment-btn ${hardwareRange === range ? 'active' : ''}`}
              onClick={() => setHardwareRange(range as 'realtime' | '10m' | '1h')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="metric-grid">
          {metricCards.map((metric) => (
            <div key={metric.label} className="metric-card">
              <div className="progress-meta">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
              <div className="progress-track thin">
                <div className="progress-fill" style={{ width: `${metric.bar}%` }}></div>
              </div>
              <div className="metric-hint">{metric.hint}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderExamples = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📦 示例应用</div>
        <div className="desc-text">官方与社区示例应用，含依赖检查与一键启动。</div>
        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">示例目录</div>
            <div className="option-list">
              {EXAMPLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`select-card ${examplePreset === preset.id ? 'active' : ''}`}
                  onClick={() => setExamplePreset(preset.id)}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.tag}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel-card">
            <div className="panel-title">启动前检查</div>
            <div className="usage-list">
              {EXAMPLE_PRESETS.map((preset) => (
                <div key={preset.id} className={`usage-item selectable ${examplePreset === preset.id ? 'active' : ''}`}>
                  <strong>{preset.name}</strong>
                  <span>{preset.readiness}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderRos = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🕸️ ROS 话题可视化</div>
        <div className="desc-text">ROS2 话题订阅与数据流可视化。</div>
        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">话题订阅</div>
            <div className="chip-cloud">
              {ROS_TOPICS.map((topic) => (
                <button key={topic} className={`chip-btn ${rosTopic === topic ? 'active' : ''}`} onClick={() => setRosTopic(topic)}>
                  {topic}
                </button>
              ))}
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={rosRecording} onChange={(event) => setRosRecording(event.target.checked)} />
              <span>录制当前 Topic 数据流，供后续回放与诊断使用</span>
            </label>
          </div>
          <div className="panel-card">
            <div className="panel-title">视图联动</div>
            <div className="scene-preview ros-preview">
              <div className="topic-card">{rosTopic}</div>
              <div className="bbox one"></div>
              <div className="preview-caption">Bounding Boxes / Image / Telemetry Overlay</div>
            </div>
            <div className="usage-list">
              <div className="usage-item">可转发到示例应用或流编排节点。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const MODEL_REPO = [
    { id: 'yolov5', name: 'YOLOv5s (BPU)', format: 'bin', size: '14.2 MB', status: 'deployed', fps: '30', desc: '通用目标检测，已优化为 BPU 推理格式' },
    { id: 'fcos', name: 'FCOS Efficient', format: 'bin', size: '22.8 MB', status: 'deployed', fps: '25', desc: '全卷积单阶段检测器，适合密集目标' },
    { id: 'mobilenet', name: 'MobileNetV2', format: 'onnx', size: '8.6 MB', status: 'pending', fps: '—', desc: '待转换为 BPU 格式，需运行 hb_mapper' },
    { id: 'unet', name: 'U-Net Segmentation', format: 'caffe', size: '31.4 MB', status: 'pending', fps: '—', desc: '语义分割模型，需先通过工具链量化' },
  ];

  const renderModels = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🤖 模型仓库与部署 (Target: {currentDevice?.name})</div>
        <div className="desc-text">AI 模型管理，支持格式转换、基准测试与一键部署。</div>

        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">模型列表</div>
            <div className="option-list">
              {MODEL_REPO.map(m => (
                <div key={m.id} className="select-card" style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{m.name}</strong>
                    <span className={`card-status-badge ${m.status === 'deployed' ? 'ok' : 'warn'}`} style={{ fontSize: '0.75rem', padding: '4px 8px' }}>
                      <span className="card-status-dot"></span>
                      {m.status === 'deployed' ? '已部署' : '待转换'}
                    </span>
                  </div>
                  <span>{m.desc}</span>
                  <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '0.8rem', color: '#94a3b8' }}>
                    <span>格式: {m.format}</span>
                    <span>大小: {m.size}</span>
                    {m.fps !== '—' && <span>推理: {m.fps} FPS</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">模型操作</div>
            <div className="usage-list">
              <div className="usage-item">
                <strong>📤 上传新模型</strong>
                <span>支持 .onnx / .caffemodel / .bin 格式，上传后自动检测模型结构</span>
              </div>
              <div className="usage-item">
                <strong>🔄 格式转换 (hb_mapper)</strong>
                <span>将 ONNX/Caffe 模型量化并转换为 BPU 推理优化格式</span>
              </div>
              <div className="usage-item">
                <strong>⚡ 推理基准测试</strong>
                <span>在当前设备上跑 benchmark，获取 FPS、延迟与精度报告</span>
              </div>
              <div className="usage-item">
                <strong>🚀 一键部署到 ROS 节点</strong>
                <span>将模型关联到推理节点，发布到 /hobot_dnn 话题</span>
              </div>
            </div>

            <button className="clean-btn" style={{ marginTop: '16px', width: '100%' }} onClick={() => addToast('模型上传入口已打开 (Mock)', 'info')}>
              📤 上传模型文件
            </button>
            <button className="clean-btn outline-btn" style={{ marginTop: '8px', width: '100%' }} onClick={() => addToast('基准测试已启动 (Mock)', 'info')}>
              ⚡ 运行 Benchmark
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMainContent = () => {
    if (isLoading) {
      return (
        <div className="center-stage" style={{ justifyContent: 'center', height: '100%', paddingBottom: '100px' }}>
          <div className="loading-stage">
            <div className="spinner"></div>
            <div>{loadingMsg}</div>
          </div>
        </div>
      );
    }

    if (activeTab === 'flasher') {
      return renderFlasher();
    }

    if (activeTab === 'terminal') {
      return renderTerminal();
    }

    if (activeTab === 'files') {
      return renderFiles();
    }

    if (activeTab === 'vnc') {
      return renderVnc();
    }

    if (activeTab === 'lowcode') {
      return renderLowcode();
    }

    if (activeTab === 'openclaw') {
      return renderOpenClaw();
    }

    if (activeTab === 'hardware') {
      return renderHardware();
    }

    if (activeTab === 'examples') {
      return renderExamples();
    }

    if (activeTab === 'ros') {
      return renderRos();
    }

    if (activeTab === 'models') {
      return renderModels();
    }

    return renderDashboard();
  };

  const renderToasts = () => (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{t.type === 'success' ? '✅' : t.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
          {t.message}
        </div>
      ))}
    </div>
  );

  const renderAddDeviceModal = () => {
    if (!showAddDevice) return null;
    return (
      <div className="modal-overlay" onClick={() => setShowAddDevice(false)}>
        <div className="modal-card" onClick={e => e.stopPropagation()}>
          <div className="modal-title">添加设备</div>
          <div className="modal-desc">手动输入设备信息或扫描局域网自动发现</div>

          <div style={{ marginBottom: '20px' }}>
            <button className="clean-btn" onClick={scanForDevices} disabled={isScanning} style={{ width: '100%' }}>
              {isScanning ? '🔍 扫描中...' : '🔍 扫描局域网'}
            </button>
          </div>

          {isScanning && (
            <div className="scan-animation">
              <div className="scan-dot"></div>
              <div className="scan-dot" style={{ animationDelay: '0.3s' }}></div>
              <div className="scan-dot" style={{ animationDelay: '0.6s' }}></div>
              <span>正在扫描 192.168.1.0/24 网段...</span>
            </div>
          )}

          {scannedDevices.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div className="panel-title">发现的设备</div>
              {scannedDevices.map((dev, i) => (
                <div key={i} className="usage-item selectable" style={{ marginBottom: '8px', cursor: 'pointer' }} onClick={() => addScannedDevice(dev)}>
                  <strong>{dev.name}</strong>
                  <span>{dev.ip} — 点击添加</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '20px', marginTop: '12px' }}>
            <div className="panel-title">手动添加</div>
            <div className="mini-form">
              <input className="clean-input" placeholder="设备名称 (如 RDK X5 - 工位3)" value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)} />
              <input className="clean-input" placeholder="IP 地址 (如 192.168.1.100)" value={newDeviceIp} onChange={e => setNewDeviceIp(e.target.value)} />
            </div>
          </div>

          <div className="modal-actions">
            <button className="clean-btn outline-btn" onClick={() => setShowAddDevice(false)}>取消</button>
            <button className="clean-btn" onClick={addNewDevice}>添加设备</button>
          </div>
        </div>
      </div>
    );
  };

  const renderSettingsPanel = () => {
    if (!showSettings) return null;
    return (
      <>
        <div className="settings-overlay" onClick={() => setShowSettings(false)}></div>
        <div className="settings-panel">
          <div className="settings-header">
            <div className="settings-title">⚙️ 客户端设置</div>
            <button className="settings-close" onClick={() => setShowSettings(false)}>×</button>
          </div>

          <div className="segmented-row" style={{ marginBottom: '24px' }}>
            {([['general', '通用'], ['connection', '连接'], ['about', '关于']] as const).map(([key, label]) => (
              <button key={key} className={`segment-btn ${settingsTab === key ? 'active' : ''}`} onClick={() => setSettingsTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {settingsTab === 'general' && (
            <div>
              <div className="settings-section">
                <div className="settings-section-title">界面</div>
                <div className="settings-row">
                  <span className="settings-label">界面语言</span>
                  <select className="clean-input" style={{ width: '140px', padding: '8px' }} value={language} onChange={e => { setLanguage(e.target.value); addToast('语言偏好已保存', 'success'); }}>
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <div className="settings-row">
                  <span className="settings-label">主题配色</span>
                  <span className="settings-value">白色 + 橙色 (默认)</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">启动时自动连接上次设备</span>
                  <input type="checkbox" checked={autoReconnect} onChange={e => { setAutoReconnect(e.target.checked); addToast('自动连接设置已更新', 'success'); }} style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
                </div>
              </div>
            </div>
          )}

          {settingsTab === 'connection' && (
            <div>
              <div className="settings-section">
                <div className="settings-section-title">SSH / SFTP</div>
                <div className="settings-row">
                  <span className="settings-label">连接超时 (秒)</span>
                  <input type="number" className="clean-input" style={{ width: '80px', padding: '8px' }} value={connectionTimeout} onChange={e => setConnectionTimeout(Number(e.target.value))} />
                </div>
                <div className="settings-row">
                  <span className="settings-label">断线自动重连</span>
                  <input type="checkbox" checked={autoReconnect} onChange={e => setAutoReconnect(e.target.checked)} style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
                </div>
                <div className="settings-row">
                  <span className="settings-label">默认认证方式</span>
                  <span className="settings-value">密码认证</span>
                </div>
              </div>
              <div className="settings-section">
                <div className="settings-section-title">VNC</div>
                <div className="settings-row">
                  <span className="settings-label">默认画质</span>
                  <span className="settings-value">平衡模式</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">自动适配分辨率</span>
                  <input type="checkbox" checked={true} readOnly style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
                </div>
              </div>
            </div>
          )}

          {settingsTab === 'about' && (
            <div>
              <div className="settings-section">
                <div className="settings-section-title">版本信息</div>
                <div className="settings-row">
                  <span className="settings-label">RDK Studio</span>
                  <span className="settings-value">v0.1.0 (Preview)</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">前端框架</span>
                  <span className="settings-value">React 19 + Vite 6</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">目标固件</span>
                  <span className="settings-value">RDK OS 2.x</span>
                </div>
              </div>
              <div className="usage-item" style={{ marginTop: '16px' }}>
                <strong>开源地址</strong>
                <span>github.com/RDKStudio — 欢迎反馈与贡献</span>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  const renderConfirmDialog = () => {
    if (!confirmDialog?.show) return null;
    return (
      <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
        <div className="modal-card" onClick={e => e.stopPropagation()}>
          <div className="modal-title">{confirmDialog.title}</div>
          <div className="modal-desc">{confirmDialog.message}</div>
          <div className="modal-actions">
            <button className="clean-btn outline-btn" onClick={() => setConfirmDialog(null)}>取消</button>
            <button className="clean-btn" style={{ background: '#ef4444' }} onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}>确认执行</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="canvas-shell">
      <div className="layout-container">
        
        {/* Left Sidebar - Infrastructure & Tools */}
        <div className="app-sidebar">
          <div className="sidebar-brand cursor-pointer" onClick={() => setActiveTab('dashboard')} style={{cursor: 'pointer'}}>
            RDK Studio
          </div>
          
          <div className="section-label">我的设备</div>
          <div className="device-list">
            {devices.map(dev => (
              <div 
                key={dev.id} 
                className={`device-item ${activeDevice === dev.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveDevice(dev.id);
                  setActiveTab('dashboard');
                }}
              >
                <div className="device-icon">🖧</div>
                <div className="device-info">
                  <h4 className="device-name">{dev.name}</h4>
                  <div className="device-status">
                    <span className={`status-dot ${dev.status === 'offline' ? 'offline' : ''}`}></span>
                    {dev.status === 'online' ? dev.ip : 'Disconnected'}
                  </div>
                </div>
              </div>
            ))}
            <button className="clean-btn outline-btn" style={{marginTop: '10px', padding: '8px', fontSize: '0.85rem'}} onClick={() => setShowAddDevice(true)}>
               + 扫描 / 添加设备
            </button>
          </div>

          <div className="section-label">基础工具箱</div>
          <div className="sidebar-tools">
             <button className={`tool-btn ${activeTab === 'flasher' ? 'active' : ''}`} onClick={() => setActiveTab('flasher')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>💽</span> 镜像烧录
             </button>
             <button className={`tool-btn ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>📁</span> 文件资源
             </button>
             <button className={`tool-btn ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>💻</span> SSH 终端
             </button>
             <button className={`tool-btn ${activeTab === 'vnc' ? 'active' : ''}`} onClick={() => setActiveTab('vnc')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>🖥️</span> 远程桌面
             </button>
             <button className={`tool-btn ${activeTab === 'lowcode' ? 'active' : ''}`} onClick={() => setActiveTab('lowcode')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>🧩</span> 流程编排
             </button>
             <button className={`tool-btn ${activeTab === 'hardware' ? 'active' : ''}`} onClick={() => setActiveTab('hardware')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>🏥</span> 硬件诊断
             </button>
          </div>
          
          <div className="sidebar-footer" style={{ marginTop: 'auto', borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
             <button className="tool-btn" onClick={() => window.open('https://developer.horizon.cc/', '_blank')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>🍠</span> <span style={{color: '#ff6b00', fontWeight: 'bold'}}>地瓜开发者社区</span>
             </button>
             <button className="tool-btn" onClick={() => setShowSettings(true)}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>⚙️</span> 客户端设置
             </button>
          </div>
        </div>

        {/* Main Area - Dynamic Apps & Copilot */}
        <div className="main-area">
          <div className="top-toolbar" style={{ height: '48px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px', marginRight: '20px' }}>
                <div style={{width:'12px', height:'12px', borderRadius:'50%', background:'#f87171'}}></div>
                <div style={{width:'12px', height:'12px', borderRadius:'50%', background:'#facc15'}}></div>
                <div style={{width:'12px', height:'12px', borderRadius:'50%', background:'#4ade80'}}></div>
             </div>
             <div className="context-title" style={{ flex: 1, justifyContent: 'center' }}>
               {activeTab === 'dashboard' && 'AI Copilot 工作台'}
               {activeTab === 'flasher' && '系统镜像工具'}
               {activeTab === 'terminal' && '终端环境'}
               {activeTab === 'files' && '文件管理器 (SFTP)'}
               {activeTab === 'vnc' && '可视化桌面 (VNC)'}
               {activeTab === 'lowcode' && 'Node-RED 编排'}
              {activeTab === 'openclaw' && 'OpenClaws 网关配置'}
              {activeTab === 'hardware' && '硬件监控工作台'}
              {activeTab === 'examples' && '示例应用目录'}
              {activeTab === 'ros' && 'ROS2 可视化'}
              {activeTab === 'models' && '模型仓库与部署'}
               <span style={{color: '#94a3b8', fontSize: '0.9rem', fontWeight: 'normal', display: 'inline-flex', alignItems: 'center', marginLeft: '10px'}}> 
                 <span style={{margin: '0 6px'}}>/</span> 
                 <span className={`status-dot ${currentDevice?.status === 'offline' ? 'offline' : ''}`} style={{marginRight: '6px', width:'6px', height:'6px'}}></span> 
                 {currentDevice?.name} ({currentDevice?.ip})
               </span>
             </div>
             <div className="toolbar-actions">
                <button className="icon-btn" title="查看用户/许可证">👤</button>
             </div>
          </div>

          <div className="canvas-viewport">
            {renderMainContent()}
          </div>

          {/* Contextual AI Dock */}
          <div className={`floating-dock ${chatExpanded ? 'chat-open' : ''}`}>
            <div className="dock-wrapper">
              {/* Chat Panel */}
              {chatExpanded && chatMessages.length > 0 && (
                <div className="chat-panel">
                  <div className="chat-panel-header">
                    <span className="chat-panel-title">✨ AI 助手</span>
                    <button className="chat-panel-close" onClick={() => setChatExpanded(false)} title="收起">✕</button>
                  </div>
                  <div className="chat-messages">
                    {chatMessages.map(msg => (
                      <div key={msg.id} className={`chat-message ${msg.role}`}>
                        <div className={`chat-bubble ${msg.role}`}>
                          <p>{msg.text}</p>
                          {msg.action && (
                            <button
                              className="chat-action-btn"
                              onClick={() => { setActiveTab(msg.action!.tab); }}
                            >
                              {msg.action.label} →
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {aiTyping && (
                      <div className="chat-message ai">
                        <div className="chat-bubble ai typing">
                          <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {showSuggestions && !chatExpanded && filteredSuggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {filteredSuggestions.slice(0, 6).map((s, i) => (
                    <div key={i} className="suggestion-item" onMouseDown={() => { setCmd(s.text); setShowSuggestions(false); }}>
                      <span className="suggestion-icon">{s.icon}</span>
                      {s.text}
                    </div>
                  ))}
                </div>
              )}

              <form className="input-box" onSubmit={handleCommand}>
                <span style={{marginRight: '12px', fontSize: '1.2rem', color: '#ff6b00'}}>✨</span>
                <input 
                  type="text" 
                  className="cmd-input" 
                  placeholder={`向 AI 助手提问... (按 / 聚焦)`}
                  value={cmd}
                  onChange={e => setCmd(e.target.value)}
                  onFocus={() => { if (!chatExpanded) setShowSuggestions(true); }}
                  onBlur={() => window.setTimeout(() => setShowSuggestions(false), 200)}
                />
                <button type="submit" className="send-btn" title="发送">
                  ↑
                </button>
              </form>
            </div>
          </div>

        </div>

      </div>
      {renderToasts()}
      {renderAddDeviceModal()}
      {renderSettingsPanel()}
      {renderConfirmDialog()}
    </div>
  );
}
