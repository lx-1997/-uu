import React, { useState } from 'react';
import './styles.css';

// Mock Multi-Device Data
const MOCK_DEVICES = [
  { id: '1', name: 'RDK X3 - Local', status: 'online', ip: '192.168.1.100' },
  { id: '2', name: 'RDK Ultra - Lab', status: 'offline', ip: '192.168.1.105' },
];

export default function App() {
  const [activeDevice, setActiveDevice] = useState(MOCK_DEVICES[0].id);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'flasher', 'terminal', 'settings'
  const [cmd, setCmd] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');

  // Handle AI Command (Contextual)
  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    
    setIsLoading(true);
    setLoadingMsg('AI 正在介入分析需求...');

    setTimeout(() => {
      const lowerCmd = cmd.toLowerCase();
      if (lowerCmd.includes('烧录') || lowerCmd.includes('镜像') || lowerCmd.includes('flash')) {
        setActiveTab('flasher');
      } else if (lowerCmd.includes('终端') || lowerCmd.includes('terminal') || lowerCmd.includes('ssh')) {
        setActiveTab('terminal');
      } else if (lowerCmd.includes('设备') || lowerCmd.includes('连接')) {
         // No longer suddenly jumps to "flash". Now just highlights device manager conceptually.
         alert('已选中设备管理上下文。AI 可以协助您扫描局域网中的 RDK 设备。');
      } else {
        setActiveTab('dashboard');
      }
      setIsLoading(false);
      setCmd('');
    }, 800);
  };

  const currentDevice = MOCK_DEVICES.find(d => d.id === activeDevice);

  // Center render logic
  const renderMainContent = () => {
    if (isLoading) {
      return (
        <div className="center-stage" style={{ justifyContent: 'center', height: '100%', paddingBottom: '100px' }}>
          <div className="loading-stage">
            <div className="spinner"></div>
            <div>{loadingMsg}</div>
          </div>
        </div>
      );
    }

    if (activeTab === 'flasher') {
      return (
        <div className="center-stage">
          <div className="isolated-widget">
             <div className="widget-header">💽 镜像烧录工具 (Target: {currentDevice?.name})</div>
             <div className="desc-text">在这里进行隔离的镜像烧录工作流。此操作不会受到设备连接或终端状态的影响。</div>
             
             <div className="form-group">
                <label>选择镜像源</label>
                <select className="clean-input" defaultValue="ubuntu-22.04">
                   <option value="ubuntu-22.04">Ubuntu 22.04 LTS (官方推荐)</option>
                   <option value="ros2-humble">ROS2 Humble 预装版</option>
                   <option value="local">浏览本地文件...</option>
                </select>
             </div>
             <div className="form-group">
                <label>目标存储</label>
                <select className="clean-input" defaultValue="sd">
                   <option value="sd">SD Card ( /dev/mmcblk0 )</option>
                   <option value="emmc">eMMC ( /dev/mmcblk1 )</option>
                </select>
             </div>
             
             <button className="clean-btn" style={{ width: '100%', marginTop: '10px' }}>开始烧录</button>
          </div>
        </div>
      );
    }

    if (activeTab === 'terminal') {
      return (
        <div className="center-stage" style={{maxWidth: '90%'}}>
           <div className="isolated-widget" style={{fontFamily: 'monospace', background: '#000'}}>
             <div className="widget-header" style={{fontSize: '1rem', borderBottom: '1px solid #333', color: '#0f0'}}>
                🟢 root@{currentDevice?.ip} ~
             </div>
             <div style={{color: '#aaa', marginTop: '10px', minHeight: '300px'}}>
               Welcome to RDK OS.<br/>
               Linux rdk 5.10.x aarch64<br/><br/>
               root@rdk:~# <span style={{display:'inline-block', width: '8px', height: '15px', background: '#aaa', animation: 'blink 1s infinite'}}></span>
             </div>
           </div>
        </div>
      );
    }

    // Default: Dashboard
    return (
      <div className="center-stage">
        <h2 className="hero-title">{currentDevice?.name || 'RDK Studio'}</h2>
        <div className="hero-subtitle">管理、控制与扩展您的计算节点</div>

        <div className="quick-grid">
          <div className="startup-card" onClick={() => alert('触发环境检查...')}>
            <h3>🏥 硬件诊断</h3>
            <p>检查 NPU、CPU 及外设接口状态，定位可能的问题。</p>
          </div>
          <div className="startup-card" onClick={() => setActiveTab('flasher')}>
            <h3>💽 固件与烧录</h3>
            <p>通过独立工作流将最新 OS 或定制镜像刷写至设备中。</p>
          </div>
          <div className="startup-card" onClick={() => setActiveTab('terminal')}>
            <h3>⚙️ 远程终端</h3>
            <p>免密码通过内置 WebSocket 服务直接 SSH 进设备 Shell。</p>
          </div>
          <div className="startup-card" onClick={() => alert('载入 OpenClaw...')}>
            <h3>🤖 机械臂控制 (OpenClaw)</h3>
            <p>加载硬件抽象层，对机械臂进行运动学调试。</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="canvas-shell">
      <div className="layout-container">
        
        {/* Left Sidebar - Device Manager */}
        <div className="app-sidebar">
          <div className="sidebar-brand">RDK Studio</div>
          
          <div className="section-label">您的设备 (Workspace)</div>
          <div className="device-list">
            {MOCK_DEVICES.map(dev => (
              <div 
                key={dev.id} 
                className={`device-item ${activeDevice === dev.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveDevice(dev.id);
                  setActiveTab('dashboard');
                }}
              >
                <div className="device-icon">🖧</div>
                <div className="device-info">
                  <h4 className="device-name">{dev.name}</h4>
                  <div className="device-status">
                    <span className={`status-dot ${dev.status === 'offline' ? 'offline' : ''}`}></span>
                    {dev.status === 'online' ? dev.ip : 'Disconnected'}
                  </div>
                </div>
              </div>
            ))}
            
            <button className="clean-btn" style={{marginTop: '10px', padding: '10px', background: 'transparent', border: '1px dashed rgba(255,255,255,0.2)'}}>
               + 扫描新设备
            </button>
          </div>

          <div className="section-label">工具箱</div>
          <div className="sidebar-tools">
             <button className={`tool-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
               <span style={{fontSize:'1.2rem'}}>📊</span> 仪表盘
             </button>
             <button className={`tool-btn ${activeTab === 'flasher' ? 'active' : ''}`} onClick={() => setActiveTab('flasher')}>
               <span style={{fontSize:'1.2rem'}}>💽</span> 系统镜像工具
             </button>
             <button className={`tool-btn ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
               <span style={{fontSize:'1.2rem'}}>💻</span> SSH 终端
             </button>
             <button className="tool-btn">
               <span style={{fontSize:'1.2rem'}}>🧩</span> 配置与拓展
             </button>
          </div>
        </div>

        {/* Main Area */}
        <div className="main-area">
          <div className="top-toolbar">
             <div className="context-title">
               {activeTab === 'flasher' && '系统镜像工具'}
               {activeTab === 'dashboard' && '仪表盘'}
               {activeTab === 'terminal' && '远程终端'}
               <span style={{color: '#64748b', fontSize: '0.9rem', fontWeight: 'normal'}}> / {currentDevice?.name}</span>
             </div>
             <div className="toolbar-actions">
                <button className="icon-btn" title="通知">🔔</button>
                <button className="icon-btn" title="用户账号">👤</button>
             </div>
          </div>

          <div className="canvas-viewport">
            {renderMainContent()}
          </div>

          {/* Contextual AI Dock */}
          <div className="floating-dock">
            <form className="input-box" onSubmit={handleCommand}>
              <span style={{marginRight: '12px', fontSize: '1.2rem'}}>✨</span>
              <input 
                type="text" 
                className="cmd-input" 
                placeholder={`让 AI 协助操作 ${currentDevice?.name} (例如 "帮我烧录最新的Ubuntu版本")...`}
                value={cmd}
                onChange={e => setCmd(e.target.value)}
                disabled={isLoading}
              />
              <button type="submit" className="send-btn" disabled={isLoading}>
                ➤
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
