import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { MODEL_REPO } from '../constants';

export default function Models() {
  const { currentDevice, addToast, setActiveTab } = useAppState();
  const [taskFilter, setTaskFilter] = useState('all');

  const taskFilters = [
    { id: 'all', label: '全部', icon: '📋' },
    { id: 'detect', label: '目标检测', icon: '🎯' },
    { id: 'segment', label: '语义分割', icon: '🖼️' },
    { id: 'classify', label: '图像分类', icon: '🏷️' },
  ];

  const modelTaskMap: Record<string, string> = {
    yolov5: 'detect', fcos: 'detect', mobilenet: 'classify', unet: 'segment',
  };

  const filteredModels = taskFilter === 'all' ? MODEL_REPO : MODEL_REPO.filter(m => modelTaskMap[m.id] === taskFilter);
  const deployedCount = MODEL_REPO.filter(m => m.status === 'deployed').length;
  const pendingCount = MODEL_REPO.filter(m => m.status === 'pending').length;

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🤖 模型仓库与部署 (Target: {currentDevice?.name})</div>
        <div className="desc-text">AI 模型管理 — 智能推荐、格式转换、基准测试与一键部署。</div>

        {/* AI 智能推荐输入 */}
        <div className="ai-file-bar">
          <div className="ai-file-input-wrap">
            <span className="ai-file-icon">🤖</span>
            <input className="clean-input ai-file-input" placeholder='描述你的场景，AI 推荐最佳模型: "我需要检测行人和车辆"' />
          </div>
          <button className="clean-btn" onClick={() => addToast('AI 推荐: YOLOv5s (BPU) — 通用目标检测，已适配当前设备，30FPS', 'info')}>推荐</button>
        </div>

        {/* AI 兼容性总览 - 新增 */}
        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 评估</span>
          <span className="ai-recommend-text">
            {currentDevice?.name} BPU 算力充足 ·
            <strong style={{ color: '#22c55e' }}> {deployedCount} 个模型已优化部署</strong> ·
            <span style={{ color: '#f59e0b' }}> {pendingCount} 个待转换</span> ·
            推荐同时运行不超过 2 个模型以保持 &gt;25FPS
          </span>
        </div>

        {/* 任务类型过滤 - 新增 */}
        <div className="chip-cloud" style={{ marginBottom: 16 }}>
          {taskFilters.map(f => (
            <button key={f.id} className={`chip-btn ${taskFilter === f.id ? 'active' : ''}`} onClick={() => setTaskFilter(f.id)}>
              {f.icon} {f.label}
            </button>
          ))}
        </div>

        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">模型列表 ({filteredModels.length})</div>
            <div className="option-list">
              {filteredModels.map(m => (
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
                  {/* AI 内嵌操作建议 - 新增 */}
                  {m.status === 'pending' && (
                    <div style={{ marginTop: 8, padding: '6px 10px', background: '#fffbeb', borderRadius: 8, fontSize: '0.78rem', color: '#92400e' }}>
                      💡 AI 建议: 运行 <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>hb_mapper makertbin</code> 转换为 BPU 格式 → 预计 FPS 提升 10x
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">AI 驱动的模型工作流</div>

            {/* 转换流水线 - 新增可视化 */}
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: 10 }}>📊 转换与部署流水线</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', flexWrap: 'wrap' }}>
                <span style={{ padding: '6px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>📤 上传</span>
                <span style={{ color: '#94a3b8' }}>→</span>
                <span style={{ padding: '6px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>🔍 AI 结构分析</span>
                <span style={{ color: '#94a3b8' }}>→</span>
                <span style={{ padding: '6px 12px', background: '#fff7ed', borderRadius: 8, border: '1px solid #fed7aa' }}>🔄 hb_mapper 量化</span>
                <span style={{ color: '#94a3b8' }}>→</span>
                <span style={{ padding: '6px 12px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>⚡ Benchmark</span>
                <span style={{ color: '#94a3b8' }}>→</span>
                <span style={{ padding: '6px 12px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>🚀 部署到 ROS</span>
              </div>
            </div>

            <div className="usage-list">
              <div className="usage-item"><strong>📤 上传新模型</strong><span>支持 .onnx / .caffemodel / .bin 格式，AI 自动检测模型结构与兼容性</span></div>
              <div className="usage-item"><strong>🔄 AI 辅助转换 (hb_mapper)</strong><span>AI 自动选择最佳量化策略，INT8/INT16 精度损失评估</span></div>
              <div className="usage-item"><strong>⚡ 智能基准测试</strong><span>多模型对比跑 benchmark，输出 FPS、延迟与精度报告</span></div>
              <div className="usage-item"><strong>🚀 一键部署到 ROS 节点</strong><span>将模型关联到推理节点，自动发布到 /hobot_dnn 话题</span></div>
            </div>

            <button className="clean-btn" style={{ marginTop: '16px', width: '100%' }} onClick={() => addToast('模型上传入口已打开 (Mock)', 'info')}>📤 上传模型文件</button>
            <button className="clean-btn outline-btn" style={{ marginTop: '8px', width: '100%' }} onClick={() => addToast('基准测试已启动 (Mock)', 'info')}>⚡ 运行 Benchmark</button>

            {/* AI 跨页联动 - 新增 */}
            <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>🔗 AI 联动建议</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="chip-btn" onClick={() => setActiveTab('ros')}>📡 查看推理话题输出</button>
                <button className="chip-btn" onClick={() => setActiveTab('lowcode')}>🧩 编排推理流水线</button>
                <button className="chip-btn" onClick={() => setActiveTab('examples')}>📦 查看相关示例</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
