import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import WifiConfigModal from './wifi/WifiConfigModal';

export default function TopToolbar() {
  const { activeTab, currentDevice } = useAppState();
  const [copied, setCopied] = useState(false);
  const [showWifiModal, setShowWifiModal] = useState(false);

  const titles: Record<string, string> = {
    dashboard: 'AI Copilot 工作台',
    flasher: '系统镜像工具',
    terminal: '终端环境',
    files: '文件管理器 (SFTP)',
    vnc: '可视化桌面 (VNC)',
    ide: '代码编辑 · VS Code',
    openclaw: 'OpenClaw 网关配置',
    hardware: '硬件监控工作台',
    examples: '示例应用目录',
    ros: 'ROS2 可视化',
    models: '模型仓库与部署',
  };

  const handleCopyIp = () => {
    if (currentDevice?.ip) {
      navigator.clipboard.writeText(currentDevice.ip);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <div className="top-toolbar">
        
        <div className="tt-center">
          <span className="tt-title">{titles[activeTab] || activeTab}</span>
          <span className="tt-sep">/</span>
          <span className={`status-dot ${currentDevice?.status === 'offline' ? 'offline' : ''}`} />
          <span className="tt-device" title="点击复制IP" onClick={handleCopyIp} style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', background: 'rgba(0,0,0,0.05)', marginLeft: '4px' }}>
            {currentDevice?.name} ({currentDevice?.ip}) 
  <span className="material-symbols-outlined" style={{ fontSize: '14px', marginLeft: '4px' }}>
    {copied ? 'check' : 'content_copy'}
  </span>

          </span>
          <span className="tt-wifi" title="配置 WiFi" style={{ marginLeft: '8px', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', background: 'rgba(255,107,0,0.1)', color: '#ff6b00', display: 'flex', alignItems: 'center' }} onClick={() => setShowWifiModal(true)}>
            📶
          </span>
        </div>
        <div className="toolbar-actions">
          
  <button className="icon-btn" title="查看用户/许可证">
    <span className="material-symbols-outlined">person</span>
  </button>

        </div>
      </div>
      {showWifiModal && <WifiConfigModal onClose={() => setShowWifiModal(false)} />}
    </>
  );
}
