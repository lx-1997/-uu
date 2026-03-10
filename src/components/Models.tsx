import { useAppState } from '../hooks/useAppState';
import { MODEL_REPO } from '../constants';

export default function Models() {
  const { currentDevice, addToast } = useAppState();

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🤖 模型仓库与部署 (Target: {currentDevice?.name})</div>
        <div className="desc-text">AI 模型管理 — 智能推荐、格式转换、基准测试与一键部署。</div>

        <div className="ai-file-bar">
          <div className="ai-file-input-wrap">
            <span className="ai-file-icon">🤖</span>
            <input className="clean-input ai-file-input" placeholder='描述你的场景，AI 推荐最佳模型: "我需要检测行人和车辆"' />
          </div>
          <button className="clean-btn" onClick={() => addToast('AI 推荐: YOLOv5s (BPU) — 通用目标检测，已适配当前设备，30FPS', 'info')}>推荐</button>
        </div>

        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">模型列表</div>
            <div className="option-list">
              {MODEL_REPO.map(m => (
                <div key={m.id} className="select-card" style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{m.name}</strong>
                    <span className={`card-status-badge ${m.status === 'deployed' ? 'ok' : 'warn'}`} style={{ fontSize: '0.75rem', padding: '4px 8px' }}>
                      <span className="card-status-dot"></span>
                      {m.status === 'deployed' ? '已部署' : '待转换'}
                    </span>
                  </div>
                  <span>{m.desc}</span>
                  <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '0.8rem', color: '#94a3b8' }}>
                    <span>格式: {m.format}</span>
                    <span>大小: {m.size}</span>
                    {m.fps !== '—' && <span>推理: {m.fps} FPS</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">模型操作</div>
            <div className="usage-list">
              <div className="usage-item"><strong>📤 上传新模型</strong><span>支持 .onnx / .caffemodel / .bin 格式，上传后自动检测模型结构</span></div>
              <div className="usage-item"><strong>🔄 格式转换 (hb_mapper)</strong><span>将 ONNX/Caffe 模型量化并转换为 BPU 推理优化格式</span></div>
              <div className="usage-item"><strong>⚡ 推理基准测试</strong><span>在当前设备上跑 benchmark，获取 FPS、延迟与精度报告</span></div>
              <div className="usage-item"><strong>🚀 一键部署到 ROS 节点</strong><span>将模型关联到推理节点，发布到 /hobot_dnn 话题</span></div>
            </div>
            <button className="clean-btn" style={{ marginTop: '16px', width: '100%' }} onClick={() => addToast('模型上传入口已打开 (Mock)', 'info')}>📤 上传模型文件</button>
            <button className="clean-btn outline-btn" style={{ marginTop: '8px', width: '100%' }} onClick={() => addToast('基准测试已启动 (Mock)', 'info')}>⚡ 运行 Benchmark</button>
          </div>
        </div>
      </div>
    </div>
  );
}
