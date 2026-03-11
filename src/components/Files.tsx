import { useAppState } from '../hooks/useAppState';
import { LOCAL_FILES, REMOTE_FILES } from '../constants';

export default function Files() {
  const { currentDevice, transferQueue, appendTransferTask, addToast, setActiveTab } = useAppState();

  const completedCount = transferQueue.filter(t => t.status === 'done').length;
  const runningCount = transferQueue.filter(t => t.status !== 'done').length;

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📁 智能文件桥</div>
        <div className="desc-text">AI 驱动的文件管理 — 支持自然语言指令、拖拽传输。</div>

        <div className="ai-file-bar">
          <div className="ai-file-input-wrap">
            <span className="ai-file-icon">🤖</span>
            <input className="clean-input ai-file-input" placeholder='试试: "把 models/ 下模型上传到设备" 或 "同步远程日志到本地"' />
          </div>
          <button className="clean-btn" onClick={() => addToast('AI 正在解析文件操作指令...', 'info')}>执行</button>
        </div>

        {/* AI 智能操作建议 - 新增 */}
        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 建议</span>
          <span className="ai-recommend-text">
            检测到远程 <strong>logs/</strong> 目录有新日志 ·
            <strong>models/</strong> 下有未同步的模型文件 ·
            建议:
          </span>
          <button className="clean-btn outline-btn sm-btn" style={{ marginLeft: 8, fontSize: '0.75rem' }} onClick={() => { appendTransferTask(); addToast('AI 自动同步: 下载最新远程日志', 'info'); }}>
            📥 同步日志
          </button>
          <button className="clean-btn outline-btn sm-btn" style={{ fontSize: '0.75rem' }} onClick={() => { appendTransferTask(); addToast('AI 自动同步: 上传本地模型', 'info'); }}>
            📤 同步模型
          </button>
        </div>

        <div className="file-status-strip">
          <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
            <span className="card-status-dot"></span>SFTP
          </span>
          <span className="file-status-text">root@{currentDevice?.ip}:/userdata</span>
          {runningCount > 0 && (
            <span className="file-status-text">{runningCount} 项传输中</span>
          )}
          {completedCount > 0 && (
            <span className="file-status-text" style={{ color: '#16a34a' }}>✅ {completedCount} 项已完成</span>
          )}
        </div>

        <div className="workspace-grid two-column">
          <div className="panel-card file-pane">
            <div className="panel-title">📂 本地工作区</div>
            {LOCAL_FILES.map((file) => (
              <div key={file} className="file-row clickable">
                {file.endsWith('/') ? '📁' : '📄'} {file}
                {/* AI 文件注释 - 新增 */}
                {file === 'models/' && <span style={{ fontSize: '0.68rem', color: '#f59e0b', marginLeft: 8 }}>· 2个待上传</span>}
                {file === 'launch.py' && <span style={{ fontSize: '0.68rem', color: '#94a3b8', marginLeft: 8 }}>· 启动脚本</span>}
              </div>
            ))}
            <button className="clean-btn outline-btn sm-btn" style={{ marginTop: 10 }} onClick={() => appendTransferTask()}>上传所选 →</button>
          </div>
          <div className="panel-card file-pane">
            <div className="panel-title">🛰️ 远程 ({currentDevice?.ip})</div>
            {REMOTE_FILES.map((file) => (
              <div key={file} className="file-row clickable">
                {file.endsWith('/') ? '📁' : '📄'} {file}
                {/* AI 文件注释 - 新增 */}
                {file === 'logs/' && <span style={{ fontSize: '0.68rem', color: '#3b82f6', marginLeft: 8 }}>· 有新内容</span>}
                {file === 'claw_pipeline.yaml' && <span style={{ fontSize: '0.68rem', color: '#94a3b8', marginLeft: 8 }}>· OpenClaws 配置</span>}
              </div>
            ))}
            <button className="clean-btn outline-btn sm-btn" style={{ marginTop: 10 }} onClick={() => appendTransferTask()}>← 下载所选</button>
          </div>
        </div>

        {transferQueue.length > 0 && (
          <div className="transfer-strip">
            <div className="panel-title">传输队列 ({transferQueue.length})</div>
            {transferQueue.map((item) => (
              <div key={item.id} className="transfer-item">
                <div className="transfer-item-head">
                  <span className="transfer-item-name">{item.direction === '上传' ? '⬆' : '⬇'} {item.name}</span>
                  <span className="transfer-item-status">{item.status === 'done' ? '✅ 完成' : `${item.progress}%`}</span>
                </div>
                <div className="progress-track thin">
                  <div className="progress-fill" style={{ width: `${item.progress}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AI 快捷工作流 - 新增 */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="chip-btn" onClick={() => addToast('AI 正在同步所有模型文件到设备...', 'info')}>🤖 AI 一键同步模型</button>
          <button className="chip-btn" onClick={() => addToast('AI 正在下载并打包远程日志...', 'info')}>📋 下载全部日志</button>
          <button className="chip-btn" onClick={() => addToast('AI 正在备份远程配置文件...', 'info')}>💾 备份远程配置</button>
          <button className="chip-btn" onClick={() => { setActiveTab('terminal'); addToast('已跳转到终端，可用 scp/rsync 手动操作', 'info'); }}>🖥️ 终端手动操作</button>
        </div>
      </div>
    </div>
  );
}
