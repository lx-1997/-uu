import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, getRememberedDevicePassword } from '../api';

/* ── ModelZoo 模型仓库（苹果风格 · 真实接入）── */

interface ModelItem {
  id: string; name: string; icon: string; desc: string; category: string;
  format: string; size: string; boards: string[];
  deployCmd: string; runCmd: string; removeCmd: string;
  repo: string; deployed: boolean; running: boolean; custom?: boolean;
  fps?: string; latency?: string;
}

const BUILTIN_MODELS: ModelItem[] = [
  { id: 'yolov5', name: 'YOLOv5s', icon: '🎯', desc: '高效目标检测模型，支持 80 类物体识别', category: '检测',
    format: 'BIN', size: '14MB', boards: ['RDK X3', 'RDK X5'], fps: '30fps', latency: '33ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/detect/yolov5',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh yolov5s',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/detect/yolov5/yolov5_detect.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/yolov5s*', deployed: false, running: false },
  { id: 'fcos', name: 'FCOS', icon: '📦', desc: '无锚框目标检测，适合密集场景', category: '检测',
    format: 'BIN', size: '22MB', boards: ['RDK X3', 'RDK X5'], fps: '25fps', latency: '40ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/detect/fcos',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh fcos',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/detect/fcos/fcos_detect.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/fcos*', deployed: false, running: false },
  { id: 'mobilenetv2', name: 'MobileNetV2', icon: '🏷️', desc: '轻量级图像分类模型', category: '分类',
    format: 'BIN', size: '8MB', boards: ['RDK X3', 'RDK X5', 'RDK Ultra'], fps: '60fps', latency: '16ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/classify/mobilenetv2',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh mobilenetv2',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/classify/mobilenetv2/mobilenetv2_cls.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/mobilenetv2*', deployed: false, running: false },
  { id: 'deeplabv3', name: 'DeepLabV3+', icon: '🎨', desc: '语义分割模型，像素级场景理解', category: '分割',
    format: 'BIN', size: '18MB', boards: ['RDK X3', 'RDK X5'], fps: '15fps', latency: '66ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/segment/deeplabv3',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh deeplabv3plus',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/segment/deeplabv3/deeplabv3_seg.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/deeplabv3*', deployed: false, running: false },
  { id: 'yolov8pose', name: 'YOLOv8-Pose', icon: '🏃', desc: '人体姿态估计，17 关键点检测', category: '姿态',
    format: 'BIN', size: '12MB', boards: ['RDK X5'], fps: '20fps', latency: '50ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/pose/yolov8_pose',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh yolov8_pose',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/pose/yolov8_pose/yolov8_pose.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/yolov8_pose*', deployed: false, running: false },
  { id: 'whisper', name: 'Whisper-tiny', icon: '🎙️', desc: '语音识别模型，支持中英文', category: '语音',
    format: 'ONNX', size: '39MB', boards: ['RDK X5', 'RDK Ultra'], fps: '--', latency: '200ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh whisper_tiny',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/audio/whisper/whisper_asr.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/whisper*', deployed: false, running: false },
];

const CATEGORIES = ['全部', '检测', '分类', '分割', '姿态', '语音', '自定义'];

export default function Models() {
  const { currentDevice, addToast } = useAppState();
  const [models, setModels] = useState<ModelItem[]>(BUILTIN_MODELS);
  const [filter, setFilter] = useState('全部');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newModel, setNewModel] = useState({ name: '', desc: '', format: 'BIN', deployCmd: '', runCmd: '', removeCmd: '' });

  const detail = models.find(m => m.id === selected);
  const filtered = models.filter(m => (filter === '全部' || m.category === filter) && (!search || m.name.toLowerCase().includes(search.toLowerCase()) || m.desc.includes(search)));
  const deployedCount = models.filter(m => m.deployed).length;

  const exec = async (id: string, cmd: string, label: string) => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return null; }
    setBusyId(id);
    setLogs(p => [...p.slice(-40), `[${label}] ${new Date().toLocaleTimeString()}`, `$ ${cmd}`]);
    setShowLog(true);
    try {
      const pwd = getRememberedDevicePassword(currentDevice.id);
      const r = await executeDeviceCommand(currentDevice.id, `bash -lc "${cmd}"`, pwd);
      setLogs(p => [...p, r.output || '(无输出)', '']);
      return r.output || '';
    } catch {
      setLogs(p => [...p, 'ERROR: 执行失败', '']);
      addToast(`${label}失败`, 'error');
      return null;
    } finally { setBusyId(null); }
  };

  const handleDeploy = async (m: ModelItem) => {
    addToast(`正在部署 ${m.name}...`, 'info');
    // 先检查 model_zoo 是否存在
    await exec(m.id, 'test -d /opt/rdk_model_zoo || (cd /opt && git clone https://github.com/D-Robotics/rdk_model_zoo.git)', '检查 ModelZoo');
    const out = await exec(m.id, m.deployCmd, `部署 ${m.name}`);
    if (out !== null) { setModels(p => p.map(x => x.id === m.id ? { ...x, deployed: true } : x)); addToast(`${m.name} 部署完成`, 'success'); }
  };

  const handleRun = async (m: ModelItem) => {
    addToast(`正在运行 ${m.name}...`, 'info');
    const out = await exec(m.id, m.runCmd, `运行 ${m.name}`);
    if (out !== null) { setModels(p => p.map(x => x.id === m.id ? { ...x, running: true } : x)); addToast(`${m.name} 已启动`, 'success'); }
  };

  const handleStop = async (m: ModelItem) => {
    await exec(m.id, `pkill -f "${m.name.toLowerCase()}" || true`, `停止 ${m.name}`);
    setModels(p => p.map(x => x.id === m.id ? { ...x, running: false } : x));
    addToast(`${m.name} 已停止`, 'info');
  };

  const handleRemove = async (m: ModelItem) => {
    if (!confirm(`确定移除 ${m.name}？`)) return;
    const out = await exec(m.id, m.removeCmd, `移除 ${m.name}`);
    if (out !== null) { setModels(p => p.map(x => x.id === m.id ? { ...x, deployed: false, running: false } : x)); addToast(`${m.name} 已移除`, 'info'); }
  };

  const handleRemoveCustom = (id: string) => { setModels(p => p.filter(m => m.id !== id)); addToast('已删除', 'info'); };

  const handleAddModel = () => {
    if (!newModel.name || !newModel.deployCmd) { addToast('请填写名称和部署命令', 'warning'); return; }
    setModels(p => [...p, { id: `custom-${Date.now()}`, icon: '🧠', category: '自定义', size: '--', boards: [], repo: '', deployed: false, running: false, custom: true, ...newModel, removeCmd: newModel.removeCmd || `echo "请手动移除"` }]);
    setNewModel({ name: '', desc: '', format: 'BIN', deployCmd: '', runCmd: '', removeCmd: '' });
    setShowAdd(false);
    addToast('模型已添加', 'success');
  };

  if (!currentDevice) {
    return (
      <div className="center-stage">
        <div className="oc-install-hero">
          <span style={{ fontSize: '4rem' }}>🧠</span>
          <div>
            <h1 className="oc-hero-title">ModelZoo</h1>
            <p className="oc-hero-sub">RDK 模型仓库 · BPU 加速推理<br/>一键部署、运行 AI 模型到开发板</p>
          </div>
        </div>
        <div className="isolated-widget" style={{ marginTop: 24 }}>
          <div className="widget-header">快速开始</div>
          <p className="desc-text">ModelZoo 提供经过 BPU 优化的 AI 模型，支持目标检测、分类、分割、姿态估计等任务。</p>
          <div className="oc-steps">
            <div className="oc-step"><span className="oc-step-n">1</span>连接 RDK 开发板</div>
            <div className="oc-step"><span className="oc-step-n">2</span>选择模型并一键部署到设备</div>
            <div className="oc-step"><span className="oc-step-n">3</span>运行推理，查看实时效果</div>
          </div>
          <div style={{ marginTop: 16 }}>
            <a href="https://github.com/D-Robotics/rdk_model_zoo" target="_blank" rel="noopener noreferrer" className="oc-ext-link">🔗 访问 ModelZoo</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="center-stage wide-stage">
      {/* 状态栏 */}
      <div className="oc-bar">
        <div className="oc-bar-left">
          <span style={{ fontSize: '1.4rem' }}>🧠</span>
          <span className="oc-bar-name">ModelZoo</span>
          <a href="https://github.com/D-Robotics/rdk_model_zoo" target="_blank" rel="noopener noreferrer" className="oc-ext-link" style={{ marginLeft: 8, fontSize: '0.75rem' }}>GitHub ↗</a>
        </div>
        <div className="oc-bar-right">
          <span className="oc-bar-stat"><b>{deployedCount}</b> 已部署</span>
          <span className="oc-bar-stat"><b>{models.filter(m => m.running).length}</b> 运行中</span>
          <button className="oc-bar-btn" onClick={() => setShowAdd(true)}>+ 添加模型</button>
        </div>
      </div>

      {/* 概览 */}
      <div className="isolated-widget" style={{ marginTop: 16 }}>
        <div className="oc-config-bar">
          <div className="oc-cfg-item"><span className="oc-cfg-label">设备</span><span className="oc-cfg-val ok">{currentDevice.ip}</span></div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item"><span className="oc-cfg-label">模型总数</span><span className="oc-cfg-val mono">{models.length}</span></div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item"><span className="oc-cfg-label">已部署</span><span className="oc-cfg-val">{deployedCount}</span></div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item"><span className="oc-cfg-label">运行中</span><span className={`oc-cfg-val ${models.some(m => m.running) ? 'ok' : 'dim'}`}>{models.filter(m => m.running).length}</span></div>
        </div>
      </div>

      {/* 筛选 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {CATEGORIES.map(c => (
          <button key={c} className={`oc-bar-btn ${filter === c ? 'primary' : ''}`} onClick={() => setFilter(c)}>{c}</button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <input className="oc-skill-add-input" placeholder="搜索模型..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
        </div>
      </div>

      {/* 模型卡片 */}
      <div className="workspace-grid three-column" style={{ marginTop: 16 }}>
        {filtered.map(m => (
          <div key={m.id} className="panel-card" style={{ cursor: 'pointer', borderColor: selected === m.id ? '#ff6b00' : undefined }} onClick={() => setSelected(m.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: '1.5rem' }}>{m.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>{m.name}</div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{m.category} · {m.format} · {m.size}</div>
              </div>
              {m.running && <span className="oc-bar-badge on" style={{ fontSize: '0.66rem' }}><span className="oc-live-dot" />运行中</span>}
              {m.deployed && !m.running && <span className="oc-bar-badge" style={{ fontSize: '0.66rem', background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0' }}>已部署</span>}
            </div>
            <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>{m.desc}</p>
            {(m.fps || m.latency) && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: '0.72rem', color: '#94a3b8' }}>
                {m.fps && <span>⚡ {m.fps}</span>}
                {m.latency && <span>⏱ {m.latency}</span>}
                {m.boards.length > 0 && <span>📋 {m.boards.join(', ')}</span>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {!m.deployed && <button className="oc-bar-btn primary" style={{ fontSize: '0.78rem', padding: '5px 14px' }} disabled={busyId === m.id} onClick={e => { e.stopPropagation(); handleDeploy(m); }}>{busyId === m.id ? '部署中...' : '部署'}</button>}
              {m.deployed && !m.running && <button className="oc-bar-btn primary" style={{ fontSize: '0.78rem', padding: '5px 14px' }} disabled={busyId === m.id} onClick={e => { e.stopPropagation(); handleRun(m); }}>▶ 运行</button>}
              {m.running && <button className="oc-bar-btn" style={{ fontSize: '0.78rem', padding: '5px 14px', color: '#ef4444', borderColor: '#fca5a5' }} onClick={e => { e.stopPropagation(); handleStop(m); }}>⏹ 停止</button>}
              {m.deployed && <button className="oc-bar-btn" style={{ fontSize: '0.78rem', padding: '5px 14px', color: '#ef4444', borderColor: '#fca5a5' }} onClick={e => { e.stopPropagation(); handleRemove(m); }}>移除</button>}
              {m.custom && <button className="oc-bar-btn" style={{ fontSize: '0.78rem', padding: '5px 14px' }} onClick={e => { e.stopPropagation(); handleRemoveCustom(m.id); }}>删除</button>}
              {m.repo && <a href={m.repo} target="_blank" rel="noopener noreferrer" className="oc-ext-link" style={{ fontSize: '0.72rem' }} onClick={e => e.stopPropagation()}>详情 ↗</a>}
            </div>
          </div>
        ))}
      </div>

      {/* 日志 */}
      {showLog && logs.length > 0 && (
        <div className="isolated-widget" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="widget-header" style={{ margin: 0 }}>📋 执行日志</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="oc-bar-btn" onClick={() => setLogs([])}>清空</button>
              <button className="oc-bar-btn" onClick={() => setShowLog(false)}>收起</button>
            </div>
          </div>
          <pre className="ros-output-content" style={{ maxHeight: 200, overflow: 'auto' }}>{logs.join('\n')}</pre>
        </div>
      )}

      {/* 添加模型弹窗 */}
      {showAdd && (
        <>
          <div className="oc-modal-mask" onClick={() => setShowAdd(false)} />
          <div className="oc-modal">
            <div className="oc-modal-head">
              <h3 className="oc-modal-title">🧠 添加自定义模型</h3>
              <button className="oc-modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="oc-input-group"><label>模型名称</label><input placeholder="MyModel" value={newModel.name} onChange={e => setNewModel(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="oc-input-group"><label>描述</label><input placeholder="模型描述..." value={newModel.desc} onChange={e => setNewModel(p => ({ ...p, desc: e.target.value }))} /></div>
            <div className="oc-input-group"><label>格式</label>
              <select value={newModel.format} onChange={e => setNewModel(p => ({ ...p, format: e.target.value }))}>
                <option>BIN</option><option>ONNX</option><option>PyTorch</option><option>其他</option>
              </select>
            </div>
            <div className="oc-input-group"><label>部署命令</label><input placeholder="bash download.sh ..." value={newModel.deployCmd} onChange={e => setNewModel(p => ({ ...p, deployCmd: e.target.value }))} /></div>
            <div className="oc-input-group"><label>运行命令</label><input placeholder="python3 infer.py ..." value={newModel.runCmd} onChange={e => setNewModel(p => ({ ...p, runCmd: e.target.value }))} /></div>
            <div className="oc-input-group"><label>移除命令</label><input placeholder="rm -rf /path/to/model" value={newModel.removeCmd} onChange={e => setNewModel(p => ({ ...p, removeCmd: e.target.value }))} /></div>
            <button className="oc-save-btn wide" onClick={handleAddModel}>添加模型</button>
          </div>
        </>
      )}
    </div>
  );
}
