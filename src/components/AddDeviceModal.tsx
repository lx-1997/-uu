import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';

type ConnMethod = 'manual' | 'usb';
type Step = 'method' | 'configure' | 'verify';

/* ── SVG icons ── */
const Icons = {
  wifi: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.55a11 11 0 0114 0"/><path d="M1.42 9a16 16 0 0121.16 0"/>
      <path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
  ),
  edit: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  usb: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 18v-6"/><path d="M8 18v-2"/><path d="M16 18v-4"/>
      <rect x="6" y="18" width="4" height="4" rx="1"/><rect x="14" y="18" width="4" height="4" rx="1"/>
      <circle cx="12" cy="8" r="2"/><path d="M12 2v4"/>
    </svg>
  ),
  check: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  arrow: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  back: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  ),
  close: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
};

const METHODS: { key: ConnMethod; icon: JSX.Element; title: string; desc: string }[] = [
  { key: 'manual', icon: Icons.edit, title: 'SSH 网络连接', desc: '输入 IP 地址，通过有线网络或 WiFi 远程连接' },
  { key: 'usb',    icon: Icons.usb,  title: 'USB 串口调试', desc: '通过 Micro USB / Type-C 调试口直连' },
];

export default function AddDeviceModal() {
  const {
    showAddDevice, setShowAddDevice,
    newDeviceName, setNewDeviceName, newDeviceIp, setNewDeviceIp,
    addNewDevice, setActiveTab, addToast,
  } = useAppState();

  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<ConnMethod>('manual');
  const [sshUser, setSshUser] = useState('root');
  const [sshPass, setSshPass] = useState('root');
  const [sshPort, setSshPort] = useState('22');
  const [serialPort, setSerialPort] = useState('/dev/ttyUSB0');
  const [baudRate, setBaudRate] = useState('921600');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [showWifiConfig, setShowWifiConfig] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyOk, setVerifyOk] = useState(false);

  const close = () => {
    setShowAddDevice(false);
    setStep('method');
    setMethod('manual');
    setVerifying(false);
    setVerifyOk(false);
    setNewDeviceName('');
    setNewDeviceIp('');
    setSshUser('root');
    setSshPass('root');
    setSshPort('22');
    setWifiSsid('');
    setWifiPass('');
    setShowWifiConfig(false);
  };

  const goToConfigure = (m: ConnMethod) => {
    setMethod(m);
    setStep('configure');
  };

  const goToVerify = () => {
    setStep('verify');
    setVerifying(true);
    setVerifyOk(false);

    // Simulate connection verification
    window.setTimeout(() => {
      setVerifying(false);
      setVerifyOk(true);
      if (showWifiConfig && method === 'usb') {
        setNewDeviceIp('192.168.31.25'); // Simulate fetching IP if Wi-Fi was auto-configured
      }
    }, 1800);
  };

  const confirmAdd = () => {
    addNewDevice();
    close();
    if (method === 'usb') {
      setActiveTab('terminal');
      addToast(`串口 ${serialPort} 已连接，进入终端会话`, 'success');
    }
  };

  if (!showAddDevice) return null;

  const stepIndex = step === 'method' ? 0 : step === 'configure' ? 1 : 2;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="add-device-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="adm-header">
          <div>
            <div className="adm-title">添加设备</div>
            <div className="adm-subtitle">
              {step === 'method' && '选择连接方式'}
              {step === 'configure' && (method === 'manual' ? '配置 SSH 连接' : 'USB 串口连接')}
              {step === 'verify' && '验证连接'}
            </div>
          </div>
          <button className="adm-close" onClick={close}>{Icons.close}</button>
        </div>

        {/* Progress */}
        <div className="adm-progress">
          {['连接方式', '配置', '验证'].map((label, i) => (
            <div key={label} className={`adm-step ${i <= stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}>
              <div className="adm-step-dot">{i < stepIndex ? Icons.check : i + 1}</div>
              <span className="adm-step-label">{label}</span>
            </div>
          ))}
          <div className="adm-progress-line">
            <div className="adm-progress-fill" style={{ width: `${stepIndex * 50}%` }} />
          </div>
        </div>

        {/* Step 1: Choose method */}
        {step === 'method' && (
          <div className="adm-body">
            <div className="adm-method-grid">
              {METHODS.map(m => (
                <button key={m.key} className="adm-method-card" onClick={() => goToConfigure(m.key)}>
                  <div className="adm-method-icon">{m.icon}</div>
                  <div className="adm-method-title">{m.title}</div>
                  <div className="adm-method-desc">{m.desc}</div>
                  <span className="adm-method-arrow">{Icons.arrow}</span>
                </button>
              ))}
            </div>
            <div className="adm-hint">
              支持 RDK X3 / X5 / S100 / Ultra 全系列开发板
            </div>
          </div>
        )}

        {/* Step 2: Configure */}
        {step === 'configure' && (
          <div className="adm-body">
            {method === 'manual' && (
              <div className="adm-form">
                <label className="adm-field">
                  <span className="adm-field-label">IP 地址</span>
                  <input
                    className="adm-input"
                    placeholder="如 192.168.1.100"
                    value={newDeviceIp}
                    onChange={e => setNewDeviceIp(e.target.value)}
                    autoFocus
                  />
                </label>
                <div className="adm-field-row">
                  <label className="adm-field">
                    <span className="adm-field-label">用户名</span>
                    <input className="adm-input" value={sshUser} onChange={e => setSshUser(e.target.value)} />
                  </label>
                  <label className="adm-field">
                    <span className="adm-field-label">密码</span>
                    <input className="adm-input" type="password" value={sshPass} onChange={e => setSshPass(e.target.value)} placeholder="默认 root" />
                  </label>
                </div>
                <label className="adm-field">
                  <span className="adm-field-label">SSH 端口</span>
                  <input className="adm-input" value={sshPort} onChange={e => setSshPort(e.target.value)} style={{ maxWidth: 120 }} />
                </label>
                <label className="adm-field">
                  <span className="adm-field-label">设备名称（可选）</span>
                  <input
                    className="adm-input"
                    placeholder="如 RDK X5 - 工位3"
                    value={newDeviceName}
                    onChange={e => setNewDeviceName(e.target.value)}
                  />
                </label>
                <div className="adm-field-hint">
                  支持 RDK X3 / X5 / S100 / Ultra
                </div>

                <div style={{ marginTop: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#64748b', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={showWifiConfig} onChange={e => setShowWifiConfig(e.target.checked)} />
                    通过此连接配置设备 WiFi (可选)
                  </label>
                  {showWifiConfig && (
                    <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px', marginTop: '12px' }}>
                      <label className="adm-field" style={{ marginBottom: '12px' }}>
                        <span className="adm-field-label">WiFi 名称 (SSID)</span>
                        <input className="adm-input" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} placeholder="如 MyHomeRouter" />
                      </label>
                      <label className="adm-field">
                        <span className="adm-field-label">密码 (Password)</span>
                        <input className="adm-input" type="password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} placeholder="无密码可留空" />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}

            {method === 'usb' && (
              <div className="adm-usb-section">
                <div className="adm-usb-guide">
                  <div className="adm-usb-step">
                    <span className="adm-usb-num">1</span>
                    <span>将调试线缆连接到 RDK 调试口（X3/X5: Micro USB｜S100: Type-C）</span>
                  </div>
                  <div className="adm-usb-step">
                    <span className="adm-usb-num">2</span>
                    <span>确认 PC 已识别串口驱动 (CP210X / CH340)</span>
                  </div>
                </div>
                <div className="adm-field-row">
                  <label className="adm-field">
                    <span className="adm-field-label">串口号</span>
                    <select className="adm-input" value={serialPort} onChange={e => setSerialPort(e.target.value)}>
                      <option value="/dev/ttyUSB0">/dev/ttyUSB0</option>
                      <option value="/dev/ttyUSB1">/dev/ttyUSB1</option>
                      <option value="/dev/ttyACM0">/dev/ttyACM0</option>
                      <option value="COM3">COM3</option>
                      <option value="COM4">COM4</option>
                    </select>
                  </label>
                  <label className="adm-field">
                    <span className="adm-field-label">波特率</span>
                    <select className="adm-input" value={baudRate} onChange={e => setBaudRate(e.target.value)}>
                      <option value="921600">921600</option>
                      <option value="115200">115200</option>
                      <option value="460800">460800</option>
                      <option value="9600">9600</option>
                    </select>
                  </label>
                </div>
                <div className="adm-field-row">
                  <label className="adm-field">
                    <span className="adm-field-label">用户名</span>
                    <input className="adm-input" value={sshUser} onChange={e => setSshUser(e.target.value)} />
                  </label>
                  <label className="adm-field">
                    <span className="adm-field-label">密码</span>
                    <input className="adm-input" type="password" value={sshPass} onChange={e => setSshPass(e.target.value)} placeholder="默认 root" />
                  </label>
                </div>
                <label className="adm-field">
                  <span className="adm-field-label">设备名称（可选）</span>
                  <input
                    className="adm-input"
                    placeholder="如 RDK X5 (USB)"
                    value={newDeviceName}
                    onChange={e => setNewDeviceName(e.target.value)}
                  />
                </label>
                <div className="adm-field-hint">
                  连接后将直接进入终端会话 &nbsp;|&nbsp; 数据位 8，停止位 1，无校验
                </div>

                <div style={{ marginTop: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#64748b', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={showWifiConfig} onChange={e => setShowWifiConfig(e.target.checked)} />
                    在此串口连接过程中同时配网 (可选)
                  </label>
                  {showWifiConfig && (
                    <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px', marginTop: '12px' }}>
                      <label className="adm-field" style={{ marginBottom: '12px' }}>
                        <span className="adm-field-label">WiFi 名称 (SSID)</span>
                        <input className="adm-input" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} placeholder="如 MyHomeRouter" />
                      </label>
                      <label className="adm-field">
                        <span className="adm-field-label">密码 (Password)</span>
                        <input className="adm-input" type="password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} placeholder="无密码可留空" />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Bottom nav */}
            <div className="adm-nav">
              <button className="adm-nav-btn secondary" onClick={() => setStep('method')}>
                {Icons.back} 返回
              </button>
              <button
                className="adm-nav-btn primary"
                onClick={goToVerify}
                disabled={method === 'manual' ? !newDeviceIp.trim() : false}
              >
                下一步 {Icons.arrow}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Verify */}
        {step === 'verify' && (
          <div className="adm-body">
            {verifying && (
              <div className="adm-verifying">
                <div className="adm-verify-spinner" />
                <div className="adm-verify-text">
                  {showWifiConfig ? '正在验证连接并配置网络...' : '正在验证连接...'}
                </div>
                <div className="adm-verify-sub">
                  {method === 'usb' ? '检测串口设备...' : `尝试连接 ${newDeviceIp}:${sshPort}...`}
                </div>
              </div>
            )}
            {!verifying && verifyOk && (
              <div className="adm-verify-ok">
                <div className="adm-verify-check">{Icons.check}</div>
                <div className="adm-verify-title">
                  {showWifiConfig ? '连接成功且已获取设备网络IP' : '连接成功'}
                </div>
                <div className="adm-verify-info">
                  <div className="adm-info-row"><span>设备</span><strong>{newDeviceName || 'RDK Device'}</strong></div>
                  <div className="adm-info-row"><span>{method === 'usb' && !showWifiConfig ? '串口' : 'IP'}</span><strong>{method === 'usb' && !showWifiConfig ? `${serialPort} @ ${baudRate}` : newDeviceIp || '192.168.31.25'}</strong></div>
                  <div className="adm-info-row"><span>{showWifiConfig ? '所连网络' : '型号'}</span><strong>{showWifiConfig ? wifiSsid : 'RDK X5'}</strong></div>
                  <div className="adm-info-row"><span>系统</span><strong>Ubuntu 22.04 (3.1.0)</strong></div>
                </div>
                <label className="adm-field" style={{ marginTop: 16 }}>
                  <span className="adm-field-label">设备别名（可修改）</span>
                  <input
                    className="adm-input"
                    value={newDeviceName}
                    onChange={e => setNewDeviceName(e.target.value)}
                  />
                </label>
              </div>
            )}

            <div className="adm-nav">
              <button className="adm-nav-btn secondary" onClick={() => { setStep('configure'); setVerifyOk(false); }}>
                {Icons.back} 返回
              </button>
              <button className="adm-nav-btn primary" onClick={confirmAdd} disabled={verifying}>
                {verifyOk ? (method === 'usb' ? '进入终端' : '添加到工作区') : '请等待...'} {verifyOk && Icons.check}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
