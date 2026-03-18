import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, getRememberedDevicePassword } from '../api';

/* ── ModelZoo 模型仓库 ── */

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newModel, setNewModel] = useState({ name: '', desc: '', format: 'BIN', deployCmd: '', runCmd: '', removeCmd: '' });

  const filtered = models.filter(m =>
    (filter === '全部' || m.category === filter) &&
    (!search || m.name.toLowerCase().includes(search.toLowerCase()) || m.desc.includes(search))
  );
  const deployedCount = models.filter(m => m.deployed).length;
  const runningCount = models.filter(m => m.running).length;

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

  /* ── 未连接设备 ── */
  if (!currentDevice) {
    return (
      <div className="mdl-page">
        <div className="mdl-empty-state">
          <div className="mdl-empty-icon-wrap">
            <span className="mdl-empty-glow" />
            <span style={{ fontSize: '3rem' }}>🧠</span>
          </div>
          <h2 className="mdl-empty-title">ModelZoo · 模型仓库</h2>
          <p className="mdl-empty-desc">RDK 模型仓库 · BPU 加速推理，一键部署运行 AI 模型到开发板</p>
          <div className="mdl-empty-steps">
            <div className="mdl-empty-step"><span className="mdl-step-num">1</span>连接 RDK 开发板</div>
            <div className="mdl-empty-step"><span className="mdl-step-num">2</span>选择模型并一键部署</div>
            <div className="mdl-empty-step"><span className="mdl-step-num">3</span>运行推理，查看效果</div>
          </div>
          <a href="https://github.com/D-Robotics/rdk_model_zoo" target="_blank" rel="noopener noreferrer" className="mdl-ext-link">
            访问 ModelZoo GitHub ↗
          </a>
        </div>
      </div>
    );
  }

  /* ── 主页面 ── */
  return (
    <div className="mdl-page">
      {/* 顶部状态栏 */}
      <div className="mdl-topbar">
        <div className="mdl-topbar-left">
          <span className="mdl-topbar-icon">🧠</span>
          <span className="mdl-topbar-name">ModelZoo</span>
          <span className="mdl-topbar-badge">{models.length} 模型</span>
        </div>
        <div className="mdl-topbar-right">
          <div className="mdl-stat-chips">
            <span className="mdl-stat-chip"><span className="mdl-stat-num">{deployedCount}</span>已部署</span>
            <span className="mdl-stat-chip live"><span className="mdl-stat-num">{runningCount}</span>运行中</span>
          </div>
          <button className="mdl-add-btn" onClick={() => setShowAdd(true)}>+ 添加模型</button>
        </div>
      </div>

      {/* 设备信息条 */}
      <div className="mdl-device-bar">
        <div className="mdl-device-item"><span className="mdl-device-label">设备</span><span className="mdl-device-val">{currentDevice.name}</span></div>
        <span className="mdl-device-sep" />
        <div className="mdl-device-item"><span className="mdl-device-label">IP</span><span className="mdl-device-val mono">{currentDevice.ip}</span></div>
        <span className="mdl-device-sep" />
        <div className="mdl-device-item"><span className="mdl-device-label">已部署</span><span className="mdl-device-val">{deployedCount}</span></div>
        <span className="mdl-device-sep" />
        <div className="mdl-device-item"><span className="mdl-device-label">运行中</span><span className={`mdl-device-val ${runningCount > 0 ? 'ok' : ''}`}>{runningCount}</span></div>
      </div>

      {/* 筛选栏 */}
      <div className="mdl-filter-bar">
        <div className="mdl-filter-tabs">
          {CATEGORIES.map(c => (
            <button key={c} className={`mdl-tab-btn ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>{c}</button>
          ))}
        </div>
        <div className="mdl-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input className="mdl-search" placeholder="搜索模型..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* 模型卡片网格 */}
      <div className="mdl-grid">
        {filtered.length === 0 && (
          <div className="mdl-no-result">没有匹配的模型</div>
        )}
        {filtered.map(m => (
          <div key={m.id} className={`mdl-card ${m.running ? 'running' : m.deployed ? 'deployed' : ''}`}>
            <div className="mdl-card-head">
              <span className="mdl-card-icon">{m.icon}</span>
              <div className="mdl-card-info">
                <span className="mdl-card-name">{m.name}</span>
                <span className="mdl-card-meta">{m.category} · {m.format} · {m.size}</span>
              </div>
              {m.running && <span className="mdl-badge running"><span className="mdl-badge-dot" />运行中</span>}
              {m.deployed && !m.running && <span className="mdl-badge deployed">已部署</span>}
            </div>
            <p className="mdl-card-desc">{m.desc}</p>
            {(m.fps || m.latency) && (
              <div className="mdl-card-perf">
                {m.fps && <span>⚡ {m.fps}</span>}
                {m.latency && <span>⏱ {m.latency}</span>}
              </div>
            )}
            {m.boards.length > 0 && (
              <div className="mdl-card-boards">
                {m.boards.map(b => <span key={b} className="mdl-board-chip">{b}</span>)}
              </div>
            )}
            <div className="mdl-card-actions">
              {!m.deployed && (
                <button className="mdl-btn primary" disabled={busyId === m.id} onClick={() => handleDeploy(m)}>
                  {busyId === m.id ? '部署中...' : '部署'}
                </button>
              )}
              {m.deployed && !m.running && (
                <button className="mdl-btn primary" disabled={busyId === m.id} onClick={() => handleRun(m)}>▶ 运行</button>
              )}
              {m.running && (
                <button className="mdl-btn danger" onClick={() => handleStop(m)}>⏹ 停止</button>
              )}
              {m.deployed && (
                <button className="mdl-btn ghost" onClick={() => handleRemove(m)}>移除</button>
              )}
              {m.custom && (
                <button className="mdl-btn ghost" onClick={() => handleRemoveCustom(m.id)}>删除</button>
              )}
              {m.repo && (
                <a href={m.repo} target="_blank" rel="noopener noreferrer" className="mdl-btn link">详情 ↗</a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 日志面板 */}
      {showLog && logs.length > 0 && (
        <div className="mdl-log-panel">
          <div className="mdl-log-header">
            <span>📋 执行日志</span>
            <div className="mdl-log-actions">
              <button className="mdl-btn ghost sm" onClick={() => setLogs([])}>清空</button>
              <button className="mdl-btn ghost sm" onClick={() => setShowLog(false)}>收起</button>
            </div>
          </div>
          <pre className="mdl-log-body">{logs.join('\n')}</pre>
        </div>
      )}

      {/* 添加模型弹窗 */}
      {showAdd && (
        <>
          <div className="mdl-overlay" onClick={() => setShowAdd(false)} />
          <div className="mdl-modal">
            <div className="mdl-modal-head">
              <h3 className="mdl-modal-title">🧠 添加自定义模型</h3>
              <button className="mdl-modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="mdl-modal-body">
              <div className="mdl-field"><label>模型名称</label><input placeholder="MyModel" value={newModel.name} onChange={e => setNewModel(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="mdl-field"><label>描述</label><input placeholder="模型描述..." value={newModel.desc} onChange={e => setNewModel(p => ({ ...p, desc: e.target.value }))} /></div>
              <div className="mdl-field"><label>格式</label>
                <select value={newModel.format} onChange={e => setNewModel(p => ({ ...p, format: e.target.value }))}>
                  <option>BIN</option><option>ONNX</option><option>PyTorch</option><option>其他</option>
                </select>
              </div>
              <div className="mdl-field"><label>部署命令</label><input placeholder="bash download.sh ..." value={newModel.deployCmd} onChange={e => setNewModel(p => ({ ...p, deployCmd: e.target.value }))} /></div>
              <div className="mdl-field"><label>运行命令</label><input placeholder="python3 infer.py ..." value={newModel.runCmd} onChange={e => setNewModel(p => ({ ...p, runCmd: e.target.value }))} /></div>
              <div className="mdl-field"><label>移除命令</label><input placeholder="rm -rf /path/to/model" value={newModel.removeCmd} onChange={e => setNewModel(p => ({ ...p, removeCmd: e.target.value }))} /></div>
              <button className="mdl-btn primary full" onClick={handleAddModel}>添加模型</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
