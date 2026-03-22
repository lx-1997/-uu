import { useState, useEffect } from 'react';
import {
  fetchDeviceDiagnostics,
  fetchDeviceOpenClawHealth,
  fetchDeviceWorkspaceHealth,
  installDeviceOpenClaw,
  type DeviceWorkspaceHealth,
  type OpenClawHealthStatus,
} from '../api';
import { useAppState } from '../hooks/useAppState';
import { DASHBOARD_CARDS } from '../constants';
import { parseMetrics } from '../utils/diagnostics';

export default function Dashboard() {
  const {
    currentDevice,
    devices,
    openWorkspace,
    diagnosticOpen,
    setDiagnosticOpen,
    activities,
    addToast,
    setShowAddDevice,
    setActiveTab,
    setChatExpanded,
    setCmd,
    obStep,
    setObStep,
    selectedBoard,
    setSelectedBoard,
  } = useAppState();
  const [hideWizard, setHideWizard] = useState(false);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticOutput, setDiagnosticOutput] = useState<string[]>([]);
  const [openclawChecking, setOpenclawChecking] = useState(false);
  const [openclawInstalling, setOpenclawInstalling] = useState(false);
  const [openclawOutput, setOpenclawOutput] = useState<string[]>([]);
  const [openclawHealth, setOpenclawHealth] = useState<OpenClawHealthStatus | null>(null);
  const [workspaceHealth, setWorkspaceHealth] = useState<DeviceWorkspaceHealth | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [topMetrics, setTopMetrics] = useState({
    memory: '--',
    temp: '--',
    bpu: '--',
    uptime: '--',
    tempValue: -1,
    bpuValue: -1,
    updatedAt: '--',
  });

  const updateMetrics = (output: string) => {
    const m = parseMetrics(output);
    const memory = m.memUsed !== '--' && m.memTotal !== '--' ? `${m.memUsed}/${m.memTotal}` : '--';
    setTopMetrics({
      memory, temp: m.temp, bpu: m.bpu, uptime: m.uptime,
      tempValue: m.tempC, bpuValue: m.bpuValue,
      updatedAt: new Date().toLocaleTimeString(),
    });
  };

  useEffect(() => {
    if (devices.length > 0 && obStep === 'connect') setObStep('openclaw');
  }, [devices.length, obStep, setObStep]);

  const showWizard = !hideWizard && (devices.length === 0 || (obStep !== 'done' && obStep !== 'board'));
  const showDoneScreen = !hideWizard && devices.length > 0 && obStep === 'done';

  useEffect(() => {
    if (showDoneScreen) {
      const timer = setTimeout(() => setHideWizard(true), 0);
      return () => clearTimeout(timer);
    }
  }, [showDoneScreen]);

  useEffect(() => {
    if (!currentDevice) return;
    let cancelled = false;
    const loadMetrics = () => {
      fetchDeviceDiagnostics(currentDevice.id)
        .then((res) => { if (!cancelled) updateMetrics(res.output); })
        .catch(() => { if (!cancelled) setTopMetrics({ memory: '--', temp: '--', bpu: '--', uptime: '--', tempValue: -1, bpuValue: -1, updatedAt: '--' }); });
    };
    loadMetrics();
    const timer = window.setInterval(loadMetrics, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [currentDevice?.id]);

  const runOpenClawHealthCheck = () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    setOpenclawChecking(true);
    fetchDeviceOpenClawHealth(currentDevice.id)
      .then((res) => {
        setOpenclawHealth(res.status);
        setOpenclawOutput((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] ${res.status.summary}`,
        ].slice(-12));
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : 'OpenClaw 状态检测失败', 'error');
      })
      .finally(() => setOpenclawChecking(false));
  };

  const runWorkspaceHealthCheck = () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    setWorkspaceHealthLoading(true);
    fetchDeviceWorkspaceHealth(currentDevice.id)
      .then((res) => {
        setWorkspaceHealth(res.status);
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : '工作区环境检测失败', 'error');
      })
      .finally(() => setWorkspaceHealthLoading(false));
  };

  const runOpenClawInstall = () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    setOpenclawInstalling(true);
    setOpenclawOutput((prev) => [...prev, `[${new Date().toLocaleTimeString()}] 开始执行一键安装 OpenClaw...`].slice(-12));
    installDeviceOpenClaw(currentDevice.id)
      .then((res) => {
        const lines = String(res.output || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-8);
        setOpenclawOutput((prev) => [...prev, ...lines].slice(-20));
        addToast(res.ok ? 'OpenClaw 安装任务执行完成，请检测状态' : 'OpenClaw 安装失败，请查看输出', res.ok ? 'success' : 'error');
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : 'OpenClaw 安装失败', 'error');
      })
      .finally(() => {
        setOpenclawInstalling(false);
        setTimeout(() => {
          runOpenClawHealthCheck();
          runWorkspaceHealthCheck();
        }, 800);
      });
  };

  useEffect(() => {
    if (obStep !== 'openclaw' || !currentDevice) return;
    runOpenClawHealthCheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obStep, currentDevice?.id]);

  useEffect(() => {
    if (!currentDevice) {
      setOpenclawHealth(null);
      setWorkspaceHealth(null);
      return;
    }
    runOpenClawHealthCheck();
    runWorkspaceHealthCheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  /* ── Onboarding wizard ── */
  if (showWizard || (devices.length === 0 && !hideWizard)) {
    const boards = [
      { id: 'x3', name: 'RDK X3', emoji: '🟠', bpu: '5 TOPS', chip: 'Sunrise 3 · 4核 A53', mem: '2GB DDR4', storage: 'SD / 8GB eMMC', os: 'Ubuntu 20.04 / 22.04', net: '百兆网口', price: '¥299 起', desc: '入门级边缘 AI，适合教学和轻量推理', url: 'https://developer.horizon.cc/rdkx3' },
      { id: 'x5', name: 'RDK X5', emoji: '🔴', bpu: '10 TOPS', chip: 'Sunrise 5 · 8核 A55', mem: '4GB LPDDR4', storage: 'SD / 32GB eMMC', os: 'Ubuntu 22.04 + ROS2', net: '千兆 · WiFi 6', price: '¥499 起', desc: '主力开发板，多路摄像头 + 实时推理', url: 'https://developer.horizon.cc/rdkx5' },
      { id: 's100', name: 'RDK S100', emoji: '🟣', bpu: '80 TOPS', chip: 'Journey 6 · CPU+BPU+MCU', mem: '16GB LPDDR5', storage: 'eMMC / NVMe', os: 'Ubuntu 22.04 + ROS2', net: '双千兆 · CAN', price: '¥1999 起', desc: '大算力行业板，自动驾驶 / 机器人首选', url: 'https://developer.horizon.cc/rdks100' },
      { id: 'ultra', name: 'RDK Ultra', emoji: '⚫', bpu: '128 TOPS', chip: 'Journey 5 · 8核 A55', mem: '8GB LPDDR4x', storage: 'eMMC 64G / NVMe', os: 'Ubuntu 22.04 + ROS2', net: '双千兆', price: '联系销售', desc: '旗舰算力平台，多模态融合与大模型推理', url: 'https://developer.horizon.cc/rdkultra' },
    ];
    const board = boards.find(b => b.id === selectedBoard);

    const stepIdx = ['board','flash','connect','openclaw','done'].indexOf(obStep);
    const steps = [
      { id: 'board', label: '选择板卡', icon: 'developer_board' },
      { id: 'flash', label: '烧录系统', icon: 'system_update' },
      { id: 'connect', label: '连接设备', icon: 'cable' },
      { id: 'openclaw', label: 'OpenClaw 检查', icon: 'shield' },
      { id: 'done', label: '开始使用', icon: 'check_circle' },
    ] as const;

    return (
      <div className="ob-fullscreen">
        <div className="ob-shell">
          {/* ── Stepper ── */}
          <nav className="ob-stepper">
            {steps.map((s, i) => (
              <div key={s.id} className={`ob-step ${stepIdx === i ? 'active' : ''} ${stepIdx > i ? 'done' : ''}`}>
                <div className="ob-step-indicator">
                  <span className="material-symbols-outlined ob-step-icon">
                    {stepIdx > i ? 'check' : s.icon}
                  </span>
                </div>
                <span className="ob-step-label">{s.label}</span>
                {i < steps.length - 1 && <div className="ob-step-line" />}
              </div>
            ))}
          </nav>

          {/* ── Step Content ── */}
          <div className="ob-body">
            {obStep === 'board' && (
              <div className="ob-animate">
                <div className="ob-title-group">
                  <h1 className="ob-title">选择你的开发板</h1>
                  <p className="ob-subtitle">RDK 全系列覆盖从入门教学到行业部署场景</p>
                </div>
                <div className="ob-board-grid">
                  {boards.map(b => (
                    <button key={b.id} className={`ob-board ${selectedBoard === b.id ? 'selected' : ''}`} onClick={() => setSelectedBoard(b.id)}>
                      <div className="ob-board-header">
                        <span className="ob-board-emoji">{b.emoji}</span>
                        <div className="ob-board-title">
                          <strong>{b.name}</strong>
                          <span className="ob-board-bpu">{b.bpu}</span>
                        </div>
                      </div>
                      <p className="ob-board-desc">{b.desc}</p>
                      <div className="ob-board-specs">
                        <span>{b.chip}</span>
                        <span>{b.mem}</span>
                        <span>{b.net}</span>
                      </div>
                      <div className="ob-board-price">{b.price}</div>
                      {selectedBoard === b.id && (
                        <div className="ob-board-check">
                          <span className="material-symbols-outlined">check_circle</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {obStep === 'flash' && (
              <div className="ob-animate">
                <div className="ob-title-group">
                  <h1 className="ob-title">为 {board?.name} 烧录系统</h1>
                  <p className="ob-subtitle">将系统镜像写入 SD 卡，插卡上电即可运行</p>
                </div>
                <div className="ob-action-center">
                  <button className="ob-hero-card" onClick={() => setActiveTab('flasher')}>
                    <div className="ob-hero-icon">
                      <span className="material-symbols-outlined">download</span>
                    </div>
                    <div className="ob-hero-text">
                      <strong>打开镜像烧录工具</strong>
                      <span>选择镜像 → 选择存储 → 一键写入</span>
                    </div>
                    <span className="material-symbols-outlined ob-hero-arrow">arrow_forward</span>
                  </button>
                </div>
              </div>
            )}

            {obStep === 'connect' && (
              <div className="ob-animate">
                <div className="ob-title-group">
                  <h1 className="ob-title">连接 {board?.name}</h1>
                  <p className="ob-subtitle">确保板卡已上电并接入网络</p>
                </div>
                <div className="ob-connect-grid">
                  <button className="ob-connect-card" onClick={() => setShowAddDevice(true)}>
                    <div className="ob-connect-icon">
                      <span className="material-symbols-outlined">wifi</span>
                    </div>
                    <strong>SSH 网络连接</strong>
                    <span>通过网线或 WiFi 连接设备</span>
                  </button>
                  <button className="ob-connect-card" onClick={() => setShowAddDevice(true)}>
                    <div className="ob-connect-icon usb">
                      <span className="material-symbols-outlined">usb</span>
                    </div>
                    <strong>USB 串口调试</strong>
                    <span>{selectedBoard === 's100' ? 'Type-C' : 'Micro USB'} 直连</span>
                  </button>
                </div>
              </div>
            )}

            {obStep === 'openclaw' && (
              <div className="ob-animate">
                <div className="ob-title-group">
                  <h1 className="ob-title">OpenClaw 环境检查</h1>
                  <p className="ob-subtitle">未安装可一键安装；token 缺失/失效时将仅保留基础能力</p>
                </div>
                <div className="ob-action-center ob-openclaw-center">
                  <div className="settings-section ob-openclaw-panel">
                    <div className="settings-row">
                      <span className="settings-label">检测结果</span>
                      <span className="settings-value">{openclawHealth?.summary || '尚未检测'}</span>
                    </div>
                    <div className="settings-row">
                      <span className="settings-label">安装状态</span>
                      <span className="settings-value">{openclawHealth?.installed ? `已安装（${openclawHealth.version || '版本未知'}）` : '未安装'}</span>
                    </div>
                    <div className="settings-row">
                      <span className="settings-label">网关状态</span>
                      <span className="settings-value">{openclawHealth?.gatewayRunning ? '运行中' : '未运行'}</span>
                    </div>
                    <div className="settings-row">
                      <span className="settings-label">Token 状态</span>
                      <span className="settings-value">
                        {openclawHealth?.tokenStatus === 'ok' ? '可用' : openclawHealth?.tokenStatus === 'missing' ? '缺失' : openclawHealth?.tokenStatus === 'invalid' ? '无效' : '待确认'}
                      </span>
                    </div>
                    <div className="settings-row">
                      <button className="segment-btn" disabled={openclawChecking} onClick={runOpenClawHealthCheck}>
                        {openclawChecking ? '检测中...' : '重新检测'}
                      </button>
                      <button className="segment-btn active" disabled={openclawInstalling} onClick={runOpenClawInstall}>
                        {openclawInstalling ? '安装中...' : '一键安装 OpenClaw'}
                      </button>
                      <button className="segment-btn" onClick={() => setActiveTab('openclaw')}>
                        打开 OpenClaw 配置
                      </button>
                    </div>
                    {openclawOutput.length > 0 && (
                      <div className="msg-block terminal-block ob-openclaw-log">
                        <div className="terminal-block-body">
                          {openclawOutput.map((line, i) => <div key={i} className="terminal-block-line">{line}</div>)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {obStep === 'done' && (
              <div className="ob-animate">
                <div className="ob-done-celebration">
                  <div className="ob-done-check">
                    <span className="material-symbols-outlined">check_circle</span>
                  </div>
                  <h1 className="ob-title">一切就绪</h1>
                  <p className="ob-subtitle">{board?.name || 'RDK'} 已准备好，选择你想做的事情</p>
                </div>
                <div className="ob-done-grid">
                  {[
                    { icon: 'hub', title: 'OpenClaw 工作台', desc: 'AI 网关对话与编排', tab: 'openclaw' as const },
                    { icon: 'terminal', title: '终端环境', desc: '执行命令与运维操作', tab: 'terminal' as const },
                    { icon: 'monitoring', title: '硬件监控', desc: 'CPU / BPU / 温度', tab: 'hardware' as const },
                  ].map(item => {
                    const openclawBlocked = item.tab === 'openclaw' && (!openclawHealth || !openclawHealth.aiReady);
                    return (
                    <button
                      key={item.tab}
                      className="ob-done-card"
                      disabled={openclawBlocked}
                      title={openclawBlocked ? 'OpenClaw 尚未就绪，请先完成安装/Token 配置' : ''}
                      onClick={() => { setHideWizard(true); setActiveTab(item.tab); }}
                    >
                      <span className="material-symbols-outlined ob-done-card-icon">{item.icon}</span>
                      <strong>{item.title}</strong>
                      <span>{openclawBlocked ? 'OpenClaw 尚未就绪，请先完成检测与配置' : item.desc}</span>
                    </button>
                  )})}
                </div>
              </div>
            )}
          </div>

          {/* ── Footer Navigation ── */}
          <footer className="ob-footer">
            {obStep !== 'board' ? (
              <button className="ob-nav-btn ghost" onClick={() => {
                const prev = ['board','flash','connect','openclaw','done'] as const;
                const i = prev.indexOf(obStep);
                if (i > 0) setObStep(prev[i - 1]);
              }}>
                <span className="material-symbols-outlined">arrow_back</span>
                返回
              </button>
            ) : <div />}
            {obStep === 'done' ? (
              <button className="ob-nav-btn primary" onClick={() => setHideWizard(true)}>
                进入工作台
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            ) : (
              <button
                className="ob-nav-btn primary"
                disabled={obStep === 'board' && !selectedBoard}
                onClick={() => {
                  const next = ['board','flash','connect','openclaw','done'] as const;
                  const i = next.indexOf(obStep);
                  if (i < next.length - 1) setObStep(next[i + 1]);
                }}
              >
                {obStep === 'connect' ? '设备已连接' : obStep === 'flash' ? '已烧录 / 跳过' : obStep === 'openclaw' ? (openclawHealth?.aiReady ? 'OpenClaw 已就绪' : '继续（仅基础功能）') : '下一步'}
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            )}
          </footer>
        </div>
      </div>
    );
  }

  const runDiagnostic = () => {
    const nextOpen = !diagnosticOpen;
    setDiagnosticOpen(nextOpen);
    if (!nextOpen) return;
    if (!currentDevice) { addToast('请先连接设备', 'warning'); setDiagnosticOpen(false); return; }
    setDiagnosticLoading(true);
    fetchDeviceDiagnostics(currentDevice.id)
      .then((res) => { setDiagnosticOutput(res.output.split(/\r?\n/).map(l => l.trim()).filter(Boolean)); })
      .catch((error) => { addToast(error instanceof Error ? error.message : '诊断失败', 'error'); setDiagnosticOutput(['诊断失败']); })
      .finally(() => setDiagnosticLoading(false));
  };

  const pushPromptToChat = (prompt: string) => {
    setActiveTab('dashboard');
    setChatExpanded(true);
    setCmd(prompt);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const form = document.querySelector('.input-box') as HTMLFormElement | null;
        form?.requestSubmit();
      });
    });
  };

  const lifecycleRoutes = [
    {
      title: '新设备初始化',
      desc: '把当前设备按“第一次接入”重新检查一遍：连接、OpenClaw、关键依赖、可开发环境是否完整。',
      action: '发送初始化检查',
      onClick: () => pushPromptToChat('把当前设备当成一台全新设备，检查连接、OpenClaw、NodeHub / ModelZoo 依赖和可开发环境是否就绪，并告诉我还差什么'),
    },
    {
      title: '一句话开发应用',
      desc: '只描述目标，让 RDKClaw 拆出最小可运行应用、依赖、目录结构、启动命令和验证步骤。',
      action: '开始应用生成',
      onClick: () => pushPromptToChat('只根据我这一句话，帮我生成一个最小可运行的 RDK 应用，并直接开始第一步实现与验证'),
    },
    {
      title: '能力安装中心',
      desc: '先同步板端当前已安装能力，再决定需要补哪些模型、应用或 OpenClaw 组件。',
      action: '同步能力状态',
      onClick: () => pushPromptToChat('请先同步当前设备的 OpenClaw、NodeHub 和 ModelZoo 状态，告诉我哪些能力已就绪、哪些还需要安装'),
    },
  ];

  const readinessCards = [
    {
      title: '设备连接',
      value: currentDevice ? '已连接' : '未连接',
      desc: currentDevice ? `${currentDevice.name} · ${currentDevice.ip}` : '先把板卡接入工作区',
      action: currentDevice ? '切换设备' : '添加设备',
      onClick: () => setShowAddDevice(true),
    },
    {
      title: 'OpenClaw',
      value: openclawHealth?.aiReady ? 'AI Ready' : (openclawHealth?.summary || '待检测'),
      desc: openclawHealth?.aiReady
        ? '网关、Token 与 AI 链路可用'
        : '未就绪时仅保留基础能力，需先完成检测/安装',
      action: openclawHealth?.aiReady ? '打开工作台' : '重新检测',
      onClick: () => {
        if (openclawHealth?.aiReady) {
          setActiveTab('openclaw');
          return;
        }
        runOpenClawHealthCheck();
      },
    },
    {
      title: '一句话开发',
      value: currentDevice ? '可开始' : '等待设备',
      desc: currentDevice
        ? '让 RDKClaw 直接生成最小可运行应用并推进实现'
        : '设备未连接前只适合做方案与资料整理',
      action: '立即开始',
      onClick: () => pushPromptToChat('只根据我这一句话，帮我生成一个最小可运行的 RDK 应用，并直接开始第一步实现与验证'),
    },
  ];

  const environmentCards = currentDevice
    ? [
        {
          key: 'openclaw',
          title: 'OpenClaw',
          ready: !!openclawHealth?.aiReady,
          summary: openclawHealth?.aiReady ? 'AI 网关、Token 与模型链路已就绪' : (openclawHealth?.summary || '待检测'),
          action: openclawHealth?.aiReady ? '打开 OpenClaw' : '检测 / 安装',
          onClick: () => {
            if (openclawHealth?.aiReady) {
              setActiveTab('openclaw');
              return;
            }
            runOpenClawHealthCheck();
          },
        },
        ...(workspaceHealth ? [
          {
            key: 'development',
            title: '开发环境',
            ready: workspaceHealth.modules.development.ready,
            summary: workspaceHealth.modules.development.summary,
            action: workspaceHealth.modules.development.ready ? '一句话开发' : workspaceHealth.modules.development.recommendedAction,
            onClick: () => {
              if (workspaceHealth.modules.development.ready) {
                pushPromptToChat('只根据我这一句话，帮我生成一个最小可运行的 RDK 应用，并直接开始第一步实现与验证');
                return;
              }
              pushPromptToChat('请检查当前设备的 Python3、Git、Node 与 npm 开发环境，补齐缺失项并告诉我验证结果');
            },
          },
          {
            key: 'code-server',
            title: 'code-server',
            ready: workspaceHealth.modules.codeServer.ready,
            summary: workspaceHealth.modules.codeServer.summary,
            action: workspaceHealth.modules.codeServer.ready ? '打开 IDE' : workspaceHealth.modules.codeServer.recommendedAction,
            onClick: () => setActiveTab('ide'),
          },
          {
            key: 'vnc',
            title: 'VNC 桌面',
            ready: workspaceHealth.modules.vnc.ready,
            summary: workspaceHealth.modules.vnc.summary,
            action: workspaceHealth.modules.vnc.ready ? '打开远程桌面' : workspaceHealth.modules.vnc.recommendedAction,
            onClick: () => setActiveTab('vnc'),
          },
          {
            key: 'ros',
            title: 'ROS / Webviz',
            ready: workspaceHealth.modules.ros.ready,
            summary: workspaceHealth.modules.ros.summary,
            action: workspaceHealth.modules.ros.ready ? '打开 ROS 工作台' : workspaceHealth.modules.ros.recommendedAction,
            onClick: () => setActiveTab('ros'),
          },
          {
            key: 'nodehub',
            title: 'NodeHub',
            ready: workspaceHealth.modules.nodeHub.ready,
            summary: workspaceHealth.modules.nodeHub.summary,
            action: workspaceHealth.modules.nodeHub.ready ? '打开 NodeHub' : workspaceHealth.modules.nodeHub.recommendedAction,
            onClick: () => setActiveTab('examples'),
          },
          {
            key: 'modelzoo',
            title: 'ModelZoo',
            ready: workspaceHealth.modules.modelZoo.ready,
            summary: workspaceHealth.modules.modelZoo.summary,
            action: workspaceHealth.modules.modelZoo.ready ? '打开 ModelZoo' : workspaceHealth.modules.modelZoo.recommendedAction,
            onClick: () => setActiveTab('models'),
          },
        ] : []),
      ]
    : [];
  const workspaceReadyCount = environmentCards.filter((card) => card.ready).length;

  return (
    <div className="dash-page">
      {/* ── Hero 区域 ── */}
      <div className="dash-hero">
        <div className="dash-hero-text">
          <h1 className="dash-hero-title">
            {currentDevice ? `${currentDevice.name} · 开发工作台` : 'RDK Studio · 机器人开发平台'}
          </h1>
          <p className="dash-hero-sub">
            {currentDevice
              ? <>设备在线 · <span className="dash-hero-ip">{currentDevice.ip}</span> · 运行 {topMetrics.uptime} · 最近更新 {topMetrics.updatedAt}</>
                : '连接你的 RDK 开发板，从能力安装到应用运行形成完整链路'}
          </p>
        </div>
        {currentDevice && (
          <button className="dash-diag-btn" onClick={runDiagnostic}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            {diagnosticOpen ? '收起' : '诊断'}
          </button>
        )}
      </div>

      {/* ── 实时指标 ── */}
      {currentDevice && (
        <div className="dash-metrics-row">
          {[
            { label: '内存', value: topMetrics.memory, warn: false },
            { label: '温度', value: topMetrics.temp, warn: topMetrics.tempValue >= 85 },
            { label: 'BPU', value: topMetrics.bpu, warn: topMetrics.bpuValue >= 90 },
            { label: '运行', value: topMetrics.uptime, warn: false },
          ].map(m => (
            <div key={m.label} className={`dash-metric ${m.warn ? 'warn' : ''}`}>
              <span className="dash-metric-val">{m.value}</span>
              <span className="dash-metric-lbl">{m.label}{m.warn ? ' ⚠' : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── 诊断面板 ── */}
      {diagnosticOpen && (
        <div className="dash-diag-panel">
          <div className="dash-diag-header">
            <span>设备诊断</span>
            <div className="dash-diag-actions">
              <button className="dash-diag-action" onClick={() => openWorkspace('hardware', '')}>硬件详情</button>
              <button className="dash-diag-action" onClick={() => openWorkspace('terminal', '')}>终端排查</button>
            </div>
          </div>
          {diagnosticLoading ? (
            <div className="dash-diag-loading">
              <div className="dash-diag-spinner" />
              <span>正在诊断...</span>
            </div>
          ) : (
            <div className="dash-diag-output">
              {diagnosticOutput.map((line, idx) => (
                <div key={idx} className={`dash-diag-line ${line.startsWith('###') ? 'dash-diag-line-title' : ''}`}>
                  {line.startsWith('###') ? line.replace(/#/g, '') : line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <section className="skill-policy-overview">
        {readinessCards.map((card) => (
          <button key={card.title} type="button" className="skill-policy-overview-card" onClick={card.onClick}>
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <small>{card.desc}</small>
            <small>{card.action}</small>
          </button>
        ))}
      </section>

      {currentDevice && (
        <div className="skill-v2-card workspace-health-section">
          <div className="workspace-health-head">
            <div>
              <div className="skill-detail-kicker">Workspace Readiness</div>
              <h3>开发与运行环境总检</h3>
              <p className="skill-v2-desc">
                新设备第一次接入时，先确认开发链路和关键模块是否就绪，再进入 OpenClaw、应用安装或一句话开发。
              </p>
            </div>
            <div className="workspace-health-summary">
              <span>{workspaceHealthLoading ? '正在检查...' : `${workspaceReadyCount}/${Math.max(environmentCards.length, 1)} 项已就绪`}</span>
              <span>{workspaceHealth ? `更新于 ${new Date(workspaceHealth.checkedAt).toLocaleTimeString()}` : '等待首次检测'}</span>
              <button
                type="button"
                className="segment-btn"
                onClick={() => {
                  runOpenClawHealthCheck();
                  runWorkspaceHealthCheck();
                }}
                disabled={workspaceHealthLoading || openclawChecking}
              >
                {workspaceHealthLoading || openclawChecking ? '检测中...' : '重新检查'}
              </button>
            </div>
          </div>
          <div className="workspace-health-grid">
            {environmentCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className={`workspace-health-card ${card.ready ? 'ready' : 'blocked'}`}
                onClick={card.onClick}
              >
                <div className="workspace-health-top">
                  <span className="workspace-health-label">{card.title}</span>
                  <span className={`workspace-health-badge ${card.ready ? 'ready' : 'blocked'}`}>
                    {card.ready ? 'Ready' : '待处理'}
                  </span>
                </div>
                <strong>{card.summary}</strong>
                <p>{card.ready ? '当前链路可直接进入对应工作区继续操作。' : '当前仍有缺口，建议先完成安装、启动或环境补齐。'}</p>
                <span className="workspace-health-action">{card.action}</span>
              </button>
            ))}
          </div>
          {!workspaceHealth && (
            <div className="workspace-health-empty">
              {workspaceHealthLoading ? '正在检测 code-server / VNC / ROS / NodeHub / ModelZoo 环境...' : '点击重新检查，获取当前设备的开发与运行状态。'}
            </div>
          )}
        </div>
      )}

      <div className="skill-v2-card">
        <div className="skill-detail-kicker">Product Routes</div>
        <h3>从新设备到可交付应用</h3>
        <p className="skill-v2-desc">
          真正面向 C 端的桌面产品，不应该让用户自己猜下一步。这里把最关键的三条主路径直接前置出来。
        </p>
        <div className="skill-channel-stack">
          {lifecycleRoutes.map((route) => (
            <button key={route.title} type="button" className="skill-channel-link" onClick={route.onClick}>
              <div>
                <strong>{route.title}</strong>
                <span>{route.desc}</span>
              </div>
              <span>{route.action}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── AI & 机器人能力卡片 ── */}
      <div className="dash-cards">
        {DASHBOARD_CARDS.map((card) => (
          <div key={card.tab} className="dash-card" onClick={() => openWorkspace(card.tab, card.loading)}>
            <div className="dash-card-head">
              <h3 className="dash-card-title">{card.title}</h3>
              <span className={`dash-card-badge ${card.statusOk ? 'ok' : 'warn'}`}>{card.statusLabel}</span>
            </div>
            <p className="dash-card-desc">{card.description}</p>
            <div className="dash-card-foot">
              {card.quickActions.map(a => (
                <span key={a.label} className="dash-card-tag" onClick={(e) => { e.stopPropagation(); openWorkspace(card.tab, card.loading); }}>
                  {a.icon} {a.label}
                </span>
              ))}
              <span className="dash-card-cta">{card.cta}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── 最近活动 ── */}
      {activities.length > 0 && (
        <div className="dash-activity-section">
          <div className="dash-section-label">最近活动</div>
          {activities.slice(0, 5).map(act => (
            <div key={act.id} className="dash-activity-item">
              <span className="dash-activity-dot" />
              <span className="dash-activity-text">{act.text}</span>
              <span className="dash-activity-time">{act.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
