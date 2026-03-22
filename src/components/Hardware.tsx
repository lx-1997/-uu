import { useEffect, useMemo, useState, useCallback } from 'react';
import { fetchDeviceDiagnostics } from '../api';
import { useAppState } from '../hooks/useAppState';
import { parseMetrics } from '../utils/diagnostics';

/* ── 环形进度条（白底浅色主题） ── */
function RingGauge({ value, max = 100, color, label, display }: { value: number; max?: number; color: string; label: string; display: string }) {
  const pct = value < 0 ? 0 : Math.min(value / max, 1);
  const r = 34, c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  const warn = pct > 0.85;

  return (
    <div className="hw-gauge">
      <div className="hw-gauge-ring">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={r} fill="none" stroke="#f1f5f9" strokeWidth="6" />
          <circle cx="40" cy="40" r={r} fill="none" stroke={warn ? '#ef4444' : color} strokeWidth="6"
            strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
            transform="rotate(-90 40 40)" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        </svg>
        <span className="hw-gauge-val" style={{ color: warn ? '#ef4444' : color }}>{display}</span>
      </div>
      <span className="hw-gauge-label">{label}</span>
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

  const toneColor = healthTone === 'ok' ? 'var(--ok)' : healthTone === 'danger' ? 'var(--danger)' : 'var(--warn)';

  return (
    <div className="tool-page">
      {/* 顶部栏 */}
      <div className="tool-bar">
        <div className="tool-bar-left">
          <span className="tool-bar-title">硬件监控</span>
          {currentDevice && (
            <span className="tool-stat-chip live">
              <span className="num">{currentDevice.name}</span>
              {currentDevice.ip}
            </span>
          )}
        </div>
        <div className="tool-bar-right">
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            <span>自动刷新</span>
          </label>
          <button className="btn btn-ghost btn-sm" onClick={refreshDiagnostics} disabled={loading}>
            {loading ? '刷新中...' : '立即刷新'}
          </button>
        </div>
      </div>

      <div className="tool-content">
        {/* 核心指标仪表盘 */}
        <div className="config-section">
          <div className="config-section-title">核心指标</div>
          <div className="hw-gauges">
            <RingGauge value={m.tempC} max={105} color="#ff6b00" label="芯片温度" display={m.temp} />
            <RingGauge value={m.memPercent} max={100} color="#3b82f6" label="内存使用" display={m.memPercent >= 0 ? `${m.memPercent}%` : '--'} />
            <RingGauge value={m.bpuValue} max={100} color="#a855f7" label="BPU 负载" display={m.bpu} />
            <RingGauge value={m.diskPercent} max={100} color="#22c55e" label="磁盘使用" display={m.diskPercent >= 0 ? `${m.diskPercent}%` : '--'} />
          </div>
        </div>

        {/* 运行状态 */}
        <div className="config-section" style={{ marginTop: 24 }}>
          <div className="config-section-title">运行状态</div>

          <div className="config-row">
            <div className="config-label">健康状态</div>
            <div className="config-value">
              <span style={{ color: toneColor, fontWeight: 600 }}>● {healthText}</span>
            </div>
          </div>

          {alertMessages.length > 0
            ? alertMessages.map(msg => (
                <div className="config-row" key={msg}>
                  <div className="config-label" style={{ color: 'var(--warn)' }}>⚠ {msg}</div>
                  <div className="config-value" />
                </div>
              ))
            : (
              <div className="config-row">
                <div className="config-label" style={{ color: 'var(--ok)' }}>✅ 关键资源状态正常</div>
                <div className="config-value" />
              </div>
            )
          }

          <div className="config-row">
            <div className="config-label">CPU 负载 (1m)</div>
            <div className="config-value"><strong>{m.cpuLoad}</strong></div>
          </div>
          <div className="config-row">
            <div className="config-label">运行时长</div>
            <div className="config-value"><strong>{m.uptime}</strong></div>
          </div>
        </div>

        {/* 详细指标 */}
        <div className="config-section" style={{ marginTop: 24 }}>
          <div className="config-section-title">详细指标</div>

          <div className="config-row">
            <div className="config-label">
              芯片温度
              <div className="config-label-hint">
                {m.tempC >= 85 ? '⚠️ 温度过高，建议检查散热' : m.tempC > 0 ? '温度正常' : '等待数据'}
              </div>
            </div>
            <div className="config-value">{m.temp}</div>
          </div>

          <div className="config-row">
            <div className="config-label">
              内存
              <div className="config-label-hint">
                {m.memPercent >= 90 ? '⚠️ 内存紧张' : m.memPercent >= 0 ? `使用率 ${m.memPercent}%` : '等待数据'}
              </div>
            </div>
            <div className="config-value">{m.memUsed} / {m.memTotal}</div>
          </div>

          <div className="config-row">
            <div className="config-label">
              BPU 负载
              <div className="config-label-hint">
                {m.bpuValue >= 90 ? '⚠️ 高负载' : m.bpuValue >= 0 ? '运行正常' : '等待数据'}
              </div>
            </div>
            <div className="config-value">{m.bpu}</div>
          </div>

          <div className="config-row">
            <div className="config-label">
              CPU 负载
              <div className="config-label-hint">1分钟平均负载</div>
            </div>
            <div className="config-value">{m.cpuLoad}</div>
          </div>

          <div className="config-row">
            <div className="config-label">
              磁盘
              <div className="config-label-hint">
                {m.diskPercent >= 90 ? '⚠️ 磁盘空间不足' : m.diskPercent >= 0 ? `使用率 ${m.diskPercent}%` : '等待数据'}
              </div>
            </div>
            <div className="config-value">{m.diskUsed} / {m.diskTotal}</div>
          </div>

          <div className="config-row">
            <div className="config-label">
              运行时长
              <div className="config-label-hint">自上次启动</div>
            </div>
            <div className="config-value">{m.uptime}</div>
          </div>
        </div>

        {/* 原始输出折叠 */}
        <div className="config-section" style={{ marginTop: 24 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? '▼' : '▶'} 原始诊断输出
          </button>
          {showRaw && (
            <div className="config-terminal" style={{ marginTop: 8, minHeight: 200, maxHeight: 320 }}>
              {lines.map((line, i) => (
                <div key={`${line}-${i}`}>{line}</div>
              ))}
              {lines.length === 0 && <div style={{ color: 'var(--text-muted)' }}>暂无数据</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
