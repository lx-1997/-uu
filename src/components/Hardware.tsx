import { useAppState } from '../hooks/useAppState';
import { METRIC_CARDS } from '../constants';

export default function Hardware() {
  const { currentDevice, hardwareRange, setHardwareRange, addToast } = useAppState();

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🏥 硬件诊断监控</div>
        <div className="desc-text">实时硬件看板，异常检测与处置建议。</div>
        <div className="segmented-row hardware-mode-row">
          {([['realtime', '实时窗口'], ['10m', '最近 10 分钟'], ['1h', '最近 1 小时']] as const).map(([range, label]) => (
            <button key={range} className={`segment-btn ${hardwareRange === range ? 'active' : ''}`} onClick={() => setHardwareRange(range)}>{label}</button>
          ))}
        </div>
        <div className="metric-grid">
          {METRIC_CARDS.map((metric) => (
            <div key={metric.label} className="metric-card">
              <div className="progress-meta"><span>{metric.label}</span><strong>{metric.value}</strong></div>
              <div className="progress-track thin"><div className="progress-fill" style={{ width: `${metric.bar}%` }}></div></div>
              <div className="metric-hint">{metric.hint}</div>
            </div>
          ))}
        </div>

        <div className="workspace-grid two-column" style={{ marginTop: 18 }}>
          <div className="panel-card">
            <div className="panel-title">🌐 网络接口</div>
            <div className="usage-list">
              {[
                { label: '以太网', iface: 'eth0', ip: currentDevice?.ip || '—', connected: true, speed: '1000 Mbps' },
                { label: 'WiFi', iface: 'wlan0', ip: '—', connected: false, speed: '—' },
              ].map(n => (
                <div key={n.iface} className="usage-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{n.label} ({n.iface})</strong>
                    <span className={`card-status-badge ${n.connected ? 'ok' : 'warn'}`} style={{ fontSize: '0.72rem', padding: '3px 8px' }}>
                      <span className="card-status-dot"></span>
                      {n.connected ? '已连接' : '未连接'}
                    </span>
                  </div>
                  <span>IP: {n.ip} · 速度: {n.speed}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel-card">
            <div className="panel-title">💾 存储分区</div>
            <div className="usage-list">
              {[
                { label: '系统分区', used: 4.2, total: 16 },
                { label: '数据分区', used: 1.8, total: 8 },
                { label: '模型目录', used: 0.6, total: 2 },
              ].map(s => (
                <div key={s.label} className="usage-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{s.label}</strong>
                    <span style={{ fontSize: '0.82rem', color: '#64748b' }}>{s.used}/{s.total} GB</span>
                  </div>
                  <div className="progress-track thin" style={{ marginTop: 6 }}>
                    <div className="progress-fill" style={{ width: `${(s.used / s.total) * 100}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="workspace-grid two-column" style={{ marginTop: 18 }}>
          <div className="panel-card">
            <div className="panel-title">📊 活跃进程 (Top 4)</div>
            <table className="hw-process-table">
              <thead><tr><th>进程名</th><th>CPU</th><th>内存</th><th>PID</th></tr></thead>
              <tbody>
                {[
                  { name: 'hobot_dnn', cpu: '12.3%', mem: '180 MB', pid: 1024 },
                  { name: 'ros2_daemon', cpu: '5.1%', mem: '96 MB', pid: 892 },
                  { name: 'mipi_cam', cpu: '3.8%', mem: '64 MB', pid: 1156 },
                  { name: 'nginx', cpu: '0.4%', mem: '22 MB', pid: 456 },
                ].map(p => (
                  <tr key={p.pid}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>{p.cpu}</td>
                    <td>{p.mem}</td>
                    <td style={{ color: '#94a3b8' }}>{p.pid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-card">
            <div className="panel-title">🔧 快捷诊断</div>
            <div className="usage-list">
              <div className="usage-item selectable" onClick={() => addToast('温度异常检测完成：所有指标正常', 'success')}>
                <strong>🌡️ 温度异常检测</strong>
                <span>校验 BPU/CPU 温度是否超过安全阈值</span>
              </div>
              <div className="usage-item selectable" onClick={() => addToast('I/O 性能测试完成：读 180 MB/s 写 95 MB/s', 'info')}>
                <strong>⚡ I/O 性能快测</strong>
                <span>对存储设备执行 4K 随机读写基准测试</span>
              </div>
              <div className="usage-item selectable" onClick={() => addToast('系统日志已导出 (dmesg + journalctl)', 'info')}>
                <strong>📋 导出系统日志</strong>
                <span>收集 dmesg / journalctl 用于社区反馈</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
