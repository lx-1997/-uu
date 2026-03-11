import { useState, useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';

type ServiceStatus = 'checking' | 'not-installed' | 'installed-stopped' | 'running';

export default function IDE() {
  const { currentDevice, addToast, setActiveTab } = useAppState();
  const [connected, setConnected] = useState(false);
  const [port, setPort] = useState('8080');
  const [status, setStatus] = useState<ServiceStatus>('checking');
  const codeServerUrl = `http://${currentDevice?.ip || 'localhost'}:${port}/?folder=/root`;

  // Simulate auto-detection of code-server service status
  useEffect(() => {
    setStatus('checking');
    const timer = setTimeout(() => {
      // Mock: randomly pick a status for demo purposes
      // In real implementation, this would call the backend API to check
      const mockStatuses: ServiceStatus[] = ['running', 'installed-stopped', 'not-installed'];
      setStatus(mockStatuses[Math.floor(Math.random() * mockStatuses.length)]);
    }, 1200);
    return () => clearTimeout(timer);
  }, [currentDevice?.ip]);

  const handleConnect = () => {
    if (status === 'running') {
      setConnected(true);
    } else if (status === 'installed-stopped') {
      addToast('正在启动 code-server 服务...', 'info');
      setStatus('checking');
      setTimeout(() => {
        setStatus('running');
        addToast('code-server 已启动', 'success');
      }, 1500);
    }
  };

  const handleInstall = () => {
    addToast('正在安装 code-server，请稍候...', 'info');
    setStatus('checking');
    setTimeout(() => {
      setStatus('installed-stopped');
      addToast('code-server 安装完成！点击启动即可使用', 'success');
    }, 3000);
  };

  return (
    <div className={connected ? 'ide-fullscreen' : 'center-stage wide-stage'}>
      {!connected ? (
        <div className="isolated-widget workflow-widget">
          <div className="widget-header">📝 代码编辑器 · code-server</div>
          <div className="desc-text">在浏览器中使用 VS Code，直接在设备上编写和调试代码。AI 通过底部聊天框辅助开发。</div>

          {/* Service status card */}
          <div className="panel-card" style={{ marginBottom: 16, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: '1.2rem' }}>
                {status === 'checking' ? '⏳' : status === 'running' ? '✅' : status === 'installed-stopped' ? '⏸️' : '📦'}
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {status === 'checking' && '正在检测 code-server 服务...'}
                  {status === 'running' && 'code-server 已就绪'}
                  {status === 'installed-stopped' && 'code-server 已安装，未启动'}
                  {status === 'not-installed' && 'code-server 尚未安装'}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
                  {status === 'checking' && `正在检测 ${currentDevice?.ip || 'localhost'}:${port} ...`}
                  {status === 'running' && `服务运行在 ${currentDevice?.ip || 'localhost'}:${port}，点击打开编辑器`}
                  {status === 'installed-stopped' && '点击启动服务后即可连接编辑器'}
                  {status === 'not-installed' && '需要在设备上安装 code-server，安装后即可使用浏览器编码'}
                </div>
              </div>
            </div>

            {status === 'checking' && (
              <div style={{ height: 36, borderRadius: 8, background: '#f1f5f9', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '60%', background: 'linear-gradient(90deg, #f1f5f9, #e2e8f0, #f1f5f9)', animation: 'shimmer 1.5s infinite' }} />
              </div>
            )}

            {status === 'running' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="clean-btn" style={{ flex: 1 }} onClick={handleConnect}>
                  ▶ 打开编辑器
                </button>
                <button className="clean-btn outline-btn" onClick={() => window.open(codeServerUrl, '_blank')}>
                  ↗ 新窗口
                </button>
              </div>
            )}

            {status === 'installed-stopped' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="clean-btn" style={{ flex: 1 }} onClick={handleConnect}>
                  ▶ 启动服务并连接
                </button>
              </div>
            )}

            {status === 'not-installed' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="clean-btn" style={{ width: '100%' }} onClick={handleInstall}>
                  📥 一键安装 code-server
                </button>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', textAlign: 'center' }}>
                  将在设备上执行: <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>curl -fsSL https://code-server.dev/install.sh | sh</code>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap' }}>端口:</span>
              <input
                className="clean-input"
                style={{ width: 72, fontSize: '0.82rem', textAlign: 'center' }}
                value={port}
                onChange={e => setPort(e.target.value.replace(/\D/g, ''))}
              />
              <button className="clean-btn outline-btn sm-btn" onClick={() => { setStatus('checking'); setTimeout(() => setStatus('running'), 1200); }}>
                🔄 重新检测
              </button>
            </div>
          </div>

          {/* AI assist info */}
          <div className="workspace-grid two-column">
            <div className="panel-card">
              <div className="panel-title">AI 如何协助开发？</div>
              <div className="usage-list">
                <div className="usage-item">
                  <strong>🤖 自然语言编程</strong>
                  <span>在底部聊天框描述需求，AI 自动生成代码并写入设备文件</span>
                </div>
                <div className="usage-item">
                  <strong>🐛 调试诊断</strong>
                  <span>遇到错误时粘贴日志，AI 分析原因并建议修复</span>
                </div>
                <div className="usage-item">
                  <strong>📦 依赖管理</strong>
                  <span>"帮我安装 opencv-python" → AI 在终端自动执行</span>
                </div>
                <div className="usage-item">
                  <strong>🔧 ROS 开发</strong>
                  <span>"创建一个人脸检测的 ROS 节点" → AI 生成完整 launch 文件与代码</span>
                </div>
              </div>
            </div>
            <div className="panel-card">
              <div className="panel-title">连接后你可以</div>
              <div className="usage-list">
                <div className="usage-item">
                  <strong>📂 浏览设备文件</strong>
                  <span>默认打开 /root 目录，直接编辑设备上的文件</span>
                </div>
                <div className="usage-item">
                  <strong>🔌 安装扩展</strong>
                  <span>Python、C++、ROS 扩展一键安装，和本地 VS Code 一样</span>
                </div>
                <div className="usage-item">
                  <strong>▶ 内置终端</strong>
                  <span>code-server 内置终端已自动连接 SSH，可直接运行命令</span>
                </div>
                <div className="usage-item">
                  <strong>🔗 Git 集成</strong>
                  <span>版本管理、代码对比、提交推送全部在浏览器中完成</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="chip-btn" onClick={() => setActiveTab('terminal')}>💻 终端</button>
                <button className="chip-btn" onClick={() => setActiveTab('files')}>📂 文件管理</button>
                <button className="chip-btn" onClick={() => setActiveTab('examples')}>📦 应用示例</button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
            <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6 }}>
              💡 OpenClaw 支持通过自然语言直接操控设备和编写程序。如果你不想手动编码，可以在底部聊天框用自然语言描述你要实现的功能，AI 会自动完成代码编写、文件创建和运行。
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, padding: '8px 12px', alignItems: 'center', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
            <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
              <span className="card-status-dot"></span>已连接
            </span>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{codeServerUrl}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="clean-btn outline-btn sm-btn" onClick={() => window.open(codeServerUrl, '_blank')}>↗ 新窗口</button>
              <button className="clean-btn outline-btn sm-btn" onClick={() => setConnected(false)}>✕ 断开</button>
            </div>
          </div>
          <iframe
            src={codeServerUrl}
            style={{ width: '100%', flex: 1, border: 'none' }}
            title="code-server"
          />
        </>
      )}
    </div>
  );
}
