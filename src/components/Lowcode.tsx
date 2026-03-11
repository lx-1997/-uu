import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { FLOW_TEMPLATES } from '../constants';

export default function Lowcode() {
  const {
    flowTemplate, setFlowTemplate, addToast, setActiveTab, currentDevice,
  } = useAppState();
  const [nodeRedReady, setNodeRedReady] = useState(false);
  const nodeRedUrl = `http://${currentDevice?.ip || 'localhost'}:1880`;

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🧩 流程编排 · Node-RED</div>
        <div className="desc-text">基于 Node-RED 的可视化流程编辑器，AI 辅助自动连线和节点配置。</div>

        {!nodeRedReady ? (
          <>
            {/* Setup guide */}
            <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
              <span className="ai-suggest-label">💡 提示</span>
              <span className="ai-recommend-text">
                Node-RED 需要在设备上运行。确认设备已安装后，点击下方连接按钮。
              </span>
            </div>

            <div className="workspace-grid two-column">
              <div className="panel-card">
                <div className="panel-title">快速启动</div>
                <div className="usage-list">
                  <div className="usage-item">
                    <strong>1. 安装 Node-RED</strong>
                    <span>在终端中运行: <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, fontSize: '0.82rem' }}>sudo apt install nodered</code></span>
                  </div>
                  <div className="usage-item">
                    <strong>2. 启动服务</strong>
                    <span><code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, fontSize: '0.82rem' }}>node-red-start</code></span>
                  </div>
                  <div className="usage-item">
                    <strong>3. 连接编辑器</strong>
                    <span>确认服务运行后，点击右侧按钮打开编辑器</span>
                  </div>
                </div>
                <button className="clean-btn" style={{ width: '100%', marginTop: 12 }} onClick={() => setNodeRedReady(true)}>
                  🔗 连接 Node-RED 编辑器
                </button>
                <button className="clean-btn outline-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => window.open(nodeRedUrl, '_blank')}>
                  ↗ 在新窗口中打开
                </button>
              </div>

              <div className="panel-card">
                <div className="panel-title">AI 流程模板</div>
                <div className="option-list">
                  {FLOW_TEMPLATES.map(t => (
                    <button key={t.id} className={`select-card ${flowTemplate === t.id ? 'active' : ''}`} onClick={() => setFlowTemplate(t.id)}>
                      <strong>{t.name}</strong>
                      <span>{t.desc}</span>
                    </button>
                  ))}
                </div>
                <button className="clean-btn outline-btn" style={{ width: '100%', marginTop: 12 }} onClick={() => addToast('AI 已将模板导入 Node-RED', 'success')}>
                  🤖 AI 导入选中模板
                </button>
              </div>
            </div>

            <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>🤖 AI 能帮你做什么？</div>
              <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6 }}>
                用底部聊天框描述你想要的流程（如"摄像头拍照 → 人脸检测 → 飞书推送"），AI 会自动生成 Node-RED 节点并完成连线。
                也可以让 AI 帮你安装缺少的节点模块、调试流程错误、优化性能。
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="chip-btn" onClick={() => setActiveTab('models')}>🤖 模型仓库</button>
              <button className="chip-btn" onClick={() => setActiveTab('ros')}>📡 ROS 话题</button>
              <button className="chip-btn" onClick={() => setActiveTab('openclaw')}>⚙️ AI 网关</button>
              <button className="chip-btn" onClick={() => setActiveTab('examples')}>📦 应用示例</button>
            </div>
          </>
        ) : (
          <>
            {/* Embedded Node-RED editor */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
              <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                <span className="card-status-dot"></span>已连接
              </span>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{nodeRedUrl}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="clean-btn outline-btn sm-btn" onClick={() => window.open(nodeRedUrl, '_blank')}>↗ 新窗口</button>
                <button className="clean-btn outline-btn sm-btn" onClick={() => setNodeRedReady(false)}>✕ 断开</button>
              </div>
            </div>
            <div className="panel-card" style={{ padding: 0, overflow: 'hidden', height: 'calc(100vh - 280px)', minHeight: 400 }}>
              <iframe
                src={nodeRedUrl}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Node-RED Editor"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
