import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';

/* ── ModelZoo 模型仓库 ── */

interface ModelItem {
  id: string;
  name: string;
  category: string;
  framework: string;
  task: string;
  desc: string;
  size: string;
  accuracy: string;
  latency: string;
  boards: string[];
  deployed: boolean;
  version: string;
  downloads: number;
}

const MODELS: ModelItem[] = [
  {
    id: 'yolov5s', name: 'YOLOv5s', category: '检测', framework: 'ONNX → BPU',
    task: '目标检测', desc: '轻量级实时目标检测模型，支持 80 类 COCO 目标，适合边缘部署。',
    size: '14.1 MB', accuracy: 'mAP 37.4', latency: '8.2ms', boards: ['RDK X3', 'RDK X5'],
    deployed: false, version: '1.0.2', downloads: 3420,
  },
  {
    id: 'fcos', name: 'FCOS', category: '检测', framework: 'PyTorch → BPU',
    task: '目标检测', desc: '无锚框目标检测，精度更高，适合复杂场景。',
    size: '32.5 MB', accuracy: 'mAP 41.0', latency: '15.6ms', boards: ['RDK X5'],
    deployed: true, version: '2.1.0', downloads: 1856,
  },
  {
    id: 'mobilenetv2', name: 'MobileNetV2', category: '分类', framework: 'TFLite → BPU',
    task: '图像分类', desc: '高效图像分类模型，ImageNet Top-1 精度 72%，极低延迟。',
    size: '6.9 MB', accuracy: 'Top1 72.0%', latency: '3.1ms', boards: ['RDK X3', 'RDK X5'],
    deployed: true, version: '1.3.1', downloads: 2890,
  },
  {
    id: 'deeplabv3', name: 'DeepLabV3+', category: '分割', framework: 'ONNX → BPU',
    task: '语义分割', desc: '高精度语义分割模型，支持 21 类 VOC 分割。',
    size: '43.2 MB', accuracy: 'mIoU 78.5', latency: '22.4ms', boards: ['RDK X5'],
    deployed: false, version: '1.0.0', downloads: 945,
  },
  {
    id: 'hand-lmk', name: 'HandLandmark', category: '关键点', framework: 'TFLite → BPU',
    task: '手部关键点', desc: '21 个手部关键点检测，支持手势识别与交互控制。',
    size: '5.8 MB', accuracy: 'PCK 94.2%', latency: '4.7ms', boards: ['RDK X3', 'RDK X5'],
    deployed: false, version: '1.1.0', downloads: 1567,
  },
  {
    id: 'whisper-tiny', name: 'Whisper Tiny', category: '语音', framework: 'ONNX → BPU',
    task: '语音识别', desc: 'OpenAI Whisper 轻量版，支持中英文语音转文字。',
    size: '72.1 MB', accuracy: 'WER 8.2%', latency: '120ms', boards: ['RDK X5'],
    deployed: false, version: '0.9.0', downloads: 678,
  },
];

const CATEGORIES = ['全部', '检测', '分类', '分割', '关键点', '语音'];

export default function Models() {
  const { currentDevice, addToast, runTerminalCommand } = useAppState();
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'downloads' | 'name'>('downloads');
  const [selected, setSelected] = useState<string | null>(null);
  const [models, setModels] = useState(MODELS);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null);
  const [convertStep, setConvertStep] = useState(0);

  const filtered = models
    .filter(m => category === '全部' || m.category === category)
    .filter(m => !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.desc.includes(search))
    .sort((a, b) => sortBy === 'downloads' ? b.downloads - a.downloads : a.name.localeCompare(b.name));

  const detail = models.find(m => m.id === selected);

  const handleDeploy = (model: ModelItem) => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    setDeploying(model.id);
    setTimeout(() => {
      setDeploying(null);
      setModels(prev => prev.map(m => m.id === model.id ? { ...m, deployed: true } : m));
      addToast(`${model.name} 部署成功`, 'success');
    }, 2500);
  };

  const handleConvert = (model: ModelItem) => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    setConverting(model.id);
    setConvertStep(0);
    const steps = ['解析模型结构', '量化校准', 'BPU 编译', '验证输出'];
    let step = 0;
    const iv = setInterval(() => {
      step++;
      setConvertStep(step);
      if (step >= steps.length) {
        clearInterval(iv);
        setTimeout(() => {
          setConverting(null);
          setConvertStep(0);
          addToast(`${model.name} 转换完成`, 'success');
        }, 800);
      }
    }, 1200);
  };

  const handleRun = (model: ModelItem) => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    runTerminalCommand(`cd /opt/models && python3 run_${model.id.replace(/-/g, '_')}.py`);
    addToast(`正在运行 ${model.name}`, 'info');
  };

  // 空状态
  if (!currentDevice) {
    return (
      <div className="center-stage">
        <div className="mdl-empty">
          <div className="mdl-empty-icon">🧠</div>
          <h2 className="mdl-empty-title">ModelZoo 模型仓库</h2>
          <p className="mdl-empty-desc">
            地瓜机器人 BPU 加速模型库，支持一键部署与模型转换。
            <br/>请先连接设备以浏览和部署模型。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mdl-page">
      {/* 顶栏 */}
      <div className="mdl-header">
        <div className="mdl-header-left">
          <div className="mdl-header-icon">🧠</div>
          <div>
            <h2 className="mdl-title">ModelZoo 模型仓库</h2>
            <span className="mdl-subtitle">
              {filtered.length} 个模型 · {models.filter(m => m.deployed).length} 已部署
            </span>
          </div>
        </div>
        <div className="mdl-header-right">
          <div className="mdl-search-box">
            <span>🔍</span>
            <input className="mdl-search-input" placeholder="搜索模型..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="mdl-sort-select" value={sortBy}
            onChange={e => setSortBy(e.target.value as 'downloads' | 'name')}>
            <option value="downloads">按热度</option>
            <option value="name">按名称</option>
          </select>
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="mdl-filters">
        {CATEGORIES.map(c => (
          <button key={c} className={`mdl-filter-btn ${category === c ? 'active' : ''}`}
            onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>

      {/* 主体 */}
      <div className="mdl-body" style={{ gridTemplateColumns: detail ? '1fr 340px' : '1fr' }}>
        <div className="mdl-grid">
          {filtered.map(model => (
            <div key={model.id}
              className={`mdl-card ${selected === model.id ? 'selected' : ''}`}
              onClick={() => setSelected(model.id)}>
              <div className="mdl-card-top">
                <div>
                  <div className="mdl-card-name">{model.name}</div>
                  <div className="mdl-card-tags">
                    {model.deployed && <span className="mdl-tag deployed">已部署</span>}
                    <span className="mdl-tag format">{model.framework}</span>
                  </div>
                </div>
              </div>
              <p className="mdl-card-desc">{model.desc}</p>
              <div className="mdl-card-meta">
                <span>{model.task}</span>
                <span>{model.size}</span>
                <span>v{model.version}</span>
                <span>📥 {model.downloads}</span>
              </div>
              <div className="mdl-card-boards">
                {model.boards.map(b => <span key={b} className="mdl-board-tag">{b}</span>)}
              </div>
              <div className="mdl-card-bench">
                <span>精度: {model.accuracy}</span>
                <span>延迟: {model.latency}</span>
              </div>
              <div className="mdl-card-actions">
                <div className="mdl-action-main">
                  {model.deployed ? (
                    <button className="mdl-btn-primary"
                      onClick={e => { e.stopPropagation(); handleRun(model); }}>
                      ▶ 运行
                    </button>
                  ) : (
                    <button className="mdl-btn-primary"
                      disabled={deploying === model.id}
                      onClick={e => { e.stopPropagation(); handleDeploy(model); }}>
                      {deploying === model.id ? '部署中...' : '🚀 部署'}
                    </button>
                  )}
                </div>
                <button className="mdl-btn-convert"
                  onClick={e => { e.stopPropagation(); handleConvert(model); }}>
                  🔄 转换
                </button>
                <button className="mdl-btn-ghost"
                  onClick={e => { e.stopPropagation(); setSelected(model.id); }}>
                  详情
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="mdl-empty-list">没有匹配的模型</div>
          )}
        </div>

        {/* 详情面板 */}
        {detail && (
          <div className="mdl-detail">
            <div className="mdl-detail-header">
              <h3 className="mdl-detail-name">{detail.name}</h3>
              <button className="mdl-detail-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="mdl-detail-body">
              <p className="mdl-detail-desc">{detail.desc}</p>

              <div className="mdl-detail-grid">
                <div className="mdl-detail-cell">
                  <div className="mdl-detail-label">任务类型</div>
                  <div className="mdl-detail-value">{detail.task}</div>
                </div>
                <div className="mdl-detail-cell">
                  <div className="mdl-detail-label">框架</div>
                  <div className="mdl-detail-value">{detail.framework}</div>
                </div>
                <div className="mdl-detail-cell">
                  <div className="mdl-detail-label">模型大小</div>
                  <div className="mdl-detail-value">{detail.size}</div>
                </div>
                <div className="mdl-detail-cell">
                  <div className="mdl-detail-label">版本</div>
                  <div className="mdl-detail-value">v{detail.version}</div>
                </div>
              </div>

              <div className="mdl-bench-section">
                <div className="mdl-detail-label" style={{ marginBottom: 6 }}>性能基准</div>
                <div className="mdl-bench-cards">
                  <div className="mdl-bench-card">
                    <div className="mdl-bench-val">{detail.accuracy}</div>
                    <div className="mdl-bench-label">精度</div>
                  </div>
                  <div className="mdl-bench-card">
                    <div className="mdl-bench-val">{detail.latency}</div>
                    <div className="mdl-bench-label">推理延迟</div>
                  </div>
                  <div className="mdl-bench-card">
                    <div className="mdl-bench-val">{detail.downloads}</div>
                    <div className="mdl-bench-label">下载量</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="mdl-detail-label" style={{ marginBottom: 6 }}>支持板卡</div>
                <div className="mdl-detail-boards">
                  {detail.boards.map(b => (
                    <span key={b} className="mdl-board-chip">{b}</span>
                  ))}
                </div>
              </div>

              <div>
                <div className="mdl-detail-label" style={{ marginBottom: 6 }}>部署命令</div>
                <div className="mdl-terminal">
{`# 下载模型
wget https://model.d-robotics.cc/${detail.id}/latest.bin

# 部署到 BPU
hb_model_deploy --model ${detail.id}.bin --target bpu

# 运行推理
python3 run_${detail.id.replace(/-/g, '_')}.py`}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {detail.deployed ? (
                  <button className="mdl-btn-primary" style={{ flex: 1 }}
                    onClick={() => handleRun(detail)}>▶ 运行模型</button>
                ) : (
                  <button className="mdl-btn-primary" style={{ flex: 1 }}
                    disabled={deploying === detail.id}
                    onClick={() => handleDeploy(detail)}>
                    {deploying === detail.id ? '部署中...' : '🚀 一键部署'}
                  </button>
                )}
                <button className="mdl-btn-convert"
                  onClick={() => handleConvert(detail)}>🔄 转换</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 转换流水线弹窗 */}
      {converting && (
        <div className="mdl-convert-overlay" onClick={() => { setConverting(null); setConvertStep(0); }}>
          <div className="mdl-convert-modal" onClick={e => e.stopPropagation()}>
            <h3 className="mdl-convert-title">
              🔄 模型转换 — {models.find(m => m.id === converting)?.name}
            </h3>
            <p className="mdl-convert-desc">正在将模型转换为 BPU 可执行格式</p>
            <div className="mdl-convert-steps">
              {['解析模型结构', '量化校准', 'BPU 编译', '验证输出'].map((step, i) => (
                <div key={i} className={`mdl-convert-step ${i < convertStep ? 'done' : i === convertStep ? 'running' : ''}`}>
                  <div className={`mdl-step-circle ${i < convertStep ? 'done' : i === convertStep ? 'running' : ''}`}>
                    {i < convertStep ? '✓' : i + 1}
                  </div>
                  <div>
                    <div className="mdl-step-label">{step}</div>
                    <div className="mdl-step-desc">
                      {i < convertStep ? '完成' : i === convertStep ? '进行中...' : '等待中'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {convertStep >= 4 && (
              <div className="mdl-convert-done">
                <span className="mdl-convert-done-text">✅ 转换完成</span>
                <button className="mdl-btn-primary"
                  onClick={() => { setConverting(null); setConvertStep(0); }}>
                  关闭
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
