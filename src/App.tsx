import React, { useState } from 'react';
import './styles.css';

// Mock Multi-Device Data
const MOCK_DEVICES = [
  { id: '1', name: 'RDK X3 - Local', status: 'online', ip: '192.168.1.100' },
  { id: '2', name: 'RDK Ultra - Lab', status: 'offline', ip: '192.168.1.105' },
];

export default function App() {
  const [activeDevice, setActiveDevice] = useState(MOCK_DEVICES[0].id);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'flasher', 'terminal', 'files', 'vnc', 'lowcode'
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
           <div className="isolated-widget terminal-widget" style={{fontFamily: 'monospace'}}>
             <div className="widget-header" style={{fontSize: '1rem'}}>
                🟢 root@{currentDevice?.ip} ~
             </div>
             <div style={{color: '#94a3b8', marginTop: '10px', minHeight: '300px'}}>
               Welcome to RDK OS.<br/>
               Linux rdk 5.10.x aarch64<br/><br/>
               root@rdk:~# <span style={{display:'inline-block', width: '8px', height: '15px', background: '#94a3b8', animation: 'blink 1s infinite'}}></span>
             </div>
           </div>
        </div>
      );
    }

    if (activeTab === 'files' || activeTab === 'vnc' || activeTab === 'lowcode') {
      return (
        <div className="center-stage" style={{ justifyContent: 'center', height: '100%' }}>
          <div className="isolated-widget" style={{textAlign: 'center'}}>
             <div className="widget-header" style={{justifyContent: 'center', borderBottom: 'none'}}>🚧 模块正在开发中</div>
             <div className="desc-text">该基础工具 [{activeTab}] 的 UI 尚未在此原型中映射。</div>
          </div>
        </div>
      );
    }

    // Default: Dashboard / Copilot Main Interface
    return (
      <div className="center-stage">
        <h2 className="hero-title">{currentDevice?.name || 'RDK Workspace'}</h2>
        <div className="hero-subtitle">基于 AI 驱动的边缘计算与开发节点</div>

        <div className="quick-grid">
          <div className="startup-card" onClick={() => alert('通信链接建立... 进入 OpenClaw 模块。')}>
            <h3>🦞 OpenClaw (小龙虾)</h3>
            <p>深度体验 RDK 社区超高人气生态项目，利用 BPU 进行小龙虾的智能识别、多目标追踪及姿态预估，展示无缝的端到端 AI 落地全流程。</p>
          </div>
          <div className="startup-card" onClick={() => alert('调用 hrutools 和 bputop...')}>
            <h3>🏥 硬件诊断监控</h3>
            <p>集成 hrutools 与 bputop，实时监控 BPU 算力负载、CPU 占用、内存及芯片温度条形图。</p>
          </div>
          <div className="startup-card" onClick={() => alert('获取地平线示例应用仓库...')}>
            <h3>📦 示例应用</h3>
            <p>全面汇聚 RDK 官方与生态节点，一键运行 TogetherROS.b 环境下的视觉跟随、手势控制、双摄测距等深度学习与机器视觉 Demo。</p>
          </div>
          <div className="startup-card" onClick={() => alert('启动 Foxglove websocket / WebViz桥接 ...')}>
            <h3>🕸️ ROS 话题可视化</h3>
            <p>订阅并可视化设备上的 ROS2 话题 (如 /hobot_dnn/bbox)。直接在浏览器展示点云、图像帧及 AI 推理框。</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="canvas-shell">
      <div className="layout-container">
        
        {/* Left Sidebar - Infrastructure & Tools */}
        <div className="app-sidebar">
          <div className="sidebar-brand cursor-pointer" onClick={() => setActiveTab('dashboard')} style={{cursor: 'pointer'}}>
            RDK Studio
          </div>
          
          <div className="section-label">我的设备</div>
          <div className="device-list">
            {MOCK_DEVICES.map(dev => (
              <div 
                key={dev.id} 
                className={`device-item ${activeDevice === dev.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveDevice(dev.id);
                  setActiveTab('dashboard'); // Switch focus to dashboard when device changes
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
            <button className="clean-btn outline-btn" style={{marginTop: '10px', padding: '8px', fontSize: '0.85rem'}}>
               + 扫描 / 添加设备
            </button>
          </div>

          <div className="section-label">基础工具箱</div>
          <div className="sidebar-tools">
             <button className={`tool-btn ${activeTab === 'flasher' ? 'active' : ''}`} onClick={() => setActiveTab('flasher')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>💽</span> 镜像烧录
             </button>
             <button className={`tool-btn ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>📁</span> 文件资源
             </button>
             <button className={`tool-btn ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>💻</span> SSH 终端
             </button>
             <button className={`tool-btn ${activeTab === 'vnc' ? 'active' : ''}`} onClick={() => setActiveTab('vnc')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>🖥️</span> 远程桌面
             </button>
             <button className={`tool-btn ${activeTab === 'lowcode' ? 'active' : ''}`} onClick={() => setActiveTab('lowcode')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>🧩</span> 流程编排
             </button>
          </div>
          
          <div className="sidebar-footer" style={{ marginTop: 'auto', borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
             <button className="tool-btn" onClick={() => window.open('https://developer.horizon.cc/', '_blank')}>
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>🍠</span> <span style={{color: '#ff6b00', fontWeight: 'bold'}}>地瓜开发者社区</span>
             </button>
             <button className="tool-btn">
               <span style={{fontSize:'1.2rem', width:'24px', textAlign:'center', display:'inline-block'}}>⚙️</span> 客户端设置
             </button>
          </div>
        </div>

        {/* Main Area - Dynamic Apps & Copilot */}
        <div className="main-area">
          <div className="top-toolbar" style={{ height: '48px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px', marginRight: '20px' }}>
                <div style={{width:'12px', height:'12px', borderRadius:'50%', background:'#f87171'}}></div>
                <div style={{width:'12px', height:'12px', borderRadius:'50%', background:'#facc15'}}></div>
                <div style={{width:'12px', height:'12px', borderRadius:'50%', background:'#4ade80'}}></div>
             </div>
             <div className="context-title" style={{ flex: 1, justifyContent: 'center' }}>
               {activeTab === 'dashboard' && 'AI Copilot 工作台'}
               {activeTab === 'flasher' && '系统镜像工具'}
               {activeTab === 'terminal' && '终端环境'}
               {activeTab === 'files' && '文件管理器 (SFTP)'}
               {activeTab === 'vnc' && '可视化桌面 (VNC)'}
               {activeTab === 'lowcode' && 'Node-RED 编排'}
               <span style={{color: '#94a3b8', fontSize: '0.9rem', fontWeight: 'normal', display: 'inline-flex', alignItems: 'center', marginLeft: '10px'}}> 
                 <span style={{margin: '0 6px'}}>/</span> 
                 <span className={`status-dot ${currentDevice?.status === 'offline' ? 'offline' : ''}`} style={{marginRight: '6px', width:'6px', height:'6px'}}></span> 
                 {currentDevice?.name} ({currentDevice?.ip})
               </span>
             </div>
             <div className="toolbar-actions">
                <button className="icon-btn" title="查看用户/许可证">👤</button>
             </div>
          </div>

          <div className="canvas-viewport">
            {renderMainContent()}
          </div>

          {/* Contextual AI Dock */}
          <div className="floating-dock">
            <form className="input-box" onSubmit={handleCommand}>
              <span style={{marginRight: '12px', fontSize: '1.2rem', color: '#ff6b00'}}>✨</span>
              <input 
                type="text" 
                className="cmd-input" 
                placeholder={`让 AI 协助开发 ${currentDevice?.name} (例如 "帮我用C++订阅一个ROS话题")...`}
                value={cmd}
                onChange={e => setCmd(e.target.value)}
                disabled={isLoading}
              />
              <button type="submit" className="send-btn" disabled={isLoading} title="发送">
                ↑
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
