import { useAppState } from '../hooks/useAppState';
import { LOCAL_FILES, REMOTE_FILES } from '../constants';

export default function Files() {
  const { currentDevice, transferQueue, appendTransferTask, addToast } = useAppState();

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

        <div className="file-status-strip">
          <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
            <span className="card-status-dot"></span>SFTP
          </span>
          <span className="file-status-text">root@{currentDevice?.ip}:/userdata</span>
          {transferQueue.filter(t => t.status !== 'done').length > 0 && (
            <span className="file-status-text">{transferQueue.filter(t => t.status !== 'done').length} 项传输中</span>
          )}
        </div>

        <div className="workspace-grid two-column">
          <div className="panel-card file-pane">
            <div className="panel-title">📂 本地工作区</div>
            {LOCAL_FILES.map((file) => (
              <div key={file} className="file-row clickable">{file.endsWith('/') ? '📁' : '📄'} {file}</div>
            ))}
            <button className="clean-btn outline-btn sm-btn" style={{ marginTop: 10 }} onClick={() => appendTransferTask()}>上传所选 →</button>
          </div>
          <div className="panel-card file-pane">
            <div className="panel-title">🛰️ 远程 ({currentDevice?.ip})</div>
            {REMOTE_FILES.map((file) => (
              <div key={file} className="file-row clickable">{file.endsWith('/') ? '📁' : '📄'} {file}</div>
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
      </div>
    </div>
  );
}
