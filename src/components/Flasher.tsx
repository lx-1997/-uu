import { useState, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { FLASH_IMAGES, STORAGE_TARGETS } from '../constants';
import { flashCheck, flashDownload, flashWrite, flashVerify, getRememberedDevicePassword } from '../api';

/* ═══════════════════════════════════════════════════════
   RDK 镜像烧录 — 真实设备操作
   支持两种模式：
   1. 网络烧录：设备在线时，通过 SSH 在设备上下载镜像并写入
   2. 本地烧录：引导用户使用 balenaEtcher 等工具写入 SD 卡
   ═══════════════════════════════════════════════════════ */

// 官方镜像下载地址映射
const IMAGE_URLS: Record<string, string> = {
  'ubuntu-22.04': 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/desktop/rdk-x5-ubuntu22-desktop-v1.0.0.img.xz',
  'ros2-humble': 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/server/rdk-x5-ubuntu22-server-ros2-v1.0.0.img.xz',
  'tros-ai': 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/server/rdk-x5-ubuntu22-server-tros-v1.0.0.img.xz',
};

type FlashStep = 'check' | 'image' | 'target' | 'wifi' | 'flash' | 'progress' | 'verify' | 'done';
type FlashMode = 'network' | 'local';

interface DeviceInfo {
  version: string;
  board: string;
  hasHbupdate: boolean;
  storage: string;
}

export default function Flasher() {
  const {
    currentDevice, flashImage, setFlashImage, flashTarget, setFlashTarget,
    flashPhase, startFlash,
    setActiveTab, addToast, devices
  } = useAppState();

  const deviceId = currentDevice?.id ?? '';
  const pw = getRememberedDevicePassword(deviceId);

  const [step, setStep] = useState<FlashStep>('check');
  const [flashMode, setFlashMode] = useState<FlashMode>('network');
  const [wifiName, setWifiName] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [error, setError] = useState('');

  const steps = ['环境检测', '选镜像', '选介质', 'WiFi 预配', '执行烧录', '验证'];
  const stepKeys: FlashStep[] = ['check', 'image', 'target', 'wifi', 'flash', 'verify'];
  const currentIdx = stepKeys.indexOf(step === 'done' ? 'verify' : step === 'progress' ? 'flash' : step);

  const selectedImage = FLASH_IMAGES.find(i => i.id === flashImage);
  const selectedTarget = STORAGE_TARGETS.find(t => t.id === flashTarget);

  const appendLog = (msg: string) => setLogs(ls => [...ls, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  // Step 1: 检测设备环境
  const runCheck = useCallback(async () => {
    if (!deviceId) { setError('请先连接设备'); return; }
    setLoading(true); setError(''); setLogs([]);
    appendLog('正在检测设备环境...');
    try {
      const res = await flashCheck(deviceId, pw);
      if (res.ok) {
        const output = res.output;
        const version = output.match(/===VERSION===([\s\S]*?)===STORAGE===/)?.[1]?.trim() || 'unknown';
        const board = output.match(/===BOARD===([\s\S]*?)===HBUPDATE===/)?.[1]?.trim() || 'unknown';
        const hasHbupdate = output.includes('hbupdate-available');
        const storage = output.match(/===STORAGE===([\s\S]*?)===EMMC===/)?.[1]?.trim() || '';
        setDeviceInfo({ version, board, hasHbupdate, storage });
        appendLog(`设备型号: ${board}`);
        appendLog(`当前系统: ${version}`);
        appendLog(`hbupdate: ${hasHbupdate ? '可用' : '不可用'}`);
        appendLog('环境检测完成');
        setStep('image');
      } else {
        setError('设备检测失败');
      }
    } catch (e: any) {
      setError(e.message || '检测失败');
      appendLog(`错误: ${e.message}`);
    }
    setLoading(false);
  }, [deviceId, pw]);

  // Step 5: 执行烧录
  const runFlash = useCallback(async () => {
    if (!deviceId) return;
    setStep('progress'); setLoading(true); setError('');

    if (flashMode === 'network') {
      // 网络模式：在设备上下载镜像并写入
      const imageUrl = flashImage === 'local' ? customUrl : IMAGE_URLS[flashImage] || '';
      if (!imageUrl) { setError('无效的镜像地址'); setLoading(false); return; }

      appendLog('开始下载镜像到设备...');
      appendLog(`URL: ${imageUrl}`);
      try {
        const dlRes = await flashDownload(deviceId, imageUrl, '/tmp/rdk_image.img', pw);
        appendLog(dlRes.output?.slice(0, 200) || '下载完成');

        appendLog(`开始写入到 ${selectedTarget?.label || flashTarget}...`);
        const wrRes = await flashWrite(deviceId, '/tmp/rdk_image.img', flashTarget, pw);
        appendLog(wrRes.output?.slice(0, 200) || '写入完成');

        if (wrRes.ok) {
          appendLog('烧录完成，开始验证...');
          setStep('verify');
        } else {
          setError('写入失败');
        }
      } catch (e: any) {
        setError(e.message || '烧录失败');
        appendLog(`错误: ${e.message}`);
      }
    } else {
      // 本地模式：引导用户手动操作
      appendLog('本地烧录模式 — 请按照以下步骤操作：');
      appendLog('1. 下载官方镜像到本地电脑');
      appendLog('2. 使用 balenaEtcher 或 rpi-imager 写入 SD 卡');
      appendLog('3. 将 SD 卡插入设备并上电');
      appendLog('4. 等待设备启动后点击"验证"');
      setStep('verify');
    }
    setLoading(false);
  }, [deviceId, pw, flashImage, flashTarget, flashMode, customUrl, selectedTarget]);

  // Step 6: 验证
  const runVerify = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true); setError('');
    appendLog('正在验证烧录结果...');
    try {
      const res = await flashVerify(deviceId, pw);
      appendLog(res.output?.slice(0, 300) || '验证完成');
      if (res.ok) {
        appendLog('✅ 系统验证通过');
        startFlash();
        setStep('done');
        addToast('镜像烧录验证通过', 'success');
      }
    } catch (e: any) {
      appendLog(`验证失败: ${e.message}`);
      setError('验证失败，设备可能需要重启');
    }
    setLoading(false);
  }, [deviceId, pw, startFlash, addToast]);

  return (
    <div className="center-stage">
      {devices.length === 0 && (
        <div style={{ width: '100%', maxWidth: 640, marginBottom: 16 }}>
          <button className="ob-btn ghost" style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            onClick={() => setActiveTab('dashboard')}>← 返回新手指引</button>
        </div>
      )}
      <div className="ob-wizard" style={{ maxWidth: 640 }}>
        {/* Progress */}
        <div className="ob-progress">
          {steps.map((s, i) => (
            <div key={s} className={`ob-prog-item ${currentIdx === i ? 'active' : ''} ${currentIdx > i || step === 'done' ? 'done' : ''}`}>
              <div className="ob-prog-dot">{currentIdx > i || step === 'done' ? '✓' : i + 1}</div>
              <span>{s}</span>
            </div>
          ))}
        </div>

        {/* Step 1: 环境检测 */}
        {step === 'check' && (
          <>
            <h2 className="ob-heading">设备环境检测</h2>
            <p className="ob-sub">检测当前设备的系统版本、存储空间和烧录工具可用性</p>
            {!currentDevice ? (
              <div className="warning-banner">⚠ 请先在左侧连接一台 RDK 设备</div>
            ) : (
              <>
                <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>设备</span>
                    <strong>{currentDevice.name} ({currentDevice.ip})</strong>
                  </div>
                </div>
                {deviceInfo && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: '0.78rem', color: '#16a34a' }}>
                      ✅ 设备型号: {deviceInfo.board} · 系统: {deviceInfo.version.slice(0, 40)}
                    </div>
                  </div>
                )}
                {error && <div className="warning-banner">⚠ {error}</div>}
                <div className="ai-recommend-strip" style={{ marginBottom: 0 }}>
                  <span className="ai-suggest-label">🤖 AI 建议</span>
                  <span className="ai-recommend-text">建议先检测设备环境，确认存储空间和工具链可用性</span>
                </div>
              </>
            )}
            <div className="ob-nav">
              <div />
              <button className="ob-btn primary" disabled={!currentDevice || loading}
                onClick={runCheck}>{loading ? '检测中...' : '开始检测 →'}</button>
            </div>
          </>
        )}

        {/* Step 2: 选镜像 */}
        {step === 'image' && (
          <>
            <h2 className="ob-heading">选择系统镜像</h2>
            <div className="ai-recommend-strip" style={{ marginBottom: 0 }}>
              <span className="ai-suggest-label">🤖 AI 推荐</span>
              <span className="ai-recommend-text">
                {deviceInfo?.board?.includes('X5') ? '推荐 ROS2 Humble 预装版，已适配 RDK X5' : '推荐 Ubuntu 22.04 LTS 基础版'}
              </span>
              <button className="clean-btn outline-btn sm-btn" onClick={() => {
                setFlashImage(deviceInfo?.board?.includes('X5') ? 'ros2-humble' : 'ubuntu-22.04');
                addToast('已选择 AI 推荐镜像', 'success');
              }}>采纳</button>
            </div>
            <div className="option-list" style={{ gap: 8 }}>
              {FLASH_IMAGES.map(img => (
                <button key={img.id} className={`select-card ${flashImage === img.id ? 'active' : ''}`}
                  onClick={() => setFlashImage(img.id)}>
                  <strong>{img.label}</strong>
                  <span>{img.detail}</span>
                </button>
              ))}
            </div>
            {flashImage === 'local' && (
              <div style={{ padding: '8px 12px' }}>
                <label style={{ fontSize: '0.78rem', color: '#475569', display: 'block', marginBottom: 4 }}>自定义镜像 URL</label>
                <input className="clean-input" style={{ width: '100%' }} placeholder="https://..." value={customUrl}
                  onChange={e => setCustomUrl(e.target.value)} />
              </div>
            )}
            {/* 烧录模式选择 */}
            <div style={{ padding: '8px 12px', background: '#f0f9ff', borderRadius: 8, fontSize: '0.78rem' }}>
              <div style={{ marginBottom: 6, color: '#1e40af', fontWeight: 600 }}>烧录模式</div>
              <label className="toggle-row" style={{ marginBottom: 4 }}>
                <input type="radio" name="flashMode" checked={flashMode === 'network'}
                  onChange={() => setFlashMode('network')} />
                <span>网络烧录 — 设备在线下载镜像并写入（推荐）</span>
              </label>
              <label className="toggle-row">
                <input type="radio" name="flashMode" checked={flashMode === 'local'}
                  onChange={() => setFlashMode('local')} />
                <span>本地烧录 — 使用 balenaEtcher 写入 SD 卡后插入设备</span>
              </label>
            </div>
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('check')}>← 返回</button>
              <button className="ob-btn primary" disabled={!flashImage || (flashImage === 'local' && !customUrl.trim())}
                onClick={() => setStep('target')}>下一步 →</button>
            </div>
          </>
        )}

        {/* Step 3: 选介质 */}
        {step === 'target' && (
          <>
            <h2 className="ob-heading">选择写入介质</h2>
            <p className="ob-sub">镜像将写入到以下存储介质，原有数据会被覆盖</p>
            <div className="option-list" style={{ gap: 8 }}>
              {STORAGE_TARGETS.map(t => (
                <button key={t.id} className={`select-card ${flashTarget === t.id ? 'active' : ''}`}
                  onClick={() => setFlashTarget(t.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{t.label}</strong>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{t.path}</span>
                  </div>
                  <span>{t.safe}</span>
                </button>
              ))}
            </div>
            {flashTarget === 'emmc' && (
              <div className="warning-banner">⚠ eMMC 写入不可逆，请确认已备份重要数据</div>
            )}
            {deviceInfo?.storage && (
              <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 8, fontSize: '0.75rem', color: '#475569' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>设备存储信息：</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.72rem' }}>{deviceInfo.storage.slice(0, 200)}</pre>
              </div>
            )}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('image')}>← 返回</button>
              <button className="ob-btn primary" disabled={!flashTarget} onClick={() => setStep('wifi')}>下一步 →</button>
            </div>
          </>
        )}

        {/* Step 4: WiFi 预配 */}
        {step === 'wifi' && (
          <>
            <h2 className="ob-heading">预配置 WiFi（可选）</h2>
            <p className="ob-sub">提前写入 WiFi 信息，开机后自动连接网络</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#475569', display: 'block', marginBottom: 4 }}>WiFi 名称</label>
                <input className="clean-input" style={{ width: '100%' }} placeholder="例如: MyHome-5G"
                  value={wifiName} onChange={e => setWifiName(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#475569', display: 'block', marginBottom: 4 }}>WiFi 密码</label>
                <input className="clean-input" style={{ width: '100%' }} type="password" placeholder="留空则不预配置"
                  value={wifiPass} onChange={e => setWifiPass(e.target.value)} />
              </div>
            </div>
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('target')}>← 返回</button>
              <button className="ob-btn primary" onClick={() => setStep('flash')}>
                {wifiName ? '下一步 →' : '跳过，直接烧录 →'}
              </button>
            </div>
          </>
        )}

        {/* Step 5: 确认并执行 */}
        {step === 'flash' && (
          <>
            <h2 className="ob-heading">确认烧录配置</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>镜像</span><strong>{selectedImage?.label}</strong>
                </div>
              </div>
              <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>写入到</span><strong>{selectedTarget?.label} ({selectedTarget?.path})</strong>
                </div>
              </div>
              <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>模式</span><strong>{flashMode === 'network' ? '网络烧录' : '本地烧录'}</strong>
                </div>
              </div>
              {wifiName && (
                <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>WiFi</span><strong>{wifiName}</strong>
                  </div>
                </div>
              )}
            </div>
            {flashMode === 'network' && (
              <div className="warning-banner">⚠ 网络烧录将在设备上执行，过程中设备可能重启，请确保电源稳定</div>
            )}
            {error && <div className="warning-banner">⚠ {error}</div>}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('wifi')}>← 返回</button>
              <button className="ob-btn primary" disabled={loading} onClick={runFlash}>
                {loading ? '执行中...' : '🔥 开始烧录'}
              </button>
            </div>
          </>
        )}

        {/* Progress */}
        {step === 'progress' && (
          <>
            <h2 className="ob-heading">烧录进行中...</h2>
            <div style={{ padding: '10px', background: '#1e1e1e', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
              {logs.map((l, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#d4d4d4', lineHeight: 1.6 }}>{l}</div>
              ))}
            </div>
            {loading && <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>⏳ 请耐心等待...</div>}
          </>
        )}

        {/* Step 6: 验证 */}
        {step === 'verify' && (
          <>
            <h2 className="ob-heading">验证烧录结果</h2>
            <div style={{ padding: '10px', background: '#1e1e1e', borderRadius: 8, maxHeight: 160, overflowY: 'auto' }}>
              {logs.map((l, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#d4d4d4', lineHeight: 1.6 }}>{l}</div>
              ))}
            </div>
            {error && <div className="warning-banner">⚠ {error}</div>}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('flash')}>← 返回</button>
              <button className="ob-btn primary" disabled={loading} onClick={runVerify}>
                {loading ? '验证中...' : '✅ 验证系统'}
              </button>
            </div>
          </>
        )}

        {/* Done */}
        {step === 'done' && (
          <>
            <h2 className="ob-heading">🎉 烧录完成</h2>
            <p className="ob-sub">系统已写入成功，设备已验证通过</p>
            <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 10, fontSize: '0.78rem', color: '#16a34a', textAlign: 'center' }}>
              {flashPhase || '下一步: 打开终端进行首次配置 → 验证 BPU → 部署模型'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="clean-btn" onClick={() => { setActiveTab('terminal'); addToast('已跳转到终端', 'info'); }}>💻 打开终端</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('hardware'); addToast('已跳转到硬件检测', 'info'); }}>📊 硬件检测</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('ros'); addToast('已跳转到 ROS', 'info'); }}>🤖 ROS 可视化</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
