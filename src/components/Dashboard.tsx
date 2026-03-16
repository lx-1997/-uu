import { useState, useEffect } from 'react';
import { fetchDeviceDiagnostics } from '../api';
import { useAppState } from '../hooks/useAppState';
import { DASHBOARD_CARDS } from '../constants';

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

  const parseMetrics = (output: string) => {
    const lines = output.split(/\r?\n/).map((line) => line.trim());

    const findAfter = (marker: string) => {
      const idx = lines.findIndex((line) => line === marker);
      if (idx < 0) return '';
      return lines.slice(idx + 1).find((line) => line.length > 0 && !line.startsWith('###')) ?? '';
    };

    const uptimeLine = findAfter('###UPTIME###');
    let uptime = '--';
    if (uptimeLine) {
      const match = uptimeLine.match(/up\s+(.*?)(?:,\s+\d+\s+user|,\s+load average)/);
      if (match) uptime = match[1].trim();
      else uptime = uptimeLine.length > 20 ? uptimeLine.slice(0, 20) + '...' : uptimeLine;
    }
    const tempRaw = findAfter('###TEMP###');
    const tempNumber = Number(tempRaw);
    const temp = Number.isFinite(tempNumber) && tempNumber > 0 ? `${(tempNumber / 1000).toFixed(1)}°C` : (tempRaw || '--');
    const tempValue = Number.isFinite(tempNumber) && tempNumber > 0 ? tempNumber / 1000 : -1;

    const memIdx = lines.findIndex((line) => line === '###MEM###');
    let memory = '--';
    if (memIdx >= 0) {
      const memLine = lines.slice(memIdx + 1).find((line) => /^mem:/i.test(line));
      if (memLine) {
        const parts = memLine.split(/\s+/);
        if (parts.length >= 3) {
          memory = `${parts[2]}/${parts[1]}`;
        }
      }
    }

    const bpuIdx = lines.findIndex((line) => line === '###BPU###');
    let bpu = '--';
    let bpuValue = -1;
    if (bpuIdx >= 0) {
      const bpuLines = lines.slice(bpuIdx + 1, bpuIdx + 6).join(' ');
      const m = bpuLines.match(/(\d{1,3})\s*%/);
      if (m) {
        bpu = `${m[1]}%`;
        bpuValue = Number(m[1]);
      }
      else if (/unavailable/i.test(bpuLines)) bpu = '不可用';
    }

    setTopMetrics({
      memory,
      temp,
      bpu,
      uptime,
      tempValue,
      bpuValue,
      updatedAt: new Date().toLocaleTimeString(),
    });
  };

  useEffect(() => {
    if (devices.length > 0 && obStep === 'connect') {
      setObStep('done');
    }
  }, [devices.length, obStep, setObStep]);

  useEffect(() => {
    if (!currentDevice) return;

    let cancelled = false;
    const loadMetrics = () => {
      fetchDeviceDiagnostics(currentDevice.id)
        .then((res) => {
          if (cancelled) return;
          parseMetrics(res.output);
        })
        .catch(() => {
          if (cancelled) return;
          setTopMetrics({ memory: '--', temp: '--', bpu: '--', uptime: '--', tempValue: -1, bpuValue: -1, updatedAt: '--' });
        });
    };

    loadMetrics();
    const timer = window.setInterval(loadMetrics, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  /* ── Onboarding wizard ── */
  if (!hideWizard && (devices.length === 0 || obStep === 'done')) {
    const boards = [
      { id: 'x3', name: 'RDK X3', emoji: '🟠', bpu: '5 TOPS', chip: 'Sunrise 3 · 4核 Cortex-A53', mem: '2GB DDR4', storage: 'SD 卡 / 8GB eMMC',
        os: 'Ubuntu 20.04 / 22.04', debug: 'Micro USB', net: '百兆网口', extra: 'HDMI · MIPI CSI · 40PIN GPIO',
        price: '¥299 起', desc: '入门级边缘 AI，适合教学和轻量推理', url: 'https://developer.horizon.cc/rdkx3' },
      { id: 'x5', name: 'RDK X5', emoji: '🔴', bpu: '10 TOPS', chip: 'Sunrise 5 · 8核 Cortex-A55', mem: '4GB LPDDR4', storage: 'SD 卡 / 32GB eMMC',
        os: 'Ubuntu 22.04 + ROS2 Humble', debug: 'Micro USB', net: '千兆网口 · WiFi 6', extra: 'HDMI · 双 MIPI CSI · USB 3.0 · 40PIN',
        price: '¥499 起', desc: '主力开发板，多路摄像头 + 实时推理', url: 'https://developer.horizon.cc/rdkx5' },
      { id: 's100', name: 'RDK S100', emoji: '🟣', bpu: '80 TOPS', chip: 'Journey 6 · CPU + BPU + MCU', mem: '16GB LPDDR5', storage: 'eMMC / NVMe SSD',
        os: 'Ubuntu 22.04 + ROS2', debug: 'Type-C', net: '双千兆网口 · CAN 2.0', extra: '40PIN · PCIe 3.0 · MIPI CSI/DSI',
        price: '¥1999 起', desc: '大算力行业板，自动驾驶 / 机器人首选', url: 'https://developer.horizon.cc/rdks100' },
      { id: 'ultra', name: 'RDK Ultra', emoji: '⚫', bpu: '128 TOPS', chip: 'Journey 5 · 8核 A55', mem: '8GB LPDDR4x', storage: 'eMMC 64G / NVMe',
        os: 'Ubuntu 22.04 + ROS2', debug: 'Micro USB', net: '双千兆网口', extra: 'USB 3.0 · PCIe 3.0 · HDMI · 40PIN',
        price: '联系销售', desc: '旗舰算力平台，多模态融合与大模型推理', url: 'https://developer.horizon.cc/rdkultra' },
    ];
    const board = boards.find(b => b.id === selectedBoard);

    return (
      <div className="center-stage">
        <div className="ob-wizard">
          {/* Progress dots */}
          <div className="ob-progress">
            {(['board', 'flash', 'connect', 'done'] as const).map((s, i) => {
              const idx = ['board','flash','connect','done'].indexOf(obStep);
              return (
                <div key={s} className={`ob-prog-item ${idx === i ? 'active' : ''} ${idx > i ? 'done' : ''}`}>
                  <div className="ob-prog-dot">{idx > i ? '✓' : i + 1}</div>
                  <span>{s === 'board' ? '选板卡' : s === 'flash' ? '烧镜像' : s === 'connect' ? '连设备' : '完成'}</span>
                </div>
              );
            })}
          </div>

          {/* Step 1: Board */}
          {obStep === 'board' && (
            <>
              <h2 className="ob-heading">选择你的 RDK 开发板</h2>
              <div className="ob-board-grid">
                {boards.map(b => (
                  <div key={b.id} className={`ob-board ${selectedBoard === b.id ? 'selected' : ''}`} onClick={() => setSelectedBoard(b.id)}>
                    <div className="ob-board-top">
                      <span className="ob-board-emoji">{b.emoji}</span>
                      <span className="ob-board-name">{b.name}</span>
                      <span className="ob-board-bpu">{b.bpu}</span>
                    </div>
                    <div className="ob-board-desc">{b.desc}</div>
                    <div className="ob-board-specs">
                      <div className="ob-spec"><span className="ob-spec-k">芯片</span><span className="ob-spec-v">{b.chip}</span></div>
                      <div className="ob-spec"><span className="ob-spec-k">内存</span><span className="ob-spec-v">{b.mem}</span></div>
                      <div className="ob-spec"><span className="ob-spec-k">存储</span><span className="ob-spec-v">{b.storage}</span></div>
                      <div className="ob-spec"><span className="ob-spec-k">网络</span><span className="ob-spec-v">{b.net}</span></div>
                    </div>
                    <div className="ob-board-footer">
                      <span className="ob-board-price">{b.price}</span>
                      <a className="ob-board-link" href={b.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>官网详情 →</a>
                    </div>
                  </div>
                ))}
              </div>
              <div className="ob-nav">
                <div />
                <button className="ob-btn primary" disabled={!selectedBoard} onClick={() => setObStep('flash')}>
                  下一步 →
                </button>
              </div>
            </>
          )}

          {/* Step 2: Flash */}
          {obStep === 'flash' && (
            <>
              <h2 className="ob-heading">为 {board?.name} 烧录系统</h2>
              <p className="ob-sub">RDK 开发板需要先将系统镜像写入 SD 卡，插卡上电后即可运行 Ubuntu 系统</p>
              <div className="ob-flash-single">
                <button className="ob-choice-card wide" onClick={() => setActiveTab('flasher')}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  <strong>打开镜像烧录工具</strong>
                  <span>选择镜像版本 → 选择目标存储 → 一键写入</span>
                </button>
              </div>
              <div className="ob-nav">
                <button className="ob-btn ghost" onClick={() => setObStep('board')}>← 返回</button>
                <button className="ob-btn primary" onClick={() => setObStep('connect')}>已烧录 / 跳过 →</button>
              </div>
            </>
          )}

          {/* Step 3: Connect */}
          {obStep === 'connect' && (
            <>
              <h2 className="ob-heading">连接 {board?.name}</h2>
              <p className="ob-sub">确保板卡已上电，选择连接方式</p>
              <div className="ob-choice-row">
                <button className="ob-choice-card" onClick={() => setShowAddDevice(true)}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.55a11 11 0 0114 0"/><path d="M1.42 9a16 16 0 0121.16 0"/>
                    <path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
                  </svg>
                  <strong>SSH 网络连接</strong>
                  <span>网线/WiFi · 输入 IP · sunrise/sunrise（常见）</span>
                </button>
                <button className="ob-choice-card" onClick={() => setShowAddDevice(true)}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 18v-6"/><path d="M8 18v-2"/><path d="M16 18v-4"/>
                    <rect x="6" y="18" width="4" height="4" rx="1"/><rect x="14" y="18" width="4" height="4" rx="1"/>
                    <circle cx="12" cy="8" r="2"/><path d="M12 2v4"/>
                  </svg>
                  <strong>USB 串口调试</strong>
                  <span>{selectedBoard === 's100' ? 'Type-C' : 'Micro USB'} 直连 · 选串口 + 波特率</span>
                </button>
              </div>
              <div className="ob-nav">
                <button className="ob-btn ghost" onClick={() => setObStep('flash')}>← 返回</button>
                <button className="ob-btn primary" onClick={() => setObStep('done')}>设备已连接 →</button>
              </div>
            </>
          )}

          {/* Step 4: Done - Congratulations */}
          {obStep === 'done' && (
            <>
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '3rem', marginBottom: 12 }}>🎉</div>
                <h2 className="ob-heading" style={{ fontSize: '1.4rem' }}>恭喜！一切就绪</h2>
                <p className="ob-sub" style={{ maxWidth: 420, margin: '8px auto 0' }}>
                  你的 {board?.name || 'RDK'} 开发板已准备好，接下来可以探索 AI 推理、ROS 机器人开发和更多精彩功能。
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, margin: '12px 0' }}>
                {[
                  { emoji: '📦', title: '运行示例应用', desc: '从 NodeHub 一键部署 AI 感知、手势识别等应用', tab: 'examples' as const },
                  { emoji: '🧠', title: '部署 AI 模型', desc: '浏览 ModelZoo，把预训练模型部署到 BPU', tab: 'models' as const },
                  { emoji: '💻', title: '打开终端', desc: '连接设备终端，开始编写你的第一行代码', tab: 'terminal' as const },
                ].map(item => (
                  <button key={item.tab} className="ob-choice-card" style={{ textAlign: 'center' }} onClick={() => { setHideWizard(true); setActiveTab(item.tab); }}>
                    <span style={{ fontSize: '1.6rem' }}>{item.emoji}</span>
                    <strong>{item.title}</strong>
                    <span>{item.desc}</span>
                  </button>
                ))}
              </div>
              <div className="ob-nav">
                <button className="ob-btn ghost" onClick={() => setObStep('connect')}>← 返回</button>
                <button className="ob-btn primary" onClick={() => setHideWizard(true)}>
                  进入工作台 🚀
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="center-stage">
      <h2 className="hero-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        {currentDevice?.name || 'RDK Workspace'}
        {currentDevice && (
          <span style={{ 
            fontSize: '0.45em', 
            background: 'rgba(34, 197, 94, 0.1)', 
            color: '#4ade80', 
            padding: '4px 10px', 
            borderRadius: '12px',
            border: '1px solid rgba(34, 197, 94, 0.2)'
          }}>
            已连接
          </span>
        )}
      </h2>

      <div className="stats-strip" style={{ marginTop: '20px' }}>
        <div className="stat-card">
          <div className="stat-value">{topMetrics.memory}</div>
          <div className="stat-label">内存使用(实时)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{topMetrics.temp}</div>
          <div className="stat-label">芯片温度(实时){topMetrics.tempValue >= 85 ? ' · 高温' : ''}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{topMetrics.bpu}</div>
          <div className="stat-label">BPU 负载(实时){topMetrics.bpuValue >= 90 ? ' · 高负载' : ''}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{topMetrics.uptime}</div>
          <div className="stat-label">系统运行时长</div>
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: '0.78rem', color: '#64748b', marginTop: 6 }}>
        指标更新时间：{topMetrics.updatedAt}
      </div>

      <div className="dashboard-shortcuts">
        <button className="clean-btn outline-btn" onClick={() => openWorkspace('terminal', '')}>🖥️ 快速终端</button>
        <button className="clean-btn outline-btn" onClick={() => openWorkspace('files', '')}>📂 文件管理</button>
        <button className="clean-btn outline-btn" onClick={() => openWorkspace('vnc', '')}>🖵 远程桌面</button>
        <button className={`clean-btn ${diagnosticOpen ? '' : 'outline-btn'}`} onClick={() => {
          const nextOpen = !diagnosticOpen;
          setDiagnosticOpen(nextOpen);
          if (!nextOpen) return;
          if (!currentDevice) {
            addToast('请先连接设备后再执行诊断', 'warning');
            setDiagnosticOpen(false);
            return;
          }
          setDiagnosticLoading(true);
          fetchDeviceDiagnostics(currentDevice.id)
            .then((res) => {
              const lines = res.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
              setDiagnosticOutput(lines);
            })
            .catch((error) => {
              addToast(error instanceof Error ? error.message : '诊断失败', 'error');
              setDiagnosticOutput(['诊断失败，请检查设备连接与权限']);
            })
            .finally(() => setDiagnosticLoading(false));
        }}>🩺 {diagnosticOpen ? '收起诊断' : '一键诊断'}</button>
      </div>

      {diagnosticOpen && (
        <div className="diagnostic-panel">
          <div className="diagnostic-ai-summary" style={{ width: '100%' }}>
            <div className="diagnostic-ai-header">🩺 真实设备诊断输出</div>
            {diagnosticLoading ? (
              <p>正在执行诊断命令，请稍候...</p>
            ) : (
              <div className="terminal-screen" style={{ minHeight: 220 }}>
                {diagnosticOutput.map((line, idx) => (
                  <div key={`${line}-${idx}`} className="terminal-line">{line}</div>
                ))}
              </div>
            )}
            <div className="diagnostic-ai-actions">
              <button className="clean-btn outline-btn sm-btn" onClick={() => openWorkspace('hardware', '')}>查看硬件详情</button>
              <button className="clean-btn outline-btn sm-btn" onClick={() => openWorkspace('terminal', '')}>打开终端排查</button>
            </div>
          </div>
        </div>
      )}

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
}
