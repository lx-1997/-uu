import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { verifyDeviceConnection } from '../api';

type ConnMethod = 'manual' | 'usb';
type Step = 'method' | 'configure' | 'verify';

export default function AddDeviceModal() {
  const {
    showAddDevice, setShowAddDevice,
    newDeviceName, setNewDeviceName, newDeviceIp, setNewDeviceIp,
    addNewDevice, setActiveTab, addToast,
  } = useAppState();

  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<ConnMethod>('manual');
  const [sshUser, setSshUser] = useState('sunrise');
  const [sshPass, setSshPass] = useState('sunrise');
  const [sshPort, setSshPort] = useState('22');
  const [serialPort, setSerialPort] = useState('/dev/ttyUSB0');
  const [baudRate, setBaudRate] = useState('921600');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [showWifiConfig, setShowWifiConfig] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyOk, setVerifyOk] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const close = () => {
    setShowAddDevice(false);
    setStep('method');
    setMethod('manual');
    setVerifying(false);
    setVerifyOk(false);
    setNewDeviceName('');
    setNewDeviceIp('');
    setSshUser('sunrise');
    setSshPass('sunrise');
    setSshPort('22');
    setWifiSsid('');
    setWifiPass('');
    setShowWifiConfig(false);
  };

  const goToConfigure = (m: ConnMethod) => { setMethod(m); setStep('configure'); };

  const goToVerify = () => {
    setStep('verify');
    setVerifying(true);
    setVerifyOk(false);
    const host = method === 'usb' ? (newDeviceIp.trim() || '127.0.0.1') : newDeviceIp.trim();
    verifyDeviceConnection({ host, port: Number(sshPort || '22'), username: sshUser.trim() || 'sunrise', password: sshPass.trim() })
      .then(() => { setVerifying(false); setVerifyOk(true); })
      .catch((error) => {
        setVerifying(false);
        setVerifyOk(false);
        const raw = error instanceof Error ? error.message : '连接验证失败';
        if (raw.includes('[SSH_AUTH_FAILED]')) {
          addToast('认证失败：请检查用户名和密码', 'error');
          return;
        }
        if (raw.includes('[SSH_CONNECT_TIMEOUT]')) {
          addToast('连接超时：请检查设备网络、IP 与端口', 'warning');
          return;
        }
        if (raw.includes('[INVALID_DEVICE_CREDENTIALS]')) {
          addToast('请完整填写 IP、用户名和密码', 'warning');
          return;
        }
        addToast('连接验证失败，请检查 IP/账号/密码', 'error');
      });
  };

  const confirmAdd = () => {
    const host = method === 'usb' ? (newDeviceIp.trim() || '127.0.0.1') : newDeviceIp.trim();
    addNewDevice({ host, port: Number(sshPort || '22'), username: sshUser.trim() || 'sunrise', password: sshPass.trim(), name: newDeviceName });
    if (method === 'usb') { setActiveTab('terminal'); addToast(`串口 ${serialPort} 已连接`, 'success'); }
    close();
  };

  if (!showAddDevice) return null;
  const stepIndex = step === 'method' ? 0 : step === 'configure' ? 1 : 2;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-content add-device-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">添加设备</div>
            <div className="modal-subtitle">
              {step === 'method' && '选择连接方式'}
              {step === 'configure' && (method === 'manual' ? '配置 SSH 连接' : 'USB 串口')}
              {step === 'verify' && '验证连接'}
            </div>
          </div>
          <button className="btn-icon" onClick={close} title="关闭弹窗" aria-label="关闭弹窗">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="add-device-steps">
          {['连接方式', '配置', '验证'].map((label, i) => (
            <div key={label} className={`add-device-step ${i < stepIndex ? 'done' : i === stepIndex ? 'active' : ''}`}>
              <span className="add-device-step-num">
                {i < stepIndex ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg> : i + 1}
              </span>
              <span className="add-device-step-label">{label}</span>
              {i < 2 && <span className="add-device-step-line" />}
            </div>
          ))}
        </div>

        {/* Step 1: Method */}
        {step === 'method' && (
          <div className="modal-body">
            <div className="add-device-methods">
              <button className="add-device-method-card" onClick={() => goToConfigure('manual')}>
                <div className="add-device-method-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.55a11 11 0 0114 0"/><path d="M1.42 9a16 16 0 0121.16 0"/>
                    <path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/>
                  </svg>
                </div>
                <div className="add-device-method-body">
                  <strong>SSH 网络连接</strong>
                  <span>通过有线/WiFi 远程连接，输入 IP 地址即可</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
              <button className="add-device-method-card" onClick={() => goToConfigure('usb')}>
                <div className="add-device-method-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 18v-6"/><path d="M8 18v-2"/><path d="M16 18v-4"/>
                    <rect x="6" y="18" width="4" height="4" rx="1"/><rect x="14" y="18" width="4" height="4" rx="1"/>
                    <circle cx="12" cy="8" r="2"/><path d="M12 2v4"/>
                  </svg>
                </div>
                <div className="add-device-method-body">
                  <strong>USB 串口调试</strong>
                  <span>Micro USB / Type-C 调试口直连</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
            <div className="add-device-support-hint">
              支持 RDK X3 / X5 / S100 / Ultra 全系列开发板
            </div>
          </div>
        )}

        {/* Step 2: Configure */}
        {step === 'configure' && (
          <div className="modal-body">
            {method === 'manual' ? (
              <div className="add-device-form">
                <div className="add-device-field">
                  <label>IP 地址</label>
                  <input className="input" placeholder="192.168.1.100" value={newDeviceIp} onChange={e => setNewDeviceIp(e.target.value)} autoFocus />
                </div>
                <div className="add-device-field-row">
                  <div className="add-device-field">
                    <label>用户名</label>
                    <input className="input" value={sshUser} onChange={e => setSshUser(e.target.value)} title="SSH 用户名" />
                  </div>
                  <div className="add-device-field">
                    <label>密码</label>
                    <div className="add-device-pass-wrap">
                      <input className="input" type={showPass ? 'text' : 'password'} value={sshPass} onChange={e => setSshPass(e.target.value)} title="SSH 密码" />
                      <button type="button" className="btn-icon add-device-pass-toggle" onClick={() => setShowPass(v => !v)} title={showPass ? '隐藏密码' : '显示密码'} aria-label={showPass ? '隐藏密码' : '显示密码'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          {showPass ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="add-device-field-row">
                  <div className="add-device-field">
                    <label>SSH 端口</label>
                    <input className="input" value={sshPort} onChange={e => setSshPort(e.target.value)} title="SSH 端口" />
                  </div>
                  <div className="add-device-field">
                    <label>设备别名（可选）</label>
                    <input className="input" placeholder="如 RDK X5 工位3" value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)} />
                  </div>
                </div>
                <div className="add-device-presets">
                  <span className="add-device-presets-label">快捷填充：</span>
                  <button className="chip" onClick={() => { setSshUser('sunrise'); setSshPass('sunrise'); }}>sunrise / sunrise</button>
                  <button className="chip" onClick={() => { setSshUser('root'); setSshPass('root'); }}>root / root</button>
                  <button className="chip" onClick={() => setNewDeviceIp('192.168.127.10')}>有线默认 IP</button>
                </div>

                <div className="add-device-wifi-toggle">
                  <label>
                    <input type="checkbox" checked={showWifiConfig} onChange={e => setShowWifiConfig(e.target.checked)} />
                    <span>连接后顺便配置 WiFi</span>
                  </label>
                </div>
                {showWifiConfig && (
                  <div className="add-device-wifi-fields">
                    <div className="add-device-field">
                      <label>WiFi 名称 (SSID)</label>
                      <input className="input" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} placeholder="MyWiFi" />
                    </div>
                    <div className="add-device-field">
                      <label>WiFi 密码</label>
                      <input className="input" type="password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} placeholder="无密码可留空" />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="add-device-form">
                <div className="add-device-usb-steps">
                  <div className="add-device-usb-step"><span className="add-device-usb-num">1</span>将调试线连接到 RDK 调试口</div>
                  <div className="add-device-usb-step"><span className="add-device-usb-num">2</span>确认 PC 已识别串口驱动 (CP210X / CH340)</div>
                </div>
                <div className="add-device-field-row">
                  <div className="add-device-field">
                    <label>串口号</label>
                    <select className="select" value={serialPort} onChange={e => setSerialPort(e.target.value)} title="串口号">
                      <option value="/dev/ttyUSB0">/dev/ttyUSB0</option>
                      <option value="/dev/ttyUSB1">/dev/ttyUSB1</option>
                      <option value="COM3">COM3</option><option value="COM4">COM4</option>
                    </select>
                  </div>
                  <div className="add-device-field">
                    <label>波特率</label>
                    <select className="select" value={baudRate} onChange={e => setBaudRate(e.target.value)} title="波特率">
                      <option value="921600">921600</option><option value="115200">115200</option>
                    </select>
                  </div>
                </div>
                <div className="add-device-field-row">
                  <div className="add-device-field"><label>用户名</label><input className="input" value={sshUser} onChange={e => setSshUser(e.target.value)} title="用户名" /></div>
                  <div className="add-device-field"><label>密码</label><input className="input" type="password" value={sshPass} onChange={e => setSshPass(e.target.value)} title="密码" /></div>
                </div>
                <div className="add-device-field">
                  <label>设备别名（可选）</label>
                  <input className="input" placeholder="如 RDK X5 (USB)" value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)} />
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setStep('method')}>返回</button>
              <button className="btn btn-primary" onClick={goToVerify} disabled={method === 'manual' ? (!newDeviceIp.trim() || !sshPass.trim()) : !sshPass.trim()}>
                下一步
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Verify */}
        {step === 'verify' && (
          <div className="modal-body">
            <div className="verify-status">
              {verifying && (
                <>
                  <div className="spinner" />
                  <div className="verify-status-title">正在验证连接...</div>
                  <div className="verify-status-detail">
                    {method === 'usb' ? '检测串口设备...' : `连接 ${newDeviceIp}:${sshPort}...`}
                  </div>
                </>
              )}
              {!verifying && verifyOk && (
                <>
                  <div className="verify-status-icon ok">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div className="verify-status-title">连接成功</div>
                  <div className="verify-info-grid">
                    <div className="verify-info-item"><span className="verify-info-label">设备</span><strong>{newDeviceName || 'RDK Device'}</strong></div>
                    <div className="verify-info-item"><span className="verify-info-label">IP</span><strong>{newDeviceIp || '127.0.0.1'}</strong></div>
                    <div className="verify-info-item"><span className="verify-info-label">用户</span><strong>{sshUser}</strong></div>
                    <div className="verify-info-item"><span className="verify-info-label">端口</span><strong>{sshPort}</strong></div>
                  </div>
                </>
              )}
              {!verifying && !verifyOk && (
                <>
                  <div className="verify-status-icon fail">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </div>
                  <div className="verify-status-title">连接失败</div>
                  <div className="verify-status-detail">请检查 IP 地址、用户名、密码，以及设备是否通电在线。</div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setStep('configure'); setVerifyOk(false); }}>返回</button>
              <button className="btn btn-primary" onClick={verifyOk ? confirmAdd : goToVerify} disabled={verifying}>
                {verifying ? '验证中...' : verifyOk ? '添加到工作区' : '重试'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
