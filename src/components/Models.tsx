import { useEffect, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, getRememberedDevicePassword } from '../api';

/* ── ModelZoo 模型仓库 ── */

interface ModelItem {
  id: string; name: string; icon: string; desc: string; category: string;
  format: string; size: string; boards: string[];
  deployCmd: string; runCmd: string; removeCmd: string;
  repo: string; deployed: boolean; running: boolean; custom?: boolean;
  fps?: string; latency?: string;
  modelPathPattern?: string; processKey?: string;
}

const BUILTIN_MODELS: ModelItem[] = [
  { id: 'yolov5', name: 'YOLOv5s', icon: '🎯', desc: '高效目标检测模型，支持 80 类物体识别', category: '检测',
    format: 'BIN', size: '14MB', boards: ['RDK X3', 'RDK X5'], fps: '30fps', latency: '33ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/detect/yolov5',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh yolov5s',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/detect/yolov5/yolov5_detect.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/yolov5s*', deployed: false, running: false, modelPathPattern: 'yolov5', processKey: 'yolov5_detect.py' },
  { id: 'fcos', name: 'FCOS', icon: '📦', desc: '无锚框目标检测，适合密集场景', category: '检测',
    format: 'BIN', size: '22MB', boards: ['RDK X3', 'RDK X5'], fps: '25fps', latency: '40ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/detect/fcos',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh fcos',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/detect/fcos/fcos_detect.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/fcos*', deployed: false, running: false, modelPathPattern: 'fcos', processKey: 'fcos_detect.py' },
  { id: 'mobilenetv2', name: 'MobileNetV2', icon: '🏷️', desc: '轻量级图像分类模型', category: '分类',
    format: 'BIN', size: '8MB', boards: ['RDK X3', 'RDK X5', 'RDK Ultra'], fps: '60fps', latency: '16ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/classify/mobilenetv2',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh mobilenetv2',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/classify/mobilenetv2/mobilenetv2_cls.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/mobilenetv2*', deployed: false, running: false, modelPathPattern: 'mobilenetv2', processKey: 'mobilenetv2_cls.py' },
  { id: 'deeplabv3', name: 'DeepLabV3+', icon: '🎨', desc: '语义分割模型，像素级场景理解', category: '分割',
    format: 'BIN', size: '18MB', boards: ['RDK X3', 'RDK X5'], fps: '15fps', latency: '66ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/segment/deeplabv3',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh deeplabv3plus',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/segment/deeplabv3/deeplabv3_seg.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/deeplabv3*', deployed: false, running: false, modelPathPattern: 'deeplab', processKey: 'deeplabv3_seg.py' },
  { id: 'yolov8pose', name: 'YOLOv8-Pose', icon: '🏃', desc: '人体姿态估计，17 关键点检测', category: '姿态',
    format: 'BIN', size: '12MB', boards: ['RDK X5'], fps: '20fps', latency: '50ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/pose/yolov8_pose',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh yolov8_pose',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/pose/yolov8_pose/yolov8_pose.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/yolov8_pose*', deployed: false, running: false, modelPathPattern: 'yolov8_pose', processKey: 'yolov8_pose.py' },
  { id: 'whisper', name: 'Whisper-tiny', icon: '🎙️', desc: '语音识别模型，支持中英文', category: '语音',
    format: 'ONNX', size: '39MB', boards: ['RDK X5', 'RDK Ultra'], fps: '--', latency: '200ms',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh whisper_tiny',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/audio/whisper/whisper_asr.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/whisper*', deployed: false, running: false, modelPathPattern: 'whisper', processKey: 'whisper_asr.py' },
];

const CATEGORIES = ['全部', '检测', '分类', '分割', '姿态', '语音', '自定义'];

export default function Models() {
  const { currentDevice, addToast, setActiveTab, setChatExpanded, setCmd } = useAppState();
  const [models, setModels] = useState<ModelItem[]>(BUILTIN_MODELS);
  const [filter, setFilter] = useState('全部');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newModel, setNewModel] = useState({ name: '', desc: '', format: 'BIN', deployCmd: '', runCmd: '', removeCmd: '' });

  const pushToMainChat = (text: string) => {
    setActiveTab('dashboard');
    setChatExpanded(true);
    setCmd(text);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const form = document.querySelector('.input-box') as HTMLFormElement | null;
        form?.requestSubmit();
      });
    });
  };

  const writeEcosystemSnapshot = (nextModels: ModelItem[]) => {
    const deployed = nextModels.filter((m) => m.deployed).map((m) => m.name);
    const running = nextModels.filter((m) => m.running).map((m) => m.name);
    const current = JSON.parse(localStorage.getItem('rdk-ecosystem-sync') || '{}') as Record<string, unknown>;
    const payload = {
      ...current,
      modelzoo: {
        deployed,
        running,
        deviceIp: currentDevice?.ip,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem('rdk-ecosystem-sync', JSON.stringify(payload));
  };

  const syncFromBoard = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    setBusyId('sync-board');
    try {
      const pwd = getRememberedDevicePassword(currentDevice.id);
      const cmd = 'bash -lc "ls -1 /opt/rdk_model_zoo/models 2>/dev/null || true; echo __PROC__; ps -ef | grep -E \'yolov5_detect.py|fcos_detect.py|mobilenetv2_cls.py|deeplabv3_seg.py|yolov8_pose.py|whisper_asr.py\' | grep -v grep || true"';
      const result = await executeDeviceCommand(currentDevice.id, cmd, pwd);
      const output = result.output || '';
      setLogs((prev) => [...prev.slice(-60), `[板端同步] ${new Date().toLocaleTimeString()}`, output, '']);
      setShowLog(true);

      const [modelPart, procPart = ''] = output.split('__PROC__');
      const modelText = modelPart.toLowerCase();
      const nextModels = models.map((model) => {
        if (model.custom) return model;
        const deployed = model.modelPathPattern ? modelText.includes(model.modelPathPattern.toLowerCase()) : model.deployed;
        const running = model.processKey ? new RegExp(model.processKey, 'i').test(procPart) : false;
        return { ...model, deployed, running };
      });

      setModels(nextModels);
      writeEcosystemSnapshot(nextModels);
      addToast('ModelZoo 板端状态同步完成', 'success');
    } catch {
      addToast('ModelZoo 板端同步失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleOfficialReadyCheck = async () => {
    await exec(
      'rdk-modelzoo-ready',
      'cat /etc/os-release 2>/dev/null | head -6; echo "---"; python3 --version; echo "---"; pip3 show bpu_infer_lib_x5 2>/dev/null || pip3 show bpu_infer_lib_x3 2>/dev/null || echo BPU_INFER_LIB_NOT_FOUND; echo "---"; test -d /opt/rdk_model_zoo && echo MODELZOO_DIR_READY || echo MODELZOO_DIR_MISSING; echo "---"; command -v hrt_model_exec >/dev/null 2>&1 && echo HRT_MODEL_EXEC_READY || echo HRT_MODEL_EXEC_MISSING',
      '官方环境检查',
    );
  };

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
    if (out !== null) {
      setModels((prev) => {
        const next = prev.map((x) => x.id === m.id ? { ...x, deployed: true } : x);
        writeEcosystemSnapshot(next);
        return next;
      });
      addToast(`${m.name} 部署完成`, 'success');
    }
  };

  const handleRun = async (m: ModelItem) => {
    addToast(`正在运行 ${m.name}...`, 'info');
    const out = await exec(m.id, m.runCmd, `运行 ${m.name}`);
    if (out !== null) {
      setModels((prev) => {
        const next = prev.map((x) => x.id === m.id ? { ...x, running: true } : x);
        writeEcosystemSnapshot(next);
        return next;
      });
      addToast(`${m.name} 已启动`, 'success');
    }
  };

  const handleStop = async (m: ModelItem) => {
    await exec(m.id, `pkill -f "${m.name.toLowerCase()}" || true`, `停止 ${m.name}`);
    setModels((prev) => {
      const next = prev.map((x) => x.id === m.id ? { ...x, running: false } : x);
      writeEcosystemSnapshot(next);
      return next;
    });
    addToast(`${m.name} 已停止`, 'info');
  };

  const handleRemove = async (m: ModelItem) => {
    if (!confirm(`确定移除 ${m.name}？`)) return;
    const out = await exec(m.id, m.removeCmd, `移除 ${m.name}`);
    if (out !== null) {
      setModels((prev) => {
        const next = prev.map((x) => x.id === m.id ? { ...x, deployed: false, running: false } : x);
        writeEcosystemSnapshot(next);
        return next;
      });
      addToast(`${m.name} 已移除`, 'info');
    }
  };

  const handleRemoveCustom = (id: string) => { setModels(p => p.filter(m => m.id !== id)); addToast('已删除', 'info'); };

  const handleAddModel = () => {
    if (!newModel.name || !newModel.deployCmd) { addToast('请填写名称和部署命令', 'warning'); return; }
    setModels(p => [...p, { id: `custom-${Date.now()}`, icon: '🧠', category: '自定义', size: '--', boards: [], repo: '', deployed: false, running: false, custom: true, ...newModel, removeCmd: newModel.removeCmd || `echo "请手动移除"` }]);
    setNewModel({ name: '', desc: '', format: 'BIN', deployCmd: '', runCmd: '', removeCmd: '' });
    setShowAdd(false);
    addToast('模型已添加', 'success');
  };

  useEffect(() => {
    if (currentDevice) {
      syncFromBoard();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  /* ── 未连接设备 ── */
  if (!currentDevice) {
    return (
      <div className="tool-page">
        <div className="empty-state">
          <div className="empty-state-icon">
            <span>🧠</span>
          </div>
          <h2 className="empty-state-title">ModelZoo · 模型仓库</h2>
          <p className="empty-state-desc">RDK 模型仓库 · BPU 加速推理，一键部署运行 AI 模型到开发板</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <span className="badge badge-muted">❶ 连接 RDK 开发板</span>
            <span className="badge badge-muted">❷ 选择模型并一键部署</span>
            <span className="badge badge-muted">❸ 运行推理，查看效果</span>
          </div>
          <a href="https://github.com/D-Robotics/rdk_model_zoo" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            访问 ModelZoo GitHub ↗
          </a>
        </div>
      </div>
    );
  }

  /* ── 主页面 ── */
  return (
    <div className="tool-page">
      {/* 顶部状态栏 */}
      <div className="tool-bar">
        <div className="tool-bar-left">
          <span className="tool-card-icon">🧠</span>
          <span className="tool-bar-title">ModelZoo</span>
          <span className="badge badge-muted">{models.length} 模型</span>
        </div>
        <div className="tool-bar-right">
          <div className="tool-stats">
            <span className="tool-stat-chip"><span className="num">{deployedCount}</span>已部署</span>
            <span className="tool-stat-chip live"><span className="num">{runningCount}</span>运行中</span>
          </div>
          <button className="btn btn-ghost" onClick={syncFromBoard} disabled={busyId === 'sync-board'}>
            {busyId === 'sync-board' ? '同步中...' : '板端同步'}
          </button>
          <button className="btn btn-ghost" onClick={handleOfficialReadyCheck} disabled={!!busyId}>官方环境检查</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ 添加模型</button>
        </div>
      </div>

      <div className="tool-content">
        {/* 设备信息条 */}
        <div className="tool-stats" style={{ flexWrap: 'wrap', paddingBottom: 8 }}>
          <span className="tool-stat-chip">设备 <span className="num">{currentDevice.name}</span></span>
          <span className="tool-stat-chip">IP <span className="num mono">{currentDevice.ip}</span></span>
          <span className="tool-stat-chip"><span className="num">{deployedCount}</span> 已部署</span>
          <span className="tool-stat-chip live"><span className="num">{runningCount}</span> 运行中</span>
        </div>

        {/* 筛选栏 */}
        <div className="tool-filter">
          {CATEGORIES.map(c => (
            <button key={c} className={`tool-filter-btn ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>{c}</button>
          ))}
          <input className="input tool-bar-search" placeholder="搜索模型..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginLeft: 'auto' }} />
        </div>

        {/* 模型卡片网格 */}
        <div className="tool-grid">
          {filtered.length === 0 && <p className="empty-state-desc">没有匹配的模型</p>}
          {filtered.map(m => (
            <div key={m.id} className={`tool-card ${m.running ? 'running' : m.deployed ? 'installed' : ''}`}>
              <div className="tool-card-head">
                <span className="tool-card-icon">{m.icon}</span>
                <div className="tool-card-info">
                  <span className="tool-card-name">{m.name}</span>
                  <span className="tool-card-meta"><span className="badge badge-muted">{m.category}</span> · {m.format} · {m.size}</span>
                </div>
                {m.running && <span className="badge badge-ok"><span className="status-dot online" />运行中</span>}
                {m.deployed && !m.running && <span className="badge badge-accent">已部署</span>}
              </div>
              <p className="tool-card-desc">{m.desc}</p>
              {(m.fps || m.latency) && (
                <div className="tool-card-perf">
                  {m.fps && <span>⚡ {m.fps}</span>}
                  {m.latency && <span>⏱ {m.latency}</span>}
                </div>
              )}
              {m.boards.length > 0 && (
                <div className="tool-card-boards">
                  {m.boards.map(b => <span key={b} className="tool-board-chip">{b}</span>)}
                </div>
              )}
              <div className="tool-card-actions">
                {!m.deployed && (
                  <button className="btn btn-primary" disabled={busyId === m.id} onClick={() => handleDeploy(m)}>
                    {busyId === m.id ? '部署中...' : '部署'}
                  </button>
                )}
                {m.deployed && !m.running && (
                  <button className="btn btn-primary" disabled={busyId === m.id} onClick={() => handleRun(m)}>▶ 运行</button>
                )}
                {m.running && (
                  <button className="btn btn-danger" onClick={() => handleStop(m)}>⏹ 停止</button>
                )}
                {m.deployed && (
                  <button className="btn btn-ghost" onClick={() => handleRemove(m)}>移除</button>
                )}
                {m.custom && (
                  <button className="btn btn-ghost" onClick={() => handleRemoveCustom(m.id)}>删除</button>
                )}
                {m.repo && (
                  <a href={m.repo} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">详情 ↗</a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 日志面板 */}
      {showLog && logs.length > 0 && (
        <div className="tool-log">
          <div className="tool-log-head">
            <span>📋 执行日志</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setLogs([])}>清空</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowLog(false)}>收起</button>
            </div>
          </div>
          <pre className="tool-log-body">{logs.join('\n')}</pre>
        </div>
      )}

      {/* 添加模型弹窗 */}
      {showAdd && (
        <>
          <div className="modal-overlay" onClick={() => setShowAdd(false)} />
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">🧠 添加自定义模型</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="modal-body tool-add-modal">
              <div className="tool-add-field"><label>模型名称</label><input className="input" placeholder="MyModel" value={newModel.name} onChange={e => setNewModel(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="tool-add-field"><label>描述</label><input className="input" placeholder="模型描述..." value={newModel.desc} onChange={e => setNewModel(p => ({ ...p, desc: e.target.value }))} /></div>
              <div className="tool-add-field"><label>格式</label>
                <select className="select" aria-label="模型格式" value={newModel.format} onChange={e => setNewModel(p => ({ ...p, format: e.target.value }))}>
                  <option>BIN</option><option>ONNX</option><option>PyTorch</option><option>其他</option>
                </select>
              </div>
              <div className="tool-add-field"><label>部署命令</label><input className="input" placeholder="bash download.sh ..." value={newModel.deployCmd} onChange={e => setNewModel(p => ({ ...p, deployCmd: e.target.value }))} /></div>
              <div className="tool-add-field"><label>运行命令</label><input className="input" placeholder="python3 infer.py ..." value={newModel.runCmd} onChange={e => setNewModel(p => ({ ...p, runCmd: e.target.value }))} /></div>
              <div className="tool-add-field"><label>移除命令</label><input className="input" placeholder="rm -rf /path/to/model" value={newModel.removeCmd} onChange={e => setNewModel(p => ({ ...p, removeCmd: e.target.value }))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleAddModel}>添加模型</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
