import { useAppState } from '../hooks/useAppState';
import { DASHBOARD_CARDS } from '../constants';

export default function Dashboard() {
  const { currentDevice, openWorkspace, diagnosticOpen, setDiagnosticOpen, diagnosticStep, setDiagnosticStep, activities, addToast } = useAppState();

  return (
    <div className="center-stage">
      <h2 className="hero-title">{currentDevice?.name || 'RDK Workspace'}</h2>
      <div className="hero-subtitle">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: currentDevice ? '#22c55e' : '#94a3b8', display: 'inline-block' }}></span>
          {currentDevice ? `已连接 · ${currentDevice.ip}` : '未连接设备'}
        </span>
      </div>

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

      <div className="dashboard-shortcuts">
        <button className="clean-btn outline-btn" onClick={() => openWorkspace('terminal', '')}>🖥️ 快速终端</button>
        <button className="clean-btn outline-btn" onClick={() => openWorkspace('files', '')}>📂 文件管理</button>
        <button className="clean-btn outline-btn" onClick={() => openWorkspace('vnc', '')}>🖵 远程桌面</button>
        <button className={`clean-btn ${diagnosticOpen ? '' : 'outline-btn'}`} onClick={() => {
          setDiagnosticOpen(!diagnosticOpen);
          if (!diagnosticOpen) {
            setDiagnosticStep(0);
            let step = 0;
            const timer = setInterval(() => {
              step++;
              setDiagnosticStep(step);
              if (step >= 6) clearInterval(timer);
            }, 500);
          }
        }}>🩺 {diagnosticOpen ? '收起诊断' : '一键诊断'}</button>
      </div>

      {diagnosticOpen && (() => {
        const checks = [
          { name: '网络连通性', icon: '🌐', pass: true, detail: `ping ${currentDevice?.ip} — 正常 (2ms)` },
          { name: '系统负载', icon: '⚡', pass: true, detail: 'CPU 23%, 内存 5.2/8G, 进程数 87' },
          { name: '芯片温度', icon: '🌡️', pass: false, detail: '61.8°C — 建议 < 60°C，散热需关注' },
          { name: 'BPU 状态', icon: '🧠', pass: true, detail: 'BPU0 在线, 负载 68%, 推理队列 2' },
          { name: '存储空间', icon: '💾', pass: true, detail: '系统盘 56%, 数据盘 32%, 模型盘 18%' },
          { name: 'ROS2 环境', icon: '🕸️', pass: true, detail: 'humble 运行中, 4 topics, 6 nodes' },
        ];
        return (
          <div className="diagnostic-panel">
            <div className="diagnostic-checks">
              {checks.map((check, i) => (
                <div key={check.name} className={`diagnostic-check ${i < diagnosticStep ? (check.pass ? 'pass' : 'warn') : 'pending'}`}>
                  <span className="diagnostic-icon">{i < diagnosticStep ? (check.pass ? '✅' : '⚠️') : '⏳'}</span>
                  <div className="diagnostic-info">
                    <strong>{check.icon} {check.name}</strong>
                    <span className="diagnostic-detail">{i < diagnosticStep ? check.detail : '等待检测...'}</span>
                  </div>
                </div>
              ))}
            </div>
            {diagnosticStep >= 6 && (
              <div className="diagnostic-ai-summary">
                <div className="diagnostic-ai-header">🤖 AI 诊断总结</div>
                <p>设备 <strong>{currentDevice?.name}</strong> 整体运行正常。重点关注：</p>
                <ul>
                  <li><strong>芯片温度 61.8°C</strong> 略偏高，建议检查散热风扇或降低 BPU 推理负载，长期高温可能影响器件寿命。</li>
                  <li>BPU 负载 68%，仍有余量但建议监控峰值时段，避免推理队列堆积。</li>
                  <li>其余网络、存储、ROS 环境指标均在安全范围内，无需操作。</li>
                </ul>
                <div className="diagnostic-ai-actions">
                  <button className="clean-btn outline-btn sm-btn" onClick={() => openWorkspace('hardware', '')}>查看硬件详情</button>
                  <button className="clean-btn outline-btn sm-btn" onClick={() => openWorkspace('terminal', '')}>打开终端排查</button>
                  <button className="clean-btn outline-btn sm-btn ai-action-btn" onClick={() => addToast('AI 已生成完整诊断报告', 'success')}>📄 导出报告</button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
