import { useAppState } from '../hooks/useAppState';
import { METRIC_CARDS } from '../constants';

export default function Hardware() {
  const { currentDevice, hardwareRange, setHardwareRange, addToast, setActiveTab } = useAppState();

  // AI 健康评分计算
  const bpuVal = 68, cpuVal = 34, memVal = 65, tempVal = 61.8;
  const healthScore = Math.round(100 - (
    (bpuVal > 80 ? 20 : bpuVal > 60 ? 8 : 0) +
    (cpuVal > 80 ? 15 : cpuVal > 60 ? 5 : 0) +
    (memVal > 85 ? 20 : memVal > 70 ? 8 : 0) +
    (tempVal > 70 ? 25 : tempVal > 60 ? 10 : 0)
  ));

  const healthLevel = healthScore >= 85 ? { label: '优秀', color: '#16a34a', bg: '#f0fdf4' }
    : healthScore >= 70 ? { label: '良好', color: '#d97706', bg: '#fffbeb' }
    : { label: '需关注', color: '#dc2626', bg: '#fef2f2' };

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📊 硬件状态</div>
        <div className="desc-text">实时查看设备运行状况，AI 帮你发现潜在问题。</div>

        {/* AI 健康评分总览 - 新增 */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 18, alignItems: 'center', padding: '14px 18px', background: healthLevel.bg, borderRadius: 12 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: healthLevel.color, lineHeight: 1 }}>{healthScore}</div>
            <div style={{ fontSize: '0.72rem', color: healthLevel.color, fontWeight: 600 }}>AI 健康分</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: 4 }}>设备状态: {healthLevel.label}</div>
            <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
              {tempVal > 60 && <span>⚠️ 芯片温度 {tempVal}°C 略偏高，建议检查散热 · </span>}
              {bpuVal > 60 && <span>BPU 负载 {bpuVal}% 中等偏高，留意推理队列 · </span>}
              {cpuVal < 50 && memVal < 80 && <span>✅ CPU 与内存在安全范围 · </span>}
              <span>整体适合继续运行当前工作负载</span>
            </div>
          </div>
          <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('AI 已生成完整健康报告', 'success')}>📄 导出报告</button>
        </div>

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
            <div className="panel-title">🔧 AI 智能诊断</div>
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
            {/* AI 预测性告警 - 新增 */}
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#fffbeb', borderRadius: 10, border: '1px dashed #fcd34d' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#92400e', marginBottom: 4 }}>🔮 AI 预测性告警</div>
              <div style={{ fontSize: '0.78rem', color: '#78350f', lineHeight: 1.5 }}>
                按当前趋势，BPU 温度在持续推理负载下预计 2 小时后接近 70°C 警戒线。建议提前降频或增加散热。
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="chip-btn" onClick={() => { setActiveTab('terminal'); addToast('已跳转到终端，可手动调节风扇', 'info'); }}>🖥️ 终端调节</button>
                <button className="chip-btn" onClick={() => addToast('AI 已自动将 BPU 频率降至 800MHz', 'success')}>🤖 AI 自动降频</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
