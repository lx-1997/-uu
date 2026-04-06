import { useState, useEffect, useRef } from 'react';
import { useAppState } from '../hooks/useAppState';
import { verifyDeviceConnection, fetchTypecInterfaces, configureTypecInterface, fetchDeviceWifiList, type NetworkInterface } from '../api';
import { fetchApi } from '../utils/apiBase';
import { fetchWifiLinkState } from '../utils/wifi-link-probe';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import { isDesktopMac } from '../utils/env';
import {
  RDK_DEVELOPER_RESOURCE_URL,
  RDK_DRIVER_CH34X_WINDOWS_ZIP,
  RDK_DRIVER_CP210X_USB2UART_ZIP,
  RDK_OPEN_USB_SERIAL_EVENT,
} from '../utils/web-serial';
import { appendStudioLog } from '../utils/console-log-capture';

type ConnMethod = 'manual' | 'usb' | 'typec';
type Step = 'method' | 'configure' | 'verify' | 'wifi';

/** TypeC 闪连固定 IP 方案 */
const TYPEC_DEVICE_IP = '192.168.128.10';
const TYPEC_PC_IP = '192.168.128.100';
const TYPEC_NETMASK = '255.255.255.0';

export default function AddDeviceModal() {
  const {
    showAddDevice, setShowAddDevice,
    addDeviceInitialMethod, setAddDeviceInitialMethod,
    newDeviceName, setNewDeviceName, newDeviceIp, setNewDeviceIp,
    registerDeviceAfterVerify, setActiveTab, addToast,
  } = useAppState();
  const { t } = useI18n();
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);

  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<ConnMethod>('manual');
  const [sshUser, setSshUser] = useState('root');
  const [sshPass, setSshPass] = useState('root');
  const [sshPort, setSshPort] = useState('22');
  const [verifying, setVerifying] = useState(false);
  const [verifyOk, setVerifyOk] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [registering, setRegistering] = useState(false);
  /** 验证通过后注册设备，供 WiFi 步骤调用套件端 API */
  const [wifiDeviceId, setWifiDeviceId] = useState<string | null>(null);
  const [wifiLink, setWifiLink] = useState<'loading' | 'up' | 'down' | 'unknown'>('unknown');
  /** 探测到的当前已连接 WiFi 名称（与套件端 nmcli/iwgetid 一致时） */
  const [wifiConnectedSsid, setWifiConnectedSsid] = useState<string | undefined>();
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [wifiList, setWifiList] = useState<string[]>([]);
  const [wifiScanning, setWifiScanning] = useState(false);
  const [wifiConnecting, setWifiConnecting] = useState(false);
  const [showWifiPass, setShowWifiPass] = useState(false);
  const [wifiConnectLog, setWifiConnectLog] = useState('');
  const prevShowAddDeviceRef = useRef(false);
  /** 关闭弹窗或重开时递增，丢弃未完成的 TypeC 异步回调，避免竞态写状态 */
  const typecSessionRef = useRef(0);

  // ── TypeC 闪连状态 ──
  const [typecInterfaces, setTypecInterfaces] = useState<NetworkInterface[]>([]);
  const [selectedInterface, setSelectedInterface] = useState('');
  const [typecConfiguring, setTypecConfiguring] = useState(false);
  const [typecConfigured, setTypecConfigured] = useState(false);
  const [typecStep, setTypecStep] = useState<'select-nic' | 'configuring' | 'connecting'>('select-nic');
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);

  useEffect(() => {
    const justOpened = showAddDevice && !prevShowAddDeviceRef.current;
    prevShowAddDeviceRef.current = showAddDevice;
    if (!justOpened) return;
    if (addDeviceInitialMethod === 'usb' && isDesktopMac()) {
      setAddDeviceInitialMethod(null);
      setMethod('manual');
      setStep('method');
      addToast(t('addDevice.usb.macUnavailable', 'macOS 桌面版暂不支持 USB 串口，请使用 SSH 连接或改用网页版。'), 'info');
      return;
    }
    if (addDeviceInitialMethod) {
      setMethod(addDeviceInitialMethod);
      setStep('configure');
      if (addDeviceInitialMethod === 'typec') {
        loadTypecInterfaces();
      }
      setAddDeviceInitialMethod(null);
    } else {
      setStep('method');
      setMethod('manual');
    }
  }, [addDeviceInitialMethod, addToast, setAddDeviceInitialMethod, showAddDevice, t]);

  const close = () => {
    typecSessionRef.current += 1;
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
    setRegistering(false);
    setWifiDeviceId(null);
    setWifiLink('unknown');
    setWifiConnectedSsid(undefined);
    setWifiList([]);
    setWifiScanning(false);
    setWifiConnecting(false);
    setShowWifiPass(false);
    setWifiConnectLog('');
    // 重置闪连状态
    setTypecInterfaces([]);
    setSelectedInterface('');
    setTypecConfiguring(false);
    setTypecConfigured(false);
    setTypecStep('select-nic');
    setLoadingInterfaces(false);
  };

  const goToConfigure = (m: ConnMethod) => {
    setMethod(m);
    setStep('configure');
    if (m === 'typec') {
      loadTypecInterfaces();
    }
  };

  /** 加载网卡列表 */
  const loadTypecInterfaces = () => {
    setLoadingInterfaces(true);
    fetchTypecInterfaces()
      .then((res) => {
        setTypecInterfaces(res.interfaces);
        setLoadingInterfaces(false);
      })
      .catch(() => {
        addToast(t('addDevice.typec.loadFail', '获取网卡列表失败'), 'error');
        setLoadingInterfaces(false);
      });
  };

  /** 配置 TypeC 网卡 IP 并自动连接 */
  const configureAndConnectTypec = () => {
    if (!selectedInterface) {
      addToast(t('addDevice.typec.selectNic', '请选择 TypeC 虚拟网卡'), 'warning');
      return;
    }
    const session = ++typecSessionRef.current;
    appendStudioLog('info', `[TypeC] 开始闪连流程，选中网卡：${selectedInterface}`);
    setTypecStep('configuring');
    setTypecConfiguring(true);

    configureTypecInterface(selectedInterface, TYPEC_PC_IP, TYPEC_NETMASK)
      .then((res) => {
        if (session !== typecSessionRef.current) return;
        if (!res.verified) {
          appendStudioLog('warn', '[TypeC] 本机 IP 校验未通过（verified=false），请确认网卡是否选对');
          addToast(t('addDevice.typec.ipNotVerified', 'IP 配置未生效，请检查网卡选择是否正确'), 'warning');
          setTypecConfiguring(false);
          setTypecStep('select-nic');
          return;
        }
        setTypecConfigured(true);
        setTypecConfiguring(false);
        // 自动填充闪连 IP 并进入验证
        setNewDeviceIp(TYPEC_DEVICE_IP);
        setSshUser('root');
        setSshPass('root');
        setSshPort('22');
        setTypecStep('connecting');
        // 自动开始 SSH 验证
        setStep('verify');
        setVerifying(true);
        setVerifyOk(false);
        appendStudioLog('info', `[TypeC] POST /api/devices/verify host=${TYPEC_DEVICE_IP} port=22`);
        verifyDeviceConnection({ host: TYPEC_DEVICE_IP, port: 22, username: 'root', password: 'root' })
          .then(() => {
            if (session !== typecSessionRef.current) return;
            appendStudioLog('info', '[TypeC] SSH 验证成功');
            setVerifying(false);
            setVerifyOk(true);
          })
          .catch((error) => {
            if (session !== typecSessionRef.current) return;
            setVerifying(false);
            setVerifyOk(false);
            const raw = error instanceof Error ? error.message : t('addDevice.err.verify', '连接验证失败');
            appendStudioLog('error', `[TypeC] SSH 验证失败：${raw}`);
            if (raw.includes('[SSH_CONNECT_TIMEOUT]')) {
              addToast(t('addDevice.typec.timeout', '闪连超时：请确认 TypeC 线缆已连接到 RDK X5'), 'warning');
            } else if (raw.includes('[SSH_AUTH_FAILED]')) {
              addToast(t('addDevice.toast.authFail', '认证失败：请检查用户名和密码'), 'error');
            } else {
              addToast(t('addDevice.typec.connectFail', '闪连失败，请检查 TypeC 线缆连接'), 'error');
            }
          });
      })
      .catch((error) => {
        if (session !== typecSessionRef.current) return;
        setTypecConfiguring(false);
        setTypecStep('select-nic');
        const msg = error instanceof Error ? error.message : '网卡配置失败';
        appendStudioLog('error', `[TypeC] 闪连中断：${msg}`);
        addToast(msg, 'error');
      });
  };

  /** USB 串口仅为本机调试（Web Serial），不经过服务器 SSH，也不「添加设备」 */
  const openUsbSerialDebug = () => {
    setActiveTab('terminal');
    addToast(
      t('addDevice.usb.gotoTerminal', '已前往终端：使用 Web Serial 连接调试口（与 SSH 无关）。设备入网后请用「SSH 网络」添加设备。'),
      'info',
    );
    close();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(RDK_OPEN_USB_SERIAL_EVENT));
    }, 0);
  };

  const goToVerify = () => {
    if (method === 'typec') {
      configureAndConnectTypec();
      return;
    }
    if (method !== 'manual') return;
    setStep('verify');
    setVerifying(true);
    setVerifyOk(false);
    const host = newDeviceIp.trim();
    verifyDeviceConnection({ host, port: Number(sshPort || '22'), username: sshUser.trim() || 'root', password: sshPass.trim() })
      .then(() => { setVerifying(false); setVerifyOk(true); })
      .catch((error) => {
        setVerifying(false);
        setVerifyOk(false);
        const raw = error instanceof Error ? error.message : t('addDevice.err.verify', '连接验证失败');
        if (raw.includes('[SSH_AUTH_FAILED]')) {
          addToast(t('addDevice.toast.authFail', '认证失败：请检查用户名和密码'), 'error');
          return;
        }
        if (raw.includes('[SSH_CONNECT_TIMEOUT]')) {
          addToast(t('addDevice.toast.timeout', '连接超时：请检查设备网络、IP 与端口'), 'warning');
          return;
        }
        if (raw.includes('[INVALID_DEVICE_CREDENTIALS]')) {
          addToast(t('addDevice.toast.needFields', '请完整填写 IP、用户名和密码'), 'warning');
          return;
        }
        addToast(t('addDevice.toast.verifyFail', '连接验证失败，请检查 IP/账号/密码'), 'error');
      });
  };

  const goToWifiAfterVerify = async () => {
    if (method === 'typec') {
      setRegistering(true);
      const d = await registerDeviceAfterVerify({
        host: TYPEC_DEVICE_IP,
        port: 22,
        username: sshUser.trim() || 'root',
        password: sshPass.trim() || 'root',
        name: newDeviceName.trim() || 'RDK X5 (闪连)',
      });
      setRegistering(false);
      if (d) {
        setWifiDeviceId(d.id);
        setStep('wifi');
      }
      return;
    }
    if (method === 'manual') {
      setRegistering(true);
      const d = await registerDeviceAfterVerify({
        host: newDeviceIp.trim(),
        port: Number(sshPort || '22'),
        username: sshUser.trim() || 'root',
        password: sshPass.trim() || 'root',
        name: newDeviceName,
      });
      setRegistering(false);
      if (d) {
        setWifiDeviceId(d.id);
        setStep('wifi');
      }
    }
  };

  const finishAddDeviceFlow = () => {
    close();
  };

  const scanWifiOnDevice = () => {
    if (!wifiDeviceId) return;
    setWifiScanning(true);
    fetchDeviceWifiList(wifiDeviceId)
      .then((res) => {
        const names = res.wifiNames?.filter(Boolean) || [];
        setWifiList(names);
        if (!res.ok && res.errorHint) {
          addToast(res.errorHint, 'warning');
        } else if (!res.ok && names.length === 0) {
          addToast(t('wifiModal.toast.scanFail', '扫描 WiFi 失败'), 'warning');
        }
      })
      .catch(() => {
        addToast(t('wifiModal.toast.scanFail', '扫描 WiFi 失败'), 'warning');
      })
      .finally(() => setWifiScanning(false));
  };

  const handleWifiConnect = async () => {
    if (!wifiDeviceId || !wifiSsid.trim()) return;
    setWifiConnecting(true);
    setWifiConnectLog('');
    try {
      const res = await fetchApi(`/api/devices/${wifiDeviceId}/openclaw/wifi-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wifiName: wifiSsid, wifiPassword: wifiPass }),
      });
      const data = await res.json() as { ok: boolean; output?: string; error?: string };
      if (data.output) setWifiConnectLog(data.output);
      if (data.ok) {
        addToast(tf('wifiModal.toast.connected', '已连接到 {{ssid}}', { ssid: wifiSsid }), 'success');
        const s = await fetchWifiLinkState(wifiDeviceId);
        setWifiConnectedSsid(s.connectedSsid);
        setWifiLink(s.state === 'up' ? 'up' : s.state === 'down' ? 'down' : 'unknown');
      } else {
        addToast(data.error || data.output || t('wifiModal.toast.connectFail', 'WiFi 连接失败，请检查密码是否正确'), 'error');
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : t('wifiModal.toast.requestFail', 'WiFi 配置请求失败'), 'error');
    } finally {
      setWifiConnecting(false);
    }
  };

  useEffect(() => {
    if (step !== 'wifi' || !wifiDeviceId) return;
    let cancelled = false;
    setWifiLink('loading');
    setWifiConnectedSsid(undefined);
    void fetchWifiLinkState(wifiDeviceId).then((r) => {
      if (cancelled) return;
      setWifiConnectedSsid(r.connectedSsid);
      if (r.state === 'up') setWifiLink('up');
      else if (r.state === 'down') setWifiLink('down');
      else setWifiLink('unknown');
    });
    setWifiScanning(true);
    fetchDeviceWifiList(wifiDeviceId)
      .then((res) => {
        const names = res.wifiNames?.filter(Boolean) || [];
        if (!cancelled) setWifiList(names);
        if (!cancelled && !res.ok && res.errorHint) {
          addToast(res.errorHint, 'warning');
        } else if (!cancelled && !res.ok && names.length === 0) {
          addToast(t('wifiModal.toast.scanFail', '扫描 WiFi 失败'), 'warning');
        }
      })
      .catch(() => {
        addToast(t('wifiModal.toast.scanFail', '扫描 WiFi 失败'), 'warning');
      })
      .finally(() => {
        if (!cancelled) setWifiScanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, wifiDeviceId, addToast, t]);

  if (!showAddDevice) return null;
  const stepIndex = step === 'method' ? 0 : step === 'configure' ? 1 : step === 'verify' ? 2 : 3;
  const stepLabels = [
    t('addDevice.step.method', '连接方式'),
    t('addDevice.step.configure', '配置'),
    t('addDevice.step.verify', '验证'),
    t('addDevice.step.wifi', 'WiFi'),
  ];

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-content add-device-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">{t('addDevice.title', '添加设备')}</div>
            <div className="modal-subtitle">
              {step === 'method' && t('addDevice.sub.method', '选择连接方式')}
              {step === 'configure' && (method === 'manual' ? t('addDevice.sub.configureSsh', '配置 SSH 连接') : method === 'typec' ? t('addDevice.sub.typec', 'TypeC 闪连配置') : t('addDevice.sub.usbSerial', 'USB 串口调试'))}
              {step === 'verify' && t('addDevice.sub.verify', '验证连接')}
              {step === 'wifi' && t('addDevice.sub.wifi', 'WiFi 无线网络')}
            </div>
          </div>
          <button className="btn-icon" onClick={close} title={t('addDevice.close', '关闭弹窗')} aria-label={t('addDevice.close', '关闭弹窗')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Step indicator（USB 串口仅一页说明，不展示三步） */}
        {!(method === 'usb' && step === 'configure') && (
          <div className="add-device-steps">
            {stepLabels.map((label, i) => (
              <div key={label} className={`add-device-step ${i < stepIndex ? 'done' : i === stepIndex ? 'active' : ''}`}>
                <span className="add-device-step-num">
                  {i < stepIndex ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg> : i + 1}
                </span>
                <span className="add-device-step-label">{label}</span>
                {i < stepLabels.length - 1 && <span className="add-device-step-line" />}
              </div>
            ))}
          </div>
        )}

        {/* Step 1: Method */}
        {step === 'method' && (
          <div className="modal-body">
            <div className="add-device-methods">
              <button type="button" className="add-device-method-card" onClick={() => goToConfigure('manual')}>
                <div className="add-device-method-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.55a11 11 0 0114 0"/><path d="M1.42 9a16 16 0 0121.16 0"/>
                    <path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/>
                  </svg>
                </div>
                <div className="add-device-method-body">
                  <strong>{t('addDevice.method.ssh.title', 'SSH 网络连接')}</strong>
                  <span>{t('addDevice.method.ssh.desc', '通过有线/WiFi 远程连接，输入 IP 地址即可')}</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>

              {/* TypeC 闪连 */}
              <button type="button" className="add-device-method-card" onClick={() => goToConfigure('typec')}>
                <div className="add-device-method-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v6"/><path d="M9 8h6"/><rect x="7" y="8" width="10" height="4" rx="2"/>
                    <path d="M12 12v2"/><path d="M8 14h8v4a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4z"/>
                    <circle cx="10" cy="17" r="0.5" fill="var(--accent)"/><circle cx="14" cy="17" r="0.5" fill="var(--accent)"/>
                  </svg>
                </div>
                <div className="add-device-method-body">
                  <strong>{t('addDevice.method.typec.title', 'TypeC 闪连')}</strong>
                  <span>{t('addDevice.method.typec.desc', '通过 USB Type-C 线缆直连 RDK X5，无需网络')}</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>

              <button
                type="button"
                className={`add-device-method-card${isDesktopMac() ? ' add-device-method-card--disabled' : ''}`}
                disabled={isDesktopMac()}
                onClick={() => {
                  if (!isDesktopMac()) goToConfigure('usb');
                }}
                title={isDesktopMac() ? t('addDevice.usb.macUnavailableTitle', 'macOS 桌面版暂不支持 USB 串口') : undefined}
              >
                <div className="add-device-method-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 18v-6"/><path d="M8 18v-2"/><path d="M16 18v-4"/>
                    <rect x="6" y="18" width="4" height="4" rx="1"/><rect x="14" y="18" width="4" height="4" rx="1"/>
                    <circle cx="12" cy="8" r="2"/><path d="M12 2v4"/>
                  </svg>
                </div>
                <div className="add-device-method-body">
                  <div className="add-device-method-usb-title-row">
                    <strong>{t('addDevice.method.usb.title', 'USB 串口调试')}</strong>
                    {isDesktopMac() && (
                      <span className="badge badge-muted add-device-mac-badge">{t('addDevice.usb.macBadge', 'Mac 暂不支持')}</span>
                    )}
                  </div>
                  <span>{t('addDevice.method.usb.desc', '本机串口控制台（Web Serial），不添加网络设备')}</span>
                </div>
                {!isDesktopMac() && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                )}
              </button>
            </div>
            <div className="add-device-support-hint">
              {t('addDevice.supportHint', '支持 RDK X3 / X5 / S100 / Ultra 全系列开发者套件')}
            </div>
          </div>
        )}

        {/* Step 2: Configure */}
        {step === 'configure' && (
          <div className="modal-body">
            {method === 'manual' ? (
              <div className="add-device-form">
                <div className="add-device-field">
                  <label>{t('addDevice.label.ip', 'IP 地址')}</label>
                  <input className="input" placeholder="192.168.1.100" value={newDeviceIp} onChange={e => setNewDeviceIp(e.target.value)} autoFocus />
                </div>
                <div className="add-device-field-row">
                  <div className="add-device-field">
                    <label>{t('addDevice.label.user', '用户名')}</label>
                    <input className="input" value={sshUser} onChange={e => setSshUser(e.target.value)} title={t('addDevice.title.sshUser', 'SSH 用户名')} />
                  </div>
                  <div className="add-device-field">
                    <label>{t('addDevice.label.pass', '密码')}</label>
                    <div className="add-device-pass-wrap">
                      <input className="input" type={showPass ? 'text' : 'password'} value={sshPass} onChange={e => setSshPass(e.target.value)} title={t('addDevice.title.sshPass', 'SSH 密码')} />
                      <button type="button" className="btn-icon add-device-pass-toggle" onClick={() => setShowPass(v => !v)} title={showPass ? t('addDevice.pass.hide', '隐藏密码') : t('addDevice.pass.show', '显示密码')} aria-label={showPass ? t('addDevice.pass.hide', '隐藏密码') : t('addDevice.pass.show', '显示密码')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          {showPass ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="add-device-field-row">
                  <div className="add-device-field">
                    <label>{t('addDevice.label.sshPort', 'SSH 端口')}</label>
                    <input className="input" value={sshPort} onChange={e => setSshPort(e.target.value)} title={t('addDevice.label.sshPort', 'SSH 端口')} />
                  </div>
                  <div className="add-device-field">
                    <label>{t('addDevice.label.alias', '设备别名（可选）')}</label>
                    <input className="input" placeholder={t('addDevice.ph.aliasManual', '如 RDK X5 工位3')} value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)} />
                  </div>
                </div>
                <div className="add-device-presets">
                  <span className="add-device-presets-label">{t('addDevice.presets', '快捷填充：')}</span>
                  <button type="button" className="chip" onClick={() => setNewDeviceIp('192.168.127.10')}>{t('addDevice.preset.wiredIp', '有线默认 IP')}</button>
                </div>

                <p className="add-device-wifi-hint" style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                  {t('addDevice.wifiAfterVerifyHint', '验证 SSH 成功后，将引导您检查套件端 WiFi 连接。')}
                </p>
              </div>
            ) : method === 'typec' ? (
              /* ── TypeC 闪连配置 ── */
              <div className="add-device-form add-device-typec-form">
                <p className="add-device-typec-lead">
                  {t('addDevice.typec.lead', '通过 USB Type-C 线缆在 PC 和 RDK X5 之间建立虚拟以太网链路，自动配置 IP 并通过 SSH 连接设备。')}
                </p>
                <div className="add-device-typec-steps">
                  <div className="add-device-usb-step"><span className="add-device-usb-num">1</span>{t('addDevice.typec.step1', '用 Type-C 线连接 PC 与 RDK X5 的 Type-C 口')}</div>
                  <div className="add-device-usb-step"><span className="add-device-usb-num">2</span>{t('addDevice.typec.step2', '选择 TypeC 虚拟网卡，点击「开始闪连」')}</div>
                </div>

                <div className="add-device-field" style={{ marginTop: 12 }}>
                  <label>{t('addDevice.typec.selectLabel', '选择 TypeC 虚拟网卡')}</label>
                  {loadingInterfaces ? (
                    <div className="add-device-typec-loading">
                      <div className="spinner spinner-sm" />
                      <span>{t('addDevice.typec.loading', '正在获取网卡列表...')}</span>
                    </div>
                  ) : (
                    <div className="add-device-typec-nic-list">
                      {typecInterfaces.length === 0 ? (
                        <div className="add-device-typec-empty">
                          {t('addDevice.typec.noNic', '未检测到网络接口，请确认 Type-C 线缆已连接')}
                          <button type="button" className="btn btn-ghost btn-sm" onClick={loadTypecInterfaces} style={{ marginTop: 8 }}>
                            {t('addDevice.typec.refresh', '刷新')}
                          </button>
                        </div>
                      ) : (
                        <>
                          {typecInterfaces.map((iface) => (
                            <button
                              key={iface.name}
                              type="button"
                              className={`add-device-typec-nic-item${selectedInterface === iface.name ? ' selected' : ''}`}
                              onClick={() => setSelectedInterface(iface.name)}
                            >
                              <div className="add-device-typec-nic-name">
                                {iface.name}
                                {iface.portType && <span className="add-device-typec-nic-port-type">{iface.portType}</span>}
                              </div>
                              <div className="add-device-typec-nic-detail">
                                {iface.addresses.length > 0 ? iface.addresses.join(', ') : t('addDevice.typec.noIp', '未分配 IP')}
                                {iface.mac ? ` · ${iface.mac}` : ''}
                              </div>
                            </button>
                          ))}
                          <button type="button" className="btn btn-ghost btn-sm" onClick={loadTypecInterfaces} style={{ marginTop: 4 }}>
                            {t('addDevice.typec.refresh', '刷新')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="add-device-typec-ip-info">
                  <span className="add-device-typec-ip-label">{t('addDevice.typec.ipScheme', 'IP 方案：')}</span>
                  <span>PC {TYPEC_PC_IP} ↔ RDK {TYPEC_DEVICE_IP}</span>
                </div>

                {typecConfiguring && (
                  <div className="add-device-typec-progress">
                    <div className="spinner spinner-sm" />
                    <span>{t('addDevice.typec.configuring', '正在配置网卡 IP...')}</span>
                  </div>
                )}

                <div className="add-device-field">
                  <label>{t('addDevice.label.alias', '设备别名（可选）')}</label>
                  <input className="input" placeholder="RDK X5 (闪连)" value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="add-device-form add-device-usb-serial-only">
                <p className="add-device-usb-serial-lead">{t('addDevice.usb.lead', '与常见串口助手、Arduino 串口监视器类似：数据仅在浏览器与本机 USB 转串口芯片之间传输，不经过 RDK Studio 服务器的 SSH。')}</p>
                <ul className="add-device-usb-serial-list">
                  <li>{t('addDevice.usb.bullet1', '用于查看 U-Boot/内核日志、首次配网等；端口与波特率在终端内通过系统选择器与工具栏设置。')}</li>
                  <li>{t('addDevice.usb.bullet2', '需要远程文件、OpenClaw、AI 等功能时，请在设备接入局域网后使用「SSH 网络」添加设备。')}</li>
                </ul>
                <div className="add-device-usb-steps">
                  <div className="add-device-usb-step"><span className="add-device-usb-num">1</span>{t('addDevice.usb.step1', '将调试线连接到 RDK 调试口')}</div>
                  <div className="add-device-usb-step"><span className="add-device-usb-num">2</span>{t('addDevice.usb.step2', '确认 PC 已识别串口驱动 (CP210X / CH340)')}</div>
                </div>
                <div className="add-device-usb-driver-links">
                  <span className="add-device-usb-driver-links-label">{t('addDevice.usb.driverLinksLabel', '串口驱动（与资源中心一致，直链）：')}</span>
                  <a href={RDK_DRIVER_CP210X_USB2UART_ZIP} target="_blank" rel="noreferrer" className="add-device-external-link">
                    {t('addDevice.usb.driverCp210x', 'CP210x USB2UART')}
                  </a>
                  <span className="add-device-usb-driver-links-sep"> · </span>
                  <a href={RDK_DRIVER_CH34X_WINDOWS_ZIP} target="_blank" rel="noreferrer" className="add-device-external-link">
                    {t('addDevice.usb.driverCh340', 'CH340（CH34x 安装包）')}
                  </a>
                  <span className="add-device-usb-driver-links-sep"> · </span>
                  <a href={RDK_DEVELOPER_RESOURCE_URL} target="_blank" rel="noreferrer" className="add-device-external-link">
                    {t('addDevice.usb.driverMore', '更多资源')}
                  </a>
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => { setStep('method'); setTypecStep('select-nic'); setTypecConfiguring(false); }}>{t('addDevice.back', '返回')}</button>
              {method === 'manual' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={goToVerify}
                  disabled={!newDeviceIp.trim() || !sshPass.trim()}
                >
                  {t('addDevice.next', '下一步')}
                </button>
              ) : method === 'typec' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={configureAndConnectTypec}
                  disabled={!selectedInterface || typecConfiguring}
                >
                  {typecConfiguring ? t('addDevice.typec.busy', '配置中...') : t('addDevice.typec.start', '开始闪连')}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={openUsbSerialDebug}>
                  {t('addDevice.usb.openTerminal', '打开串口终端')}
                </button>
              )}
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
                  <div className="verify-status-title">{t('addDevice.verify.running', '正在验证连接...')}</div>
                  <div className="verify-status-detail">
                    {tf('addDevice.verify.detailSsh', '连接 {{ip}}:{{port}}...', { ip: newDeviceIp, port: sshPort })}
                  </div>
                </>
              )}
              {!verifying && verifyOk && (
                <>
                  <div className="verify-status-icon ok">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div className="verify-status-title">{t('addDevice.verify.ok', '连接成功')}</div>
                  <div className="verify-info-grid">
                    <div className="verify-info-item"><span className="verify-info-label">{t('addDevice.verify.label.device', '设备')}</span><strong>{newDeviceName || t('addDevice.deviceDefault', 'RDK Device')}</strong></div>
                    <div className="verify-info-item"><span className="verify-info-label">{t('addDevice.verify.label.ip', 'IP')}</span><strong>{newDeviceIp}</strong></div>
                    <div className="verify-info-item"><span className="verify-info-label">{t('addDevice.verify.label.user', '用户')}</span><strong>{sshUser}</strong></div>
                    <div className="verify-info-item"><span className="verify-info-label">{t('addDevice.verify.label.port', '端口')}</span><strong>{sshPort}</strong></div>
                  </div>
                </>
              )}
              {!verifying && !verifyOk && (
                <>
                  <div className="verify-status-icon fail">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </div>
                  <div className="verify-status-title">{t('addDevice.verify.fail', '连接失败')}</div>
                  <div className="verify-status-detail">{t('addDevice.verify.failDetail', '请检查 IP 地址、用户名、密码，以及设备是否通电在线。')}</div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setStep('configure'); setVerifyOk(false); }} disabled={registering}>{t('addDevice.back', '返回')}</button>
              <button
                className="btn btn-primary"
                onClick={verifyOk ? goToWifiAfterVerify : (method === 'typec' ? configureAndConnectTypec : goToVerify)}
                disabled={verifying || registering}
              >
                {verifying
                  ? t('addDevice.verify.busy', '验证中...')
                  : registering
                    ? t('addDevice.wifi.registering', '正在加入工作区...')
                    : verifyOk
                      ? t('addDevice.wifi.next', '下一步：WiFi 网络')
                      : t('addDevice.retry', '重试')}
              </button>
            </div>
          </div>
        )}

        {step === 'wifi' && wifiDeviceId && (
          <div className="modal-body add-device-wifi-step">
            <p className="add-device-typec-lead">
              {t('addDevice.wifi.lead', '请连接设备 WiFi')}
            </p>
            <div
              className="add-device-wifi-status-banner"
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                marginBottom: 12,
                fontSize: 13,
                background:
                  wifiLink === 'up'
                    ? 'rgba(34, 197, 94, 0.12)'
                    : wifiLink === 'down'
                      ? 'rgba(251, 191, 36, 0.12)'
                      : 'var(--surface-2)',
                border: '1px solid var(--border)',
              }}
            >
              {wifiLink === 'loading' && <span>{t('addDevice.wifi.probing', '正在检测套件端 WiFi 状态…')}</span>}
              {wifiLink === 'up' && (
                <span>
                  {wifiConnectedSsid
                    ? tf('addDevice.wifi.connectedSsid', '已检测到 WiFi 已连接：{{ssid}}', { ssid: wifiConnectedSsid })
                    : t('addDevice.wifi.connected', '已检测到 WiFi 已连接')}
                </span>
              )}
              {wifiLink === 'down' && <span>{t('addDevice.wifi.notConnected', '未检测到 WiFi 连接，可在下方选择网络并连接')}</span>}
              {wifiLink === 'unknown' && <span>{t('addDevice.wifi.unknown', '无法自动判断 WiFi 状态，可手动连接或跳过')}</span>}
            </div>

            {(wifiList.length > 0 || wifiScanning) && (
              <div className="wifi-list-section">
                <div className="wifi-list-header">
                  <span className="wifi-list-title">
                    {t('wifiModal.networks', '可用网络')}
                    {wifiList.length > 0 ? ` (${wifiList.length})` : ''}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={scanWifiOnDevice} disabled={wifiScanning}>
                    {wifiScanning ? t('wifiModal.scanning', '扫描中...') : t('wifiModal.refresh', '刷新')}
                  </button>
                </div>
                {wifiScanning && wifiList.length === 0 ? (
                  <div className="wifi-list-loading"><div className="spinner" /><span>{t('wifiModal.scanningList', '正在扫描...')}</span></div>
                ) : (
                  <div className="wifi-list-items">
                    {wifiList.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className={`wifi-list-item ${wifiSsid === name ? 'selected' : ''}`}
                        onClick={() => setWifiSsid(name)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={wifiSsid === name ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth="2">
                          <path d="M5 12.55a11 11 0 0114.08 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/>
                        </svg>
                        <span className="wifi-list-item-name">{name}</span>
                        {wifiConnectedSsid && name === wifiConnectedSsid && (
                          <span className="wifi-list-item-current" title={t('addDevice.wifi.currentAp', '当前已连接')}>
                            {t('addDevice.wifi.currentApShort', '已连接')}
                          </span>
                        )}
                        {wifiSsid === name && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {wifiList.length === 0 && !wifiScanning && (
              <div className="wifi-list-empty" style={{ marginBottom: 12 }}>
                <span>{t('wifiModal.empty', '未扫描到可用网络')}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={scanWifiOnDevice}>{t('wifiModal.retry', '重试')}</button>
              </div>
            )}

            <div className="wifi-form">
              <div className="add-device-field">
                <label>{t('wifiModal.ssid', 'WiFi 名称 (SSID)')}</label>
                <input className="input" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} placeholder={t('wifiModal.ssidPh', '输入或从上方选择')} />
              </div>
              <div className="add-device-field">
                <label>{t('wifiModal.password', '密码')}</label>
                <div className="add-device-pass-wrap">
                  <input className="input" type={showWifiPass ? 'text' : 'password'} value={wifiPass} onChange={e => setWifiPass(e.target.value)} placeholder={t('wifiModal.passwordPh', '无密码可留空')} />
                  <button type="button" className="btn-icon add-device-pass-toggle" onClick={() => setShowWifiPass(v => !v)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {showWifiPass ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {wifiConnectLog && (
              <pre className="wifi-connect-log">{wifiConnectLog}</pre>
            )}

            <div className="wifi-hint" style={{ marginBottom: 12 }}>{t('wifiModal.hint', '连接时可能短暂断开当前 SSH 连接，请耐心等待设备重连。')}</div>

            <div className="modal-footer" style={{ padding: 0, borderTop: 'none', justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={handleWifiConnect} disabled={!wifiSsid.trim() || wifiConnecting}>
                {wifiConnecting ? t('wifiModal.connecting', '连接中...') : t('wifiModal.connect', '连接网络')}
              </button>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={finishAddDeviceFlow}>{t('addDevice.wifi.skipLater', '跳过，稍后配置')}</button>
              <button type="button" className="btn btn-primary" onClick={finishAddDeviceFlow}>{t('addDevice.wifi.done', '完成')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
