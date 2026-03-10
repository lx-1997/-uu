import React, { useEffect, useState } from 'react';
import './styles.css';

type Tab = 'dashboard' | 'flasher' | 'terminal' | 'files' | 'vnc' | 'lowcode' | 'openclaw' | 'hardware' | 'examples' | 'ros';

const MOCK_DEVICES = [
  { id: '1', name: 'RDK X3 - Local', status: 'online', ip: '192.168.1.100' },
  { id: '2', name: 'RDK Ultra - Lab', status: 'offline', ip: '192.168.1.105' },
];

const DASHBOARD_CARDS: Array<{ tab: Tab; title: string; description: string; loading: string }> = [
  {
    tab: 'openclaw',
    title: '🦞 OpenClaw (小龙虾)',
    description:
      '深度体验 RDK 社区超高人气生态项目，利用 BPU 进行小龙虾的智能识别、多目标追踪及姿态预估，展示无缝的端到端 AI 落地全流程。',
    loading: '正在载入 OpenClaw 场景编排与推理面板...',
  },
  {
    tab: 'hardware',
    title: '🏥 硬件诊断监控',
    description: '集成 hrutools 与 bputop，实时监控 BPU 算力负载、CPU 占用、内存及芯片温度条形图。',
    loading: '正在汇总设备诊断数据与异常建议...',
  },
  {
    tab: 'examples',
    title: '📦 示例应用',
    description:
      '全面汇聚 RDK 官方与生态节点，一键运行 TogetherROS.b 环境下的视觉跟随、手势控制、双摄测距等深度学习与机器视觉 Demo。',
    loading: '正在准备示例应用目录与运行前检查...',
  },
  {
    tab: 'ros',
    title: '🕸️ ROS 话题可视化',
    description: '订阅并可视化设备上的 ROS2 话题 (如 /hobot_dnn/bbox)。直接在浏览器展示点云、图像帧及 AI 推理框。',
    loading: '正在建立 ROS2 可视化工作区...',
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
  const [openclawMode, setOpenclawMode] = useState<'detect' | 'track' | 'harvest'>('detect');
  const [openclawThreshold, setOpenclawThreshold] = useState(74);
  const [hardwareRange, setHardwareRange] = useState<'realtime' | '10m' | '1h'>('realtime');
  const [examplePreset, setExamplePreset] = useState('follow');
  const [rosTopic, setRosTopic] = useState('/hobot_dnn/bbox');
  const [rosRecording, setRosRecording] = useState(false);

  const currentDevice = MOCK_DEVICES.find((device) => device.id === activeDevice);
  const currentSession = terminalSessions.find((session) => session.id === activeSessionId) ?? terminalSessions[0];

  const openWorkspace = (nextTab: Tab, message: string) => {
    setIsLoading(true);
    setLoadingMsg(message);
    window.setTimeout(() => {
      setActiveTab(nextTab);
      setIsLoading(false);
    }, 650);
  };

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;

    setLoadingMsg('AI 正在介入分析需求...');
    setIsLoading(true);

    window.setTimeout(() => {
      const lowerCmd = cmd.toLowerCase();
      if (lowerCmd.includes('烧录') || lowerCmd.includes('镜像') || lowerCmd.includes('flash')) {
        setActiveTab('flasher');
      } else if (lowerCmd.includes('终端') || lowerCmd.includes('terminal') || lowerCmd.includes('ssh')) {
        setActiveTab('terminal');
      } else if (lowerCmd.includes('文件') || lowerCmd.includes('sftp')) {
        setActiveTab('files');
      } else if (lowerCmd.includes('vnc') || lowerCmd.includes('桌面')) {
        setActiveTab('vnc');
      } else if (lowerCmd.includes('流程') || lowerCmd.includes('编排') || lowerCmd.includes('node-red')) {
        setActiveTab('lowcode');
      } else if (lowerCmd.includes('小龙虾') || lowerCmd.includes('openclaw')) {
        setActiveTab('openclaw');
      } else if (lowerCmd.includes('硬件') || lowerCmd.includes('bpu') || lowerCmd.includes('温度')) {
        setActiveTab('hardware');
      } else if (lowerCmd.includes('示例') || lowerCmd.includes('demo')) {
        setActiveTab('examples');
      } else if (lowerCmd.includes('ros') || lowerCmd.includes('topic')) {
        setActiveTab('ros');
      } else {
        setActiveTab('dashboard');
      }
      setIsLoading(false);
      setCmd('');
    }, 800);
  };

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
    setFlashProgress(0);
    setFlashPhase('准备扫描目标介质与系统镜像');
    setFlashStep(1);
    setIsFlashing(true);
  };

  const appendTransferTask = () => {
    const direction = fileAction === 'upload' ? '上传' : fileAction === 'download' ? '下载' : '同步';
    const name = fileAction === 'upload' ? 'configs/device-profile.yaml' : fileAction === 'download' ? 'userdata/trace.log' : 'workspace/rdk-demo/';
    setTransferQueue((prev) => [
      { id: `queue-${prev.length + 1}`, name, direction, progress: 0, status: 'running' },
      ...prev,
    ]);
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
  };

  const runFlowValidation = () => {
    setFlowCheckProgress(0);
    setIsFlowChecking(true);
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

      <div className="quick-grid">
        {DASHBOARD_CARDS.map((card) => (
          <div key={card.tab} className="startup-card" onClick={() => openWorkspace(card.tab, card.loading)}>
            <h3>{card.title}</h3>
            <p>{card.description}</p>
            <div className="card-action">点击进入完整交互流</div>
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
          参考 balenaEtcher 的三段式路径和桌面烧录器常见的风险兜底策略，这里把烧录流程拆成镜像选择、介质确认、策略校验、完成交付四个阶段。
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
            <div className="panel-title">后续使用方式</div>
            <div className="usage-list">
              <div className="usage-item">首次启动向导会引导配置网络、SSH 与示例环境。</div>
              <div className="usage-item">完成烧录后可一键跳转到终端、文件同步或示例应用部署。</div>
              <div className="usage-item">后续接真实实现时，这里可输出烧录报告、校验摘要和失败回滚入口。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderTerminal = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget terminal-shell">
        <div className="widget-header">💻 SSH 终端与多会话工作区</div>
        <div className="desc-text">参考 VS Code 与 MobaXterm 的会话分组思路，终端不只是一个黑框，而是包含会话预设、命令建议、输出缓冲与后续动作的操作台。</div>

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
            <div className="usage-list">
              <div className="usage-item">后续可接入命令历史、错误高亮、文件链接跳转与 AI 命令修正。</div>
              <div className="usage-item">支持把终端结果转成任务卡片，继续流转到文件同步或示例部署。</div>
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
        <div className="desc-text">借鉴 WinSCP 的登录入口、站点管理与双栏文件操作方式，这里把“连接配置 + 文件浏览 + 传输队列 + 结果回看”放进同一个视图。</div>

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
              <div className="usage-item">保存站点后可一键重连，并在将来复用到终端和远程桌面。</div>
              <div className="usage-item">后续接真实实现时可在这里扩展密钥认证、代理、端口与预同步策略。</div>
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
        <div className="desc-text">参考 RealVNC 的统一入口和远程协作工具的惯用方式，这个原型把连接质量、显示策略、快捷工具条和会话状态放到一个可持续操作的工作台中。</div>

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
              <div className="usage-item">连接成功后可映射剪贴板、全屏、截屏和重连策略。</div>
              <div className="usage-item">质量模式切换不应中断会话，而应即时反馈带宽与帧率变化。</div>
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
        <div className="desc-text">借鉴 Node-RED 的可视化编排习惯，这里把模板选择、节点区、发布前检查和环境流转拆成清晰的交互层，不接任何真实执行器。</div>

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
            <div className="panel-title">后续使用方式</div>
            <div className="usage-list">
              <div className="usage-item">草稿阶段强调节点编排速度，待审核阶段突出差异与依赖变更。</div>
              <div className="usage-item">真实接入后可在这里挂载节点参数面板、版本历史与一键回滚。</div>
              <div className="usage-item">部署前检查建议覆盖环境变量、设备在线、Topic 可达性和资源阈值。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderOpenClaw = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🦞 OpenClaw (小龙虾)</div>
        <div className="desc-text">把热门社区项目从“卡片入口”延展成可操作场景。这里重点模拟源选择、阈值调整、模式切换和结果回看，不做真实推理接入。</div>
        <div className="workspace-grid two-column">
          <div className="panel-card preview-card">
            <div className="panel-title">场景预览</div>
            <div className="scene-preview">
              <div className="bbox one"></div>
              <div className="bbox two"></div>
              <div className="preview-caption">Camera Stream / Inference Overlay</div>
            </div>
          </div>
          <div className="panel-card">
            <div className="panel-title">策略设置</div>
            <div className="segmented-row">
              {[
                ['detect', '识别模式'],
                ['track', '追踪模式'],
                ['harvest', '采收辅助'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  className={`segment-btn ${openclawMode === mode ? 'active' : ''}`}
                  onClick={() => setOpenclawMode(mode as 'detect' | 'track' | 'harvest')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="slider-block">
              <div className="progress-meta">
                <span>置信阈值</span>
                <strong>{openclawThreshold}%</strong>
              </div>
              <input
                className="range-input"
                type="range"
                min="50"
                max="95"
                value={openclawThreshold}
                onChange={(event) => setOpenclawThreshold(Number(event.target.value))}
              />
            </div>
            <div className="usage-list">
              <div className="usage-item">当前策略将优先突出小龙虾边界框、姿态标签和误检提醒。</div>
              <div className="usage-item">后续真实实现时可串联相机标定、推理日志和抓取动作回放。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderHardware = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🏥 硬件诊断监控</div>
        <div className="desc-text">这个视图不只是显示几个数字，而是模拟“看板 + 异常解释 + 下一步建议”的诊断工作流。</div>
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
        <div className="desc-text">主流开发平台往往会把示例应用做成“可检索目录 + 依赖检查 + 启动方案”，这样用户不会只停留在看见卡片，而是能自然进入下一步。</div>
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
              <div className="usage-item">后续真实接入时可把依赖缺失项转为一键修复动作，如自动安装模型或拉起 ROS 节点。</div>
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
        <div className="desc-text">可视化场景重点不是画布本身，而是让用户明确知道当前订阅了什么、刷新策略如何、数据接下来还能去哪。</div>
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
              <div className="usage-item">当前主题可转发到示例应用调试、终端诊断或流编排节点。</div>
              <div className="usage-item">录包后续可接到离线回放与故障复现工作流。</div>
            </div>
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

    return renderDashboard();
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
            {MOCK_DEVICES.map(dev => (
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
            <button className="clean-btn outline-btn" style={{marginTop: '10px', padding: '8px', fontSize: '0.85rem'}}>
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
          </div>
          
          <div className="sidebar-footer" style={{ marginTop: 'auto', borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
             <button className="tool-btn" onClick={() => window.open('https://developer.horizon.cc/', '_blank')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>🍠</span> <span style={{color: '#ff6b00', fontWeight: 'bold'}}>地瓜开发者社区</span>
             </button>
             <button className="tool-btn">
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
              {activeTab === 'openclaw' && 'OpenClaw 交互实验区'}
              {activeTab === 'hardware' && '硬件监控工作台'}
              {activeTab === 'examples' && '示例应用目录'}
              {activeTab === 'ros' && 'ROS2 可视化'}
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
          <div className="floating-dock">
            <form className="input-box" onSubmit={handleCommand}>
              <span style={{marginRight: '12px', fontSize: '1.2rem', color: '#ff6b00'}}>✨</span>
              <input 
                type="text" 
                className="cmd-input" 
                placeholder={`让 AI 协助开发 ${currentDevice?.name} (例如 "帮我用C++订阅一个ROS话题")...`}
                value={cmd}
                onChange={e => setCmd(e.target.value)}
                disabled={isLoading}
              />
              <button type="submit" className="send-btn" disabled={isLoading} title="发送">
                ↑
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
