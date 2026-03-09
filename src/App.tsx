import { useState } from 'react';

type WidgetType = 'home' | 'hardware' | 'flash' | 'openclaw' | 'examples';

export default function App() {
  const [activeWidget, setActiveWidget] = useState<WidgetType>('home');
  const [inputVal, setInputVal] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');

  const dispatchAction = (cmd: string) => {
    if (!cmd.trim()) return;
    setInputVal('');
    
    // Simulate natural AI thinking time
    setLoadingMsg(`Processing: ${cmd}...`);
    setActiveWidget('home'); // Clear current

    setTimeout(() => {
      setLoadingMsg('');
      if (cmd.includes('烧录') || cmd.includes('镜像')) {
        setActiveWidget('flash');
      } else if (cmd.includes('openclaw') || cmd.includes('下发') || cmd.toLowerCase().includes('openclaw')) {
        setActiveWidget('openclaw');
      } else if (cmd.includes('示例应用') || cmd.includes('案例')) {
        setActiveWidget('examples');
      } else if (cmd.includes('连接') || cmd.includes('硬件')) {
        setActiveWidget('hardware');
      } else {
        // default graceful fallback
        setActiveWidget('hardware');
      }
    }, 800);
  };

  const renderActiveWidget = () => {
    if (loadingMsg) {
      return (
        <div className="center-stage loading-stage">
          <div className="spinner"></div>
          <p>{loadingMsg}</p>
        </div>
      );
    }

    switch(activeWidget) {
      case 'home':
        return (
          <div className="center-stage fade-in-scale">
            <h1 className="hero-title">RDK AURA ENGINE</h1>
            <p className="hero-subtitle">How can I assist your edge deployment today?</p>
            <div className="quick-grid">
              {[
                { title: '📡 Device Radar', desc: 'Scan local network & SSH Connect', cmd: '设备连接' },
                { title: '💾 Image Flasher', desc: 'Securely flash OS via SD/EMMC', cmd: '镜像烧录' },
                { title: '🧠 OpenClaw', desc: 'Inject LLM Agent into edge node', cmd: '执行 OpenClaw下发' },
                { title: '📦 Edge Examples', desc: 'Deploy YOLO, Whisper & more', cmd: '打开示例应用' }
              ].map(item => (
                <div key={item.cmd} className="startup-card" onClick={() => dispatchAction(item.cmd)}>
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        );

      case 'hardware':
        return (
          <div className="center-stage fade-in-scale">
            <div className="minimal-widget max-w-lg">
              <div className="widget-header">
                 <span className="icon-glow">📡</span> Network Radar
              </div>
              <div className="clean-card">
                <h4><span className="status-dot"></span>RDK-X5 Master</h4>
                <p>IP: 192.168.1.108 | Latency: 4ms</p>
                <p>Status: SSH Connectivity Verified & Key Shared.</p>
              </div>
              <button className="clean-btn btn-full mt-4" onClick={() => dispatchAction('打开镜像烧录')}>Proceed to Flashing</button>
              <button className="clean-btn secondary btn-full mt-2" onClick={() => setActiveWidget('home')}>Back to Home</button>
            </div>
          </div>
        );

      case 'flash':
        return (
          <div className="center-stage fade-in-scale">
            <div className="minimal-widget max-w-lg">
               <div className="widget-header">
                 <span className="icon-glow">💾</span> Base OS Flasher
               </div>
               <p className="desc-text">Select your target architecture and destination media to begin the erase and flash cycle.</p>
               <select className="clean-input" defaultValue="ubuntu">
                 <option value="ubuntu">Ubuntu 22.04 LTS (Standard Base Rootfs)</option>
                 <option value="openclaw">OpenClaw Edge OS (Pre-configured)</option>
               </select>
               <select className="clean-input">
                 <option>/dev/disk2 (Generic USB SD Reader)</option>
                 <option>Over-The-Air (Requires Active Agent)</option>
               </select>
               <div className="btn-group mt-4">
                 <button className="clean-btn flex-1" onClick={() => dispatchAction('执行 OpenClaw下发')}>Ignite Flash</button>
                 <button className="clean-btn secondary flex-1" onClick={() => setActiveWidget('home')}>Cancel</button>
               </div>
            </div>
          </div>
        );

      case 'openclaw':
        return (
          <div className="center-stage fade-in-scale">
            <div className="minimal-widget max-w-lg">
               <div className="widget-header">
                 <span className="icon-glow">🧠</span> OpenClaw Core Injection
               </div>
               <p className="desc-text">Configure the Cognitive Agent endpoint for this edge device.</p>
               <input className="clean-input" type="text" placeholder="LLM Base URL (e.g. https://api.openai.com/v1)" />
               <input className="clean-input" type="password" placeholder="API Key Secret (sk-...)" />
               <div className="btn-group mt-4">
                 <button className="clean-btn flex-1">Inject & Restart Daemon</button>
                 <button className="clean-btn secondary flex-1" onClick={() => setActiveWidget('home')}>Back</button>
               </div>
            </div>
          </div>
        );

      case 'examples':
        return (
          <div className="center-stage fade-in-scale">
             <div className="minimal-widget max-w-lg">
               <div className="widget-header"><span className="icon-glow">🚀</span> Edge Application Templates</div>
               <p className="desc-text">One-click native app deployments designed for BPU acceleration.</p>
               <div className="clean-card" style={{cursor:'pointer', marginBottom:12}} onClick={() => alert('Deployed YOLO')}>
                 <h4>👀 YOLO Stream Analytics</h4><p>FPS: 30 | Models: Yolov8n</p>
               </div>
               <div className="clean-card" style={{cursor:'pointer'}} onClick={() => alert('Deployed Whisper')}>
                 <h4>🎙️ Whisper Voice Engine</h4><p>Offline Voice Activation Command Center</p>
               </div>
               <button className="clean-btn secondary btn-full mt-4" onClick={() => setActiveWidget('home')}>Return</button>
             </div>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="canvas-shell fixed-layout">
      {/* Dynamic Centered Canvas */}
      <div className="canvas-viewport">
        {renderActiveWidget()}
      </div>

      {/* Floating Input Dock */}
      <div className="floating-dock">
        <div className="input-box">
          <input 
            className="cmd-input" 
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && dispatchAction(inputVal)}
            placeholder="Type 'Flash', 'OpenClaw' or ask any operation..."
            autoFocus 
          />
          <button className="send-btn" onClick={() => dispatchAction(inputVal)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          </button>
        </div>
      </div>
    </div>
  );
}