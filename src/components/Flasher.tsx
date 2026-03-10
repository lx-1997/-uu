import { useAppState } from '../hooks/useAppState';
import { FLASH_IMAGES, STORAGE_TARGETS } from '../constants';

export default function Flasher() {
  const {
    currentDevice, flashImage, setFlashImage, flashTarget, setFlashTarget,
    flashMode, setFlashMode, flashVerify, setFlashVerify, flashBackup, setFlashBackup,
    flashProgress, flashPhase, isFlashing, flashStep, setFlashStep, startFlash,
    setActiveTab, addToast,
  } = useAppState();

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">💽 智能烧录 (Target: {currentDevice?.name})</div>
        <div className="desc-text">AI 推荐最佳镜像 · 四步完成系统烧录。</div>

        <div className="ai-recommend-strip">
          <span className="ai-suggest-label">🤖 AI 推荐</span>
          <span className="ai-recommend-text">检测到 {currentDevice?.name}，推荐使用 <strong>ROS2 Humble 预装版</strong>（含 TogetherROS.b 与 BPU 工具链）</span>
          <button className="clean-btn outline-btn sm-btn" onClick={() => { setFlashImage('ros2-humble'); addToast('已切换到 AI 推荐镜像', 'success'); }}>采纳</button>
        </div>

        <div className="stepper-row">
          {['镜像选择', '介质确认', '写入策略', '交付完成'].map((label, index) => (
            <div key={label} className={`step-chip ${flashStep >= index + 1 ? 'active' : ''}`}>
              <span>{index + 1}</span>
              {label}
            </div>
          ))}
        </div>

        <div className="workspace-grid two-column">
          <div className="panel-card">
            <div className="panel-title">镜像与目标</div>
            <div className="option-list">
              {FLASH_IMAGES.map((image) => (
                <button key={image.id} className={`select-card ${flashImage === image.id ? 'active' : ''}`} onClick={() => setFlashImage(image.id)}>
                  <strong>{image.label}</strong>
                  <span>{image.detail}</span>
                </button>
              ))}
            </div>
            <div className="field-grid">
              {STORAGE_TARGETS.map((target) => (
                <button key={target.id} className={`select-card compact ${flashTarget === target.id ? 'active' : ''}`} onClick={() => setFlashTarget(target.id)}>
                  <strong>{target.label} <span className="muted-inline">{target.path}</span></strong>
                  <span>{target.safe}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">写入策略与风险兜底</div>
            <div className="segmented-row">
              {([['safe', '安全模式'], ['fast', '极速模式'], ['recover', '恢复模式']] as const).map(([mode, label]) => (
                <button key={mode} className={`segment-btn ${flashMode === mode ? 'active' : ''}`} onClick={() => setFlashMode(mode)}>{label}</button>
              ))}
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={flashVerify} onChange={(e) => setFlashVerify(e.target.checked)} />
              <span>写入后自动校验镜像完整性与启动扇区</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={flashBackup} onChange={(e) => setFlashBackup(e.target.checked)} />
              <span>保留当前引导分区快照，便于失败时回滚</span>
            </label>
            <div className="warning-banner">
              {flashTarget === 'emmc' ? '当前目标为 eMMC，默认启用双重确认并隐藏系统盘。' : '当前目标可安全替换，适合开发阶段快速迭代。'}
            </div>
            <div className="progress-box">
              <div className="progress-meta"><span>{flashPhase}</span><strong>{flashProgress}%</strong></div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${flashProgress}%` }}></div></div>
            </div>
            <div className="action-row">
              <button className="clean-btn" onClick={startFlash}>{isFlashing ? '重新开始流程' : '开始烧录'}</button>
              <button className="clean-btn outline-btn" onClick={() => setFlashStep(1)}>重置步骤</button>
            </div>
          </div>
        </div>

        <div className="workspace-grid two-column lower-grid">
          <div className="panel-card">
            <div className="panel-title">过程反馈</div>
            <div className="timeline-list">
              {['扫描镜像元信息与校验码', '检测目标介质容量、分区表与设备类型', '写入引导分区、系统分区与配置覆盖层', '生成可分享的烧录结果摘要与首次启动建议'].map((item, index) => (
                <div key={item} className={`timeline-item ${flashStep >= index + 1 ? 'active' : ''}`}>
                  <span className="timeline-dot"></span>
                  <div>{item}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel-card">
            <div className="panel-title">烧录完成后</div>
            <div className="usage-list">
              <div className="usage-item">首次启动引导配置网络与 SSH。</div>
              <div className="usage-item">可跳转到终端、文件管理或示例应用。</div>
            </div>
            {flashProgress >= 100 && !isFlashing && (
              <div className="action-row" style={{ marginTop: '16px' }}>
                <button className="clean-btn" onClick={() => { setActiveTab('terminal'); addToast('已跳转到终端，可开始配置设备', 'info'); }}>💻 打开终端</button>
                <button className="clean-btn outline-btn" onClick={() => { setActiveTab('files'); addToast('已跳转到文件管理器', 'info'); }}>📁 文件管理</button>
                <button className="clean-btn outline-btn" onClick={() => { setActiveTab('examples'); addToast('已跳转到示例应用', 'info'); }}>📦 示例应用</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
