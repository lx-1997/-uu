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
        if (parts.length >= 3) memory = `${parts[2]}/${parts[1]}`;
      }
    }

    // 解析 hrut_somstatus 输出获取 BPU 数据
    const somIdx = lines.findIndex((line) => line === '###SOMSTATUS###');
    let bpu = '--';
    let bpuValue = -1;
    let cpuFreq = '--';
    if (somIdx >= 0) {
      const somLines = lines.slice(somIdx + 1);
      // 解析 CPU 温度 (优先使用 somstatus 的温度)
      const cpuTempLine = somLines.find(l => /CPU\s*:\s*[\d.]+/.test(l));
      if (cpuTempLine) {
        const tm = cpuTempLine.match(/CPU\s*:\s*([\d.]+)/);
        if (tm) {
          const tv = parseFloat(tm[1]);
          if (tv > 0) {
            // 覆盖之前的温度值
            Object.assign({ temp: `${tv.toFixed(1)}°C`, tempValue: tv });
          }
        }
      }
      // 解析 BPU 频率和负载率
      const bpuLine = somLines.find(l => /bpu0/.test(l));
      if (bpuLine) {
        const parts = bpuLine.trim().split(/\s+/);
        // 格式: bpu0: min cur max ratio
        if (parts.length >= 5) {
          const curFreq = Number(parts[2]);
          const maxFreq = Number(parts[3]);
          const ratio = Number(parts[4]);
          if (Number.isFinite(curFreq) && curFreq > 0) {
            const freqGHz = (curFreq / 1e9).toFixed(1);
            bpu = ratio > 0 ? `${ratio}% · ${freqGHz}GHz` : `${freqGHz}GHz`;
            bpuValue = ratio;
          }
        }
      }
      // 解析 CPU 频率
      const cpuLine = somLines.find(l => /cpu0/.test(l));
      if (cpuLine) {
        const parts = cpuLine.trim().split(/\s+/);
        if (parts.length >= 4) {
          const cur = Number(parts[2]);
          if (Number.isFinite(cur) && cur > 0) {
            cpuFreq = `${(cur / 1000).toFixed(0)}MHz`;
          }
        }
      }
    }
    // 回退到 hrut_smi 解析
    if (bpu === '--') {
      const bpuIdx = lines.findIndex((line) => line === '###BPU###');
      if (bpuIdx >= 0) {
        const bpuLines = lines.slice(bpuIdx + 1, bpuIdx + 6).join(' ');
        const m = bpuLines.match(/(\d{1,3})\s*%/);
        if (m) { bpu = `${m[1]}%`; bpuValue = Number(m[1]); }
        else if (/unavailable/i.test(bpuLines)) bpu = '不可用';
      }
    }

    setTopMetrics({ memory, temp, bpu, uptime, tempValue, bpuValue, updatedAt: new Date().toLocaleTimeString() });
  };

  useEffect(() => {
    if (devices.length > 0 && obStep === 'connect') setObStep('done');
  }, [devices.length, obStep, setObStep]);

  useEffect(() => {
    if (!currentDevice) return;
    let cancelled = false;
    const loadMetrics = () => {
      fetchDeviceDiagnostics(currentDevice.id)
        .then((res) => { if (!cancelled) parseMetrics(res.output); })
        .catch(() => { if (!cancelled) setTopMetrics({ memory: '--', temp: '--', bpu: '--', uptime: '--', tempValue: -1, bpuValue: -1, updatedAt: '--' }); });
    };
    loadMetrics();
    const timer = window.setInterval(loadMetrics, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [currentDevice?.id]);

  /* ── Onboarding wizard ── */
  if (!hideWizard && (devices.length === 0 || obStep === 'done')) {
    const boards = [
      { id: 'x3', name: 'RDK X3', emoji: '🟠', bpu: '5 TOPS', chip: 'Sunrise 3 · 4核 A53', mem: '2GB DDR4', storage: 'SD / 8GB eMMC', os: 'Ubuntu 20.04 / 22.04', net: '百兆网口', price: '¥299 起', desc: '入门级边缘 AI，适合教学和轻量推理', url: 'https://developer.horizon.cc/rdkx3' },
      { id: 'x5', name: 'RDK X5', emoji: '🔴', bpu: '10 TOPS', chip: 'Sunrise 5 · 8核 A55', mem: '4GB LPDDR4', storage: 'SD / 32GB eMMC', os: 'Ubuntu 22.04 + ROS2', net: '千兆 · WiFi 6', price: '¥499 起', desc: '主力开发板，多路摄像头 + 实时推理', url: 'https://developer.horizon.cc/rdkx5' },
      { id: 's100', name: 'RDK S100', emoji: '🟣', bpu: '80 TOPS', chip: 'Journey 6 · CPU+BPU+MCU', mem: '16GB LPDDR5', storage: 'eMMC / NVMe', os: 'Ubuntu 22.04 + ROS2', net: '双千兆 · CAN', price: '¥1999 起', desc: '大算力行业板，自动驾驶 / 机器人首选', url: 'https://developer.horizon.cc/rdks100' },
      { id: 'ultra', name: 'RDK Ultra', emoji: '⚫', bpu: '128 TOPS', chip: 'Journey 5 · 8核 A55', mem: '8GB LPDDR4x', storage: 'eMMC 64G / NVMe', os: 'Ubuntu 22.04 + ROS2', net: '双千兆', price: '联系销售', desc: '旗舰算力平台，多模态融合与大模型推理', url: 'https://developer.horizon.cc/rdkultra' },
    ];
    const board = boards.find(b => b.id === selectedBoard);

    return (
      <div className="center-stage">
        <div className="ob-wizard">
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
                      <a className="ob-board-link" href={b.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>详情 →</a>
                    </div>
                  </div>
                ))}
              </div>
              <div className="ob-nav">
                <div />
                <button className="ob-btn primary" disabled={!selectedBoard} onClick={() => setObStep('flash')}>下一步 →</button>
              </div>
            </>
          )}

          {obStep === 'flash' && (
            <>
              <h2 className="ob-heading">为 {board?.name} 烧录系统</h2>
              <p className="ob-sub">将系统镜像写入 SD 卡，插卡上电即可运行</p>
              <div className="ob-flash-single">
                <button className="ob-choice-card wide" onClick={() => setActiveTab('flasher')}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <strong>打开镜像烧录工具</strong>
                  <span>选择镜像 → 选择存储 → 一键写入</span>
                </button>
              </div>
              <div className="ob-nav">
                <button className="ob-btn ghost" onClick={() => setObStep('board')}>← 返回</button>
                <button className="ob-btn primary" onClick={() => setObStep('connect')}>已烧录 / 跳过 →</button>
              </div>
            </>
          )}

          {obStep === 'connect' && (
            <>
              <h2 className="ob-heading">连接 {board?.name}</h2>
              <p className="ob-sub">确保板卡已上电，选择连接方式</p>
              <div className="ob-choice-row">
                <button className="ob-choice-card" onClick={() => setShowAddDevice(true)}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth="1.8"><path d="M5 12.55a11 11 0 0114 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
                  <strong>SSH 网络连接</strong>
                  <span>网线/WiFi · 输入 IP</span>
                </button>
                <button className="ob-choice-card" onClick={() => setShowAddDevice(true)}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                  <strong>USB 串口调试</strong>
                  <span>{selectedBoard === 's100' ? 'Type-C' : 'Micro USB'} 直连</span>
                </button>
              </div>
              <div className="ob-nav">
                <button className="ob-btn ghost" onClick={() => setObStep('flash')}>← 返回</button>
                <button className="ob-btn primary" onClick={() => setObStep('done')}>设备已连接 →</button>
              </div>
            </>
          )}

          {obStep === 'done' && (
            <>
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '2.4rem', marginBottom: 12 }}>🎉</div>
                <h2 className="ob-heading">一切就绪</h2>
                <p className="ob-sub">{board?.name || 'RDK'} 已准备好，开始探索 AI 推理与机器人开发</p>
              </div>
              <div className="ob-done-grid">
                {[
                  { emoji: '📦', title: '运行示例', desc: '一键部署 AI 感知应用', tab: 'examples' as const },
                  { emoji: '🧠', title: '部署模型', desc: '预训练模型部署到 BPU', tab: 'models' as const },
                  { emoji: '💻', title: '打开终端', desc: '开始编写第一行代码', tab: 'terminal' as const },
                ].map(item => (
                  <button key={item.tab} className="ob-choice-card compact" onClick={() => { setHideWizard(true); setActiveTab(item.tab); }}>
                    <span style={{ fontSize: '1.4rem' }}>{item.emoji}</span>
                    <strong>{item.title}</strong>
                    <span>{item.desc}</span>
                  </button>
                ))}
              </div>
              <div className="ob-nav">
                <button className="ob-btn ghost" onClick={() => setObStep('connect')}>← 返回</button>
                <button className="ob-btn primary" onClick={() => setHideWizard(true)}>进入工作台</button>
              </div>
            </>
          )}
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
            {currentDevice ? currentDevice.name : 'RDK Studio'}
          </h1>
          <p className="dash-hero-sub">
            {currentDevice
              ? <>设备在线 · <span className="dash-hero-ip">{currentDevice.ip}</span> · 运行 {topMetrics.uptime}</>
              : '连接你的 RDK 开发板，开始 AI 开发之旅'}
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
                <div key={idx} className="dash-diag-line">{line}</div>
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
