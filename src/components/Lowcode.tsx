import { useAppState } from '../hooks/useAppState';
import { FLOW_TEMPLATES } from '../constants';

export default function Lowcode() {
  const {
    flowTemplate, setFlowTemplate, flowMode, setFlowMode,
    flowCheckProgress, isFlowChecking, runFlowValidation, addToast, setActiveTab,
  } = useAppState();

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🧩 流程编排</div>
        <div className="desc-text">用自然语言或拖拽方式搭建 AI 处理流水线。</div>

        <div className="ai-file-bar">
          <div className="ai-file-input-wrap">
            <span className="ai-file-icon">🤖</span>
            <input className="clean-input ai-file-input" placeholder='描述你想要的流程，例如: "摄像头拍照 → AI 检测人脸 → 推送到飞书"' />
          </div>
          <button className="clean-btn" onClick={() => addToast('AI 正在生成流程编排...', 'info')}>生成</button>
        </div>

        {/* AI 智能模板推荐 - 新增 */}
        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 推荐</span>
          <span className="ai-recommend-text">
            检测到设备已部署 YOLOv5s 模型 + MIPI 摄像头 ·
            推荐使用 <strong>视觉感知流水线</strong> 模板快速搭建 ·
            预计部署后推理延迟 ~33ms
          </span>
          <button className="clean-btn outline-btn sm-btn" style={{ marginLeft: 8, fontSize: '0.75rem' }} onClick={() => { setFlowTemplate('vision'); addToast('已应用 AI 推荐模板', 'success'); }}>
            采纳
          </button>
        </div>

        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">模板库</div>
            <div className="option-list">
              {FLOW_TEMPLATES.map((template) => (
                <button key={template.id} className={`select-card ${flowTemplate === template.id ? 'active' : ''}`} onClick={() => setFlowTemplate(template.id)}>
                  <strong>{template.name}</strong>
                  <span>{template.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel-card">
            <div className="panel-title">发布阶段</div>
            <div className="segmented-row">
              {([['draft', '草稿'], ['review', '待审核'], ['staging', '预发布']] as const).map(([mode, label]) => (
                <button key={mode} className={`segment-btn ${flowMode === mode ? 'active' : ''}`} onClick={() => setFlowMode(mode)}>{label}</button>
              ))}
            </div>
            <button className="clean-btn" onClick={runFlowValidation}>执行部署前检查</button>
            <div className="progress-box compact-box">
              <div className="progress-meta"><span>{isFlowChecking ? '检查进行中' : '检查可重复触发'}</span><strong>{flowCheckProgress}%</strong></div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${flowCheckProgress}%` }}></div></div>
            </div>
            {/* AI 检查结果洞察 - 新增 */}
            {flowCheckProgress >= 100 && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: '0.78rem', color: '#16a34a' }}>
                ✅ AI 检查通过: 环境变量完备 · 设备在线 · 依赖已满足 · 可安全发布
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="clean-btn outline-btn" style={{ fontSize: '0.82rem', padding: '8px 14px', flex: 1 }} onClick={() => addToast('流程已保存为 v1.2 草稿', 'success')}>💾 保存</button>
              <button className="clean-btn outline-btn" style={{ fontSize: '0.82rem', padding: '8px 14px', flex: 1 }} onClick={() => addToast('已导出为 JSON', 'info')}>📤 导出</button>
            </div>
          </div>
        </div>

        <div className="workspace-grid three-column">
          <div className="panel-card">
            <div className="panel-title">节点面板</div>
            {['输入', '处理', '输出'].map(cat => (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 6 }}>{cat}</div>
                {cat === '输入' && ['📷 摄像头输入', '📡 Topic 订阅', '⏱️ 定时触发'].map(n => <div key={n} className="file-row" style={{ cursor: 'grab', marginBottom: 6 }}>{n}</div>)}
                {cat === '处理' && ['🧠 AI 推理', '🔍 数据过滤', '📊 数据聚合'].map(n => <div key={n} className="file-row" style={{ cursor: 'grab', marginBottom: 6 }}>{n}</div>)}
                {cat === '输出' && ['📂 文件同步', '🔔 告警通知', '🌐 HTTP 请求', '📡 ROS 发布'].map(n => <div key={n} className="file-row" style={{ cursor: 'grab', marginBottom: 6 }}>{n}</div>)}
              </div>
            ))}
            {/* AI 推荐下一个节点 - 新增 */}
            <div style={{ padding: '8px 10px', background: '#f0f9ff', borderRadius: 8, fontSize: '0.75rem', color: '#1e40af', marginTop: 8 }}>
              💡 AI 建议添加: <strong>🧠 AI 推理</strong> 节点 (基于当前流程上下文)
            </div>
          </div>
          <div className="panel-card flow-canvas-card">
            <div className="panel-title">流程画布</div>
            <div className="flow-canvas">
              <div className="flow-node active">📷 输入</div>
              <div className="flow-link"></div>
              <div className="flow-node">🔍 过滤</div>
              <div className="flow-link"></div>
              <div className="flow-node">🧠 推理</div>
              <div className="flow-link"></div>
              <div className="flow-node">📡 发布</div>
            </div>
            <div style={{ textAlign: 'center', marginTop: 10, fontSize: '0.78rem', color: '#94a3b8' }}>拖拽节点到画布 · 连线定义数据流</div>
            {/* AI 性能预估 - 新增 */}
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#f8fafc', borderRadius: 8, display: 'flex', gap: 16, justifyContent: 'center', fontSize: '0.75rem' }}>
              <span>⚡ 预估延迟: <strong>33ms</strong></span>
              <span>🔄 吞吐量: <strong>~30 FPS</strong></span>
              <span>💾 内存开销: <strong>~256 MB</strong></span>
            </div>
          </div>
          <div className="panel-card">
            <div className="panel-title">部署说明</div>
            <div className="usage-list">
              <div className="usage-item">发布前自动检查环境变量与设备在线状态。</div>
              <div className="usage-item">支持版本历史管理与一键回滚。</div>
              <div className="usage-item">AI 自动监控部署后运行状态。</div>
            </div>
            {/* AI 页面联动 - 新增 */}
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>🔗 相关资源</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="chip-btn" onClick={() => setActiveTab('models')}>🤖 查看可用模型</button>
                <button className="chip-btn" onClick={() => setActiveTab('ros')}>📡 ROS 话题</button>
                <button className="chip-btn" onClick={() => setActiveTab('openclaw')}>⚙️ AI 网关</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
