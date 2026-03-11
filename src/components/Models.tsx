import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { MODEL_REPO } from '../constants';

const MODELZOO_MODELS = [
  { id: 'yolov5', name: 'YOLOv5s', task: 'detect', platform: 'X3/X5', fps: '30', size: '14.2 MB', source: 'official', desc: '通用目标检测，支持 80 类 COCO 物体' },
  { id: 'yolov8n', name: 'YOLOv8n', task: 'detect', platform: 'X5/Ultra', fps: '45', size: '12.8 MB', source: 'official', desc: '新一代实时检测，更高精度更低延迟' },
  { id: 'fcos', name: 'FCOS Efficient', task: 'detect', platform: 'X3/X5', fps: '25', size: '22.8 MB', source: 'official', desc: '全卷积单阶段检测器，密集场景优化' },
  { id: 'mobilenet', name: 'MobileNetV2', task: 'classify', platform: 'X3/X5/Ultra', fps: '120', size: '8.6 MB', source: 'official', desc: '轻量级图像分类，1000 类 ImageNet' },
  { id: 'unet', name: 'U-Net', task: 'segment', platform: 'X5/Ultra', fps: '15', size: '31.4 MB', source: 'community', desc: '语义分割网络，医疗/工业场景适用' },
  { id: 'deeplabv3', name: 'DeepLabV3+', task: 'segment', platform: 'Ultra', fps: '18', size: '42.1 MB', source: 'community', desc: '高精度场景解析，21 类 VOC 分割' },
  { id: 'resnet50', name: 'ResNet-50', task: 'classify', platform: 'X3/X5/Ultra', fps: '80', size: '25.5 MB', source: 'official', desc: '经典分类骨干网络，特征提取基础模型' },
  { id: 'centernet', name: 'CenterNet', task: 'detect', platform: 'X5/Ultra', fps: '35', size: '18.9 MB', source: 'community', desc: '基于关键点的检测方案，无 anchor 设计' },
];

const TASK_FILTERS = [
  { id: 'all', label: '全部', icon: '📋' },
  { id: 'detect', label: '目标检测', icon: '🎯' },
  { id: 'classify', label: '图像分类', icon: '🏷️' },
  { id: 'segment', label: '语义分割', icon: '🖼️' },
];

export default function Models() {
  const { currentDevice, addToast, setActiveTab } = useAppState();
  const [taskFilter, setTaskFilter] = useState('all');
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const filtered = taskFilter === 'all' ? MODELZOO_MODELS : MODELZOO_MODELS.filter(m => m.task === taskFilter);
  const detail = selectedModel ? MODELZOO_MODELS.find(m => m.id === selectedModel) : null;
  const localModel = detail ? MODEL_REPO.find(m => m.id === detail.id) : null;

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🧠 模型仓库 · ModelZoo</div>
        <div className="desc-text">浏览地瓜机器人 ModelZoo 模型，一键转换部署到 RDK 开发板。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 评估</span>
          <span className="ai-recommend-text">
            {currentDevice?.name || 'RDK'} BPU 算力充足 ·
            <strong style={{ color: '#22c55e' }}> {MODELZOO_MODELS.filter(m => MODEL_REPO.some(r => r.id === m.id && r.status === 'deployed')).length} 个已部署</strong> ·
            推荐同时运行不超过 2 个模型以保持实时性
          </span>
        </div>

        <div className="chip-cloud" style={{ marginBottom: 16 }}>
          {TASK_FILTERS.map(f => (
            <button key={f.id} className={`chip-btn ${taskFilter === f.id ? 'active' : ''}`} onClick={() => setTaskFilter(f.id)}>
              {f.icon} {f.label}
            </button>
          ))}
          <button className="chip-btn" style={{ marginLeft: 'auto', color: '#64748b' }} onClick={() => window.open('https://developer.d-robotics.cc/modelzoo', '_blank')}>
            ModelZoo ↗
          </button>
        </div>

        {!detail ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {filtered.map(m => {
                const deployed = MODEL_REPO.some(r => r.id === m.id && r.status === 'deployed');
                return (
                  <div key={m.id} className="panel-card" style={{ cursor: 'pointer', padding: 14, transition: 'all 0.2s' }}
                    onClick={() => setSelectedModel(m.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <strong style={{ fontSize: '0.9rem' }}>{m.name}</strong>
                      <span className={`card-status-badge ${deployed ? 'ok' : ''}`} style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
                        {deployed ? '✅ 已部署' : '📦 可用'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5, marginBottom: 6 }}>{m.desc}</div>
                    <div style={{ display: 'flex', gap: 12, fontSize: '0.72rem', color: '#94a3b8' }}>
                      <span>⚡ {m.fps} FPS</span>
                      <span>💾 {m.size}</span>
                      <span>📱 {m.platform}</span>
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#94a3b8' }}>
                      <span>{m.source === 'official' ? '🏷️ 官方' : '👤 社区'}</span>
                      <span>{TASK_FILTERS.find(f => f.id === m.task)?.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
              <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6 }}>
                💡 用底部聊天框描述需求（如"我需要一个能检测行人的模型"），AI 会推荐最合适的模型并评估与你设备的兼容性。
              </div>
            </div>
          </>
        ) : (
          <>
            <button className="clean-btn outline-btn sm-btn" style={{ alignSelf: 'flex-start', marginBottom: 12 }}
              onClick={() => setSelectedModel(null)}>← 返回列表</button>

            <div className="workspace-grid two-column">
              <div className="panel-card">
                <div className="panel-title">{detail.name}</div>
                <div className="desc-text" style={{ marginBottom: 10 }}>{detail.desc}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                  {[
                    { label: '任务类型', value: TASK_FILTERS.find(f => f.id === detail.task)?.label || '' },
                    { label: '推理速度', value: `${detail.fps} FPS` },
                    { label: '模型大小', value: detail.size },
                    { label: '适配平台', value: detail.platform },
                  ].map(f => (
                    <div key={f.label} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 12px' }}>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: 2 }}>{f.label}</div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{f.value}</div>
                    </div>
                  ))}
                </div>

                {localModel ? (
                  <div style={{ padding: '10px 14px', background: localModel.status === 'deployed' ? '#f0fdf4' : '#fffbeb', borderRadius: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                      {localModel.status === 'deployed' ? '✅ 已在设备上部署' : '⚠️ 需要格式转换'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                      {localModel.status === 'deployed' ? `当前格式: ${localModel.format}，推理 ${localModel.fps} FPS` : '需运行 hb_mapper 转换为 BPU 优化格式'}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>📥 尚未下载到设备</div>
                    <div style={{ fontSize: '0.78rem', color: '#475569' }}>点击部署按钮，AI 将自动下载、转换并部署到 BPU</div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="clean-btn" onClick={() => addToast(`${detail.name} 部署中...`, 'info')}>
                    {localModel?.status === 'deployed' ? '🔄 重新部署' : '🚀 部署'}
                  </button>
                  <button className="clean-btn outline-btn" onClick={() => addToast('基准测试已启动', 'info')}>⚡ Benchmark</button>
                </div>

                {/* Inference result preview (shown when deployed) */}
                {localModel?.status === 'deployed' && (
                  <div style={{ marginTop: 14, borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                    <div style={{ background: '#0f172a', position: 'relative', aspectRatio: '16/9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <span style={{ fontSize: '1.6rem' }}>{detail.task === 'detect' ? '🎯' : detail.task === 'segment' ? '🖼️' : '🏷️'}</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                        {detail.task === 'detect' ? '检测结果预览' : detail.task === 'segment' ? '分割结果预览' : '分类结果预览'}
                      </span>
                      {detail.task === 'detect' && (
                        <>
                          <div style={{ position: 'absolute', top: '18%', left: '12%', width: '28%', height: '50%', border: '2px solid #22c55e', borderRadius: 4 }}>
                            <span style={{ position: 'absolute', top: -16, left: 0, background: '#22c55e', color: '#fff', fontSize: '0.58rem', padding: '1px 5px', borderRadius: 3 }}>person 0.96</span>
                          </div>
                          <div style={{ position: 'absolute', top: '35%', left: '58%', width: '18%', height: '30%', border: '2px solid #3b82f6', borderRadius: 4 }}>
                            <span style={{ position: 'absolute', top: -16, left: 0, background: '#3b82f6', color: '#fff', fontSize: '0.58rem', padding: '1px 5px', borderRadius: 3 }}>car 0.89</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#f8fafc' }}>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>推理结果 · {detail.fps} FPS · BPU</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="clean-btn outline-btn sm-btn" style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                          onClick={() => { setActiveTab('ros'); addToast('跳转到 /hobot_dnn 话题查看实时推理', 'info'); }}>📡 ROS 话题</button>
                        <button className="clean-btn outline-btn sm-btn" style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                          onClick={() => { setActiveTab('terminal'); addToast('在终端运行推理脚本...', 'info'); }}>▶ 运行推理</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="panel-card">
                <div className="panel-title">部署流水线</div>
                <div className="usage-list">
                  <div className="usage-item"><strong>1. 下载模型</strong><span>从 ModelZoo 拉取预训练权重</span></div>
                  <div className="usage-item"><strong>2. AI 结构分析</strong><span>自动检测输入输出与量化兼容性</span></div>
                  <div className="usage-item"><strong>3. hb_mapper 转换</strong><span>量化为 BPU 优化的 INT8 格式</span></div>
                  <div className="usage-item"><strong>4. 性能基准</strong><span>运行 benchmark 验证 FPS 与精度</span></div>
                  <div className="usage-item"><strong>5. 部署到 ROS</strong><span>关联推理节点，发布到 /hobot_dnn 话题</span></div>
                </div>

                <div className="panel-title" style={{ marginTop: 14 }}>查看推理结果</div>
                <div className="usage-list">
                  <div className="usage-item">
                    <strong>📡 ROS 话题</strong>
                    <span>部署到 ROS 后，推理结果自动发布到话题，可在「ROS 话题分析」页面实时查看带检测框的画面</span>
                  </div>
                  <div className="usage-item">
                    <strong>▶ 脚本运行</strong>
                    <span>用 bpu_infer_lib 加载 .bin 模型，输入图片即可获得推理输出，结果保存为 result.jpg</span>
                  </div>
                  <div className="usage-item">
                    <strong>📊 Jupyter</strong>
                    <span>在 code-server 中打开 ModelZoo 自带的 Jupyter Notebook，逐步查看推理流程与可视化结果</span>
                  </div>
                </div>

                <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>🔗 相关页面</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="chip-btn" onClick={() => setActiveTab('ros')}>📡 ROS 话题查看</button>
                    <button className="chip-btn" onClick={() => setActiveTab('ide')}>📝 代码编辑</button>
                    <button className="chip-btn" onClick={() => setActiveTab('terminal')}>💻 终端运行</button>
                    <button className="chip-btn" onClick={() => setActiveTab('examples')}>📦 相关示例</button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
