import { useEffect, useMemo, useState, useCallback } from 'react';
import { fetchDeviceDiagnostics } from '../api';
import { useAppState } from '../hooks/useAppState';

/* ── 解析诊断输出为结构化指标 ── */
function parseMetrics(output: string) {
  const lines = output.split(/\r?\n/).map(l => l.trim());
  const findAfter = (marker: string) => {
    const idx = lines.findIndex(l => l === marker);
    if (idx < 0) return '';
    return lines.slice(idx + 1).find(l => l.length > 0 && !l.startsWith('###')) ?? '';
  };

  // 温度
  const tempRaw = findAfter('###TEMP###');
  const tempNum = Number(tempRaw);
  let tempC = Number.isFinite(tempNum) && tempNum > 0 ? tempNum / 1000 : -1;
  let temp = tempC > 0 ? `${tempC.toFixed(1)}°C` : (tempRaw || '--');

  // 内存
  const memIdx = lines.findIndex(l => l === '###MEM###');
  let memUsed = '--', memTotal = '--', memPercent = -1;
  if (memIdx >= 0) {
    const memLine = lines.slice(memIdx + 1).find(l => /^mem:/i.test(l));
    if (memLine) {
      const parts = memLine.split(/\s+/);
      if (parts.length >= 3) {
        memTotal = parts[1];
        memUsed = parts[2];
        const t = parseInt(parts[1]), u = parseInt(parts[2]);
        if (t > 0) memPercent = Math.round((u / t) * 100);
      }
    }
  }

  // BPU（优先从 SOMSTATUS 解析）
  let bpu = '--', bpuValue = -1;
  const somIdx = lines.findIndex(l => l === '###SOMSTATUS###');
  if (somIdx >= 0) {
    const somLines = lines.slice(somIdx + 1);

    const cpuTempLine = somLines.find((line) => /CPU\s*:\s*[\d.]+/.test(line));
    if (cpuTempLine) {
      const tm = cpuTempLine.match(/CPU\s*:\s*([\d.]+)/);
      if (tm) {
        const value = parseFloat(tm[1]);
        if (value > 0) {
          tempC = value;
          temp = `${value.toFixed(1)}°C`;
        }
      }
    }

    const bpuLine = somLines.find((line) => /bpu\d+/i.test(line));
    if (bpuLine) {
      const parts = bpuLine.replace(':', ' ').trim().split(/\s+/);
      const numbers = parts
        .map((part) => Number(part.replace('%', '')))
        .filter((num) => Number.isFinite(num));

      const ratioMatch = bpuLine.match(/(ratio|load|util(?:ization)?)[^\d]*(\d{1,3})\s*%?/i);
      const percentMatch = bpuLine.match(/(\d{1,3})\s*%/);
      let ratio = ratioMatch ? Number(ratioMatch[2]) : (percentMatch ? Number(percentMatch[1]) : -1);
      if (ratio < 0 || ratio > 100) {
        const ratioCandidate = [...numbers].reverse().find((num) => num >= 0 && num <= 100);
        ratio = ratioCandidate ?? -1;
      }

      const freqCandidate = numbers.find((num) => num > 1000000);
      if (freqCandidate && ratio >= 0) {
        bpu = `${ratio}% · ${(freqCandidate / 1e9).toFixed(1)}GHz`;
        bpuValue = ratio;
      } else if (ratio >= 0) {
        bpu = `${ratio}%`;
        bpuValue = ratio;
      } else if (freqCandidate) {
        bpu = `${(freqCandidate / 1e9).toFixed(1)}GHz`;
      }
    }
  }

  // 回退到 hrut_smi / bputop 输出
  if (bpu === '--') {
    const bpuIdx = lines.findIndex(l => l === '###BPU###');
    if (bpuIdx >= 0) {
      const bpuLines = lines.slice(bpuIdx + 1, bpuIdx + 8).join(' ');
      const m = bpuLines.match(/(\d{1,3})\s*%/);
      if (m) { bpu = `${m[1]}%`; bpuValue = Number(m[1]); }
      else if (/unavailable/i.test(bpuLines)) bpu = '不可用';
    }
  }

  // CPU (从 uptime load average)
  const uptimeLine = findAfter('###UPTIME###');
  let uptime = '--', cpuLoad = '--';
  if (uptimeLine) {
    const um = uptimeLine.match(/up\s+(.*?)(?:,\s+\d+\s+user|,\s+load average)/);
    if (um) uptime = um[1].trim();
    const lm = uptimeLine.match(/load average:\s*([\d.]+)/);
    if (lm) cpuLoad = lm[1];
  }

  // 磁盘
  const diskIdx = lines.findIndex(l => l === '###DISK###');
  let diskUsed = '--', diskTotal = '--', diskPercent = -1;
  if (diskIdx >= 0) {
    const diskLine = lines.slice(diskIdx + 1).find(l => l.includes('/'));
    if (diskLine) {
      const parts = diskLine.split(/\s+/);
      if (parts.length >= 5) {
        diskTotal = parts[1]; diskUsed = parts[2];
        const pct = parseInt(parts[4]);
        if (!isNaN(pct)) diskPercent = pct;
      }
    }
  }

  return { temp, tempC, memUsed, memTotal, memPercent, bpu, bpuValue, cpuLoad, uptime, diskUsed, diskTotal, diskPercent };
}

/* ── 环形进度条（白底浅色主题） ── */
function RingGauge({ value, max = 100, color, label, display }: { value: number; max?: number; color: string; label: string; display: string }) {
  const pct = value < 0 ? 0 : Math.min(value / max, 1);
  const r = 34, c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  const warn = pct > 0.85;

  return (
    <div className="hw-gauge">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#f1f5f9" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={warn ? '#ef4444' : color} strokeWidth="6"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 40 40)" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <div className="hw-gauge-text">
        <span className="hw-gauge-value" style={{ color: warn ? '#ef4444' : color }}>{display}</span>
        <span className="hw-gauge-label">{label}</span>
      </div>
    </div>
  );
}

export default function Hardware() {
  const { currentDevice, addToast } = useAppState();
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const refreshDiagnostics = useCallback(() => {
    if (!currentDevice) return;
    setLoading(true);
    fetchDeviceDiagnostics(currentDevice.id)
      .then(res => setOutput(res.output || ''))
      .catch(err => addToast(err instanceof Error ? err.message : '诊断失败', 'error'))
      .finally(() => setLoading(false));
  }, [currentDevice, addToast]);

  useEffect(() => {
    if (currentDevice) refreshDiagnostics();
  }, [currentDevice?.id]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh || !currentDevice) return;
    const timer = setInterval(refreshDiagnostics, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh, currentDevice?.id, refreshDiagnostics]);

  const m = useMemo(() => parseMetrics(output), [output]);
  const lines = useMemo(() => output.split(/\r?\n/).filter(Boolean), [output]);
  const alertMessages = useMemo(() => {
    const alerts: string[] = [];
    if (m.tempC >= 85) alerts.push('芯片温度偏高');
    if (m.memPercent >= 90) alerts.push('内存占用过高');
    if (m.bpuValue >= 90) alerts.push('BPU 持续高负载');
    if (m.diskPercent >= 90) alerts.push('磁盘空间不足');
    return alerts;
  }, [m]);

  const healthTone = alertMessages.length === 0 ? 'ok' : alertMessages.length >= 2 ? 'danger' : 'warn';
  const healthText = alertMessages.length === 0 ? '运行稳定' : `发现 ${alertMessages.length} 个风险项`;

  return (
    <div className="hw-container hw-page">
      {/* 顶部栏 */}
      <div className="hw-header">
        <div className="hw-header-left">
          <div>
            <h2 className="hw-title">硬件监控</h2>
            <div className="hw-subtitle">实时展示温度、负载、内存和磁盘状态</div>
          </div>
          {currentDevice && (
            <span className="hw-device-tag">
              <span className="hw-device-dot" />
              {currentDevice.name} · {currentDevice.ip}
            </span>
          )}
        </div>
        <div className="hw-header-right">
          <label className="hw-auto-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            <span>自动刷新</span>
          </label>
          <button className="hw-refresh-btn" onClick={refreshDiagnostics} disabled={loading}>
            {loading ? '刷新中...' : '立即刷新'}
          </button>
        </div>
      </div>

      {/* 总览区 */}
      <div className="hw-overview-grid">
        <section className="hw-panel hw-gauges-panel">
          <div className="hw-panel-title">核心指标</div>
          <div className="hw-gauges">
            <RingGauge value={m.tempC} max={105} color="#ff6b00" label="芯片温度" display={m.temp} />
            <RingGauge value={m.memPercent} max={100} color="#3b82f6" label="内存使用" display={m.memPercent >= 0 ? `${m.memPercent}%` : '--'} />
            <RingGauge value={m.bpuValue} max={100} color="#a855f7" label="BPU 负载" display={m.bpu} />
            <RingGauge value={m.diskPercent} max={100} color="#22c55e" label="磁盘使用" display={m.diskPercent >= 0 ? `${m.diskPercent}%` : '--'} />
          </div>
        </section>

        <section className="hw-panel hw-health-panel">
          <div className="hw-panel-title">运行状态</div>
          <div className={`hw-health-pill ${healthTone}`}>
            <span className="hw-health-dot" />
            {healthText}
          </div>
          <div className="hw-health-list">
            {alertMessages.length > 0 ? (
              alertMessages.map((msg) => (
                <div key={msg} className="hw-health-item">⚠ {msg}</div>
              ))
            ) : (
              <div className="hw-health-item ok">✅ 关键资源状态正常</div>
            )}
          </div>
          <div className="hw-quick-metrics">
            <div className="hw-quick-metric">
              <span>CPU(1m)</span>
              <strong>{m.cpuLoad}</strong>
            </div>
            <div className="hw-quick-metric">
              <span>运行时长</span>
              <strong>{m.uptime}</strong>
            </div>
          </div>
        </section>
      </div>

      {/* 详细指标卡片 */}
      <div className="hw-detail-grid">
        <div className="hw-detail-card">
          <div className="hw-detail-label">芯片温度</div>
          <div className="hw-detail-value">{m.temp}</div>
          <div className="hw-detail-hint">{m.tempC >= 85 ? '⚠️ 温度过高，建议检查散热' : m.tempC > 0 ? '温度正常' : '等待数据'}</div>
        </div>
        <div className="hw-detail-card">
          <div className="hw-detail-label">内存</div>
          <div className="hw-detail-value">{m.memUsed} / {m.memTotal}</div>
          <div className="hw-detail-hint">{m.memPercent >= 90 ? '⚠️ 内存紧张' : m.memPercent >= 0 ? `使用率 ${m.memPercent}%` : '等待数据'}</div>
        </div>
        <div className="hw-detail-card">
          <div className="hw-detail-label">BPU 负载</div>
          <div className="hw-detail-value">{m.bpu}</div>
          <div className="hw-detail-hint">{m.bpuValue >= 90 ? '⚠️ 高负载' : m.bpuValue >= 0 ? '运行正常' : '等待数据'}</div>
        </div>
        <div className="hw-detail-card">
          <div className="hw-detail-label">CPU 负载</div>
          <div className="hw-detail-value">{m.cpuLoad}</div>
          <div className="hw-detail-hint">1分钟平均负载</div>
        </div>
        <div className="hw-detail-card">
          <div className="hw-detail-label">磁盘</div>
          <div className="hw-detail-value">{m.diskUsed} / {m.diskTotal}</div>
          <div className="hw-detail-hint">{m.diskPercent >= 90 ? '⚠️ 磁盘空间不足' : m.diskPercent >= 0 ? `使用率 ${m.diskPercent}%` : '等待数据'}</div>
        </div>
        <div className="hw-detail-card">
          <div className="hw-detail-label">运行时长</div>
          <div className="hw-detail-value">{m.uptime}</div>
          <div className="hw-detail-hint">自上次启动</div>
        </div>
      </div>

      {/* 原始输出折叠 */}
      <div className="hw-raw-section">
        <button className="hw-raw-toggle" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? '▼' : '▶'} 原始诊断输出
        </button>
        {showRaw && (
          <div className="terminal-screen" style={{ marginTop: 8, minHeight: 200 }}>
            {lines.map((line, i) => (
              <div key={`${line}-${i}`} className="terminal-line">{line}</div>
            ))}
            {lines.length === 0 && <div className="terminal-line hw-raw-empty">暂无数据</div>}
          </div>
        )}
      </div>
    </div>
  );
}
