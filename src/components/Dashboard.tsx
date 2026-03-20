import { useState, useEffect } from 'react';
import { fetchDeviceDiagnostics } from '../api';
import { useAppState } from '../hooks/useAppState';
import { DASHBOARD_CARDS } from '../constants';
import { parseMetrics } from '../utils/diagnostics';

export default function Dashboard() {
  const { currentDevice, devices, setDevices, openWorkspace, diagnosticOpen, setDiagnosticOpen, activities, addToast, setShowAddDevice, setActiveTab, obStep, setObStep, selectedBoard, setSelectedBoard } = useAppState();
  const [hideWizard, setHideWizard] = useState(false);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticOutput, setDiagnosticOutput] = useState<string[]>([]);
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
    if (devices.length > 0 && obStep === 'connect') setObStep('done');
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

  /* ── Onboarding wizard ── */
  if (showWizard || (devices.length === 0 && !hideWizard)) {
    const boards = [
      { id: 'x3', name: 'RDK X3', emoji: '🟠', bpu: '5 TOPS', chip: 'Sunrise 3 · 4核 A53', mem: '2GB DDR4', storage: 'SD / 8GB eMMC', os: 'Ubuntu 20.04 / 22.04', net: '百兆网口', price: '¥299 起', desc: '入门级边缘 AI，适合教学和轻量推理', url: 'https://developer.horizon.cc/rdkx3' },
      { id: 'x5', name: 'RDK X5', emoji: '🔴', bpu: '10 TOPS', chip: 'Sunrise 5 · 8核 A55', mem: '4GB LPDDR4', storage: 'SD / 32GB eMMC', os: 'Ubuntu 22.04 + ROS2', net: '千兆 · WiFi 6', price: '¥499 起', desc: '主力开发板，多路摄像头 + 实时推理', url: 'https://developer.horizon.cc/rdkx5' },
      { id: 's100', name: 'RDK S100', emoji: '🟣', bpu: '80 TOPS', chip: 'Journey 6 · CPU+BPU+MCU', mem: '16GB LPDDR5', storage: 'eMMC / NVMe', os: 'Ubuntu 22.04 + ROS2', net: '双千兆 · CAN', price: '¥1999 起', desc: '大算力行业板，自动驾驶 / 机器人首选', url: 'https://developer.horizon.cc/rdks100' },
      { id: 'ultra', name: 'RDK Ultra', emoji: '⚫', bpu: '128 TOPS', chip: 'Journey 5 · 8核 A55', mem: '8GB LPDDR4x', storage: 'eMMC 64G / NVMe', os: 'Ubuntu 22.04 + ROS2', net: '双千兆', price: '联系销售', desc: '旗舰算力平台，多模态融合与大模型推理', url: 'https://developer.horizon.cc/rdkultra' },
    ];
    const board = boards.find(b => b.id === selectedBoard);

    const stepIdx = ['board','flash','connect','done'].indexOf(obStep);
    const steps = [
      { id: 'board', label: '选择板卡', icon: 'developer_board' },
      { id: 'flash', label: '烧录系统', icon: 'system_update' },
      { id: 'connect', label: '连接设备', icon: 'cable' },
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
                  ].map(item => (
                    <button key={item.tab} className="ob-done-card" onClick={() => { setHideWizard(true); setActiveTab(item.tab); }}>
                      <span className="material-symbols-outlined ob-done-card-icon">{item.icon}</span>
                      <strong>{item.title}</strong>
                      <span>{item.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Footer Navigation ── */}
          <footer className="ob-footer">
            {obStep !== 'board' ? (
              <button className="ob-nav-btn ghost" onClick={() => {
                const prev = ['board','flash','connect','done'] as const;
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
                  const next = ['board','flash','connect','done'] as const;
                  const i = next.indexOf(obStep);
                  if (i < next.length - 1) setObStep(next[i + 1]);
                }}
              >
                {obStep === 'connect' ? '设备已连接' : obStep === 'flash' ? '已烧录 / 跳过' : '下一步'}
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
