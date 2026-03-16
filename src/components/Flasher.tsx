import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { FLASH_IMAGES, STORAGE_TARGETS } from '../constants';

export default function Flasher() {
  const {
    currentDevice, flashImage, setFlashImage, flashTarget, setFlashTarget,
    flashPhase, startFlash,
    setActiveTab, addToast, devices
  } = useAppState();

  const [step, setStep] = useState<'image' | 'target' | 'wifi' | 'flash' | 'done'>('image');
  const [wifiName, setWifiName] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [confirmWritten, setConfirmWritten] = useState(false);
  const [confirmVerified, setConfirmVerified] = useState(false);

  const steps = ['选镜像', '选介质', 'WiFi 预配', '烧录'];
  const stepKeys = ['image', 'target', 'wifi', 'flash'] as const;
  const currentIdx = stepKeys.indexOf(step === 'done' ? 'flash' : step);

  const selectedImage = FLASH_IMAGES.find(i => i.id === flashImage);
  const selectedTarget = STORAGE_TARGETS.find(t => t.id === flashTarget);

  return (
    <div className="center-stage">
      {devices.length === 0 && (
        <div style={{ width: '100%', maxWidth: 600, marginBottom: 16 }}>
          <button 
            className="ob-btn ghost" 
            style={{ padding: '6px 12px', fontSize: '0.85rem' }} 
            onClick={() => setActiveTab('dashboard')}
          >
            ← 返回新手指引
          </button>
        </div>
      )}
      <div className="ob-wizard" style={{ maxWidth: 600 }}>
        {/* Progress */}
        <div className="ob-progress">
          {steps.map((s, i) => (
            <div key={s} className={`ob-prog-item ${currentIdx === i ? 'active' : ''} ${currentIdx > i || step === 'done' ? 'done' : ''}`}>
              <div className="ob-prog-dot">{currentIdx > i || step === 'done' ? '✓' : i + 1}</div>
              <span>{s}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Select Image */}
        {step === 'image' && (
          <>
            <h2 className="ob-heading">为 {currentDevice?.name} 选择系统镜像</h2>
            <div className="ai-recommend-strip" style={{ marginBottom: 0 }}>
              <span className="ai-suggest-label">🤖 AI 推荐</span>
              <span className="ai-recommend-text">推荐 <strong>ROS2 Humble 预装版</strong>，已适配当前板卡</span>
              <button className="clean-btn outline-btn sm-btn" onClick={() => { setFlashImage('ros2-humble'); addToast('已选择 AI 推荐镜像', 'success'); }}>采纳</button>
            </div>
            <div className="option-list" style={{ gap: 8 }}>
              {FLASH_IMAGES.map(img => (
                <button key={img.id} className={`select-card ${flashImage === img.id ? 'active' : ''}`} onClick={() => setFlashImage(img.id)}>
                  <strong>{img.label}</strong>
                  <span>{img.detail}</span>
                </button>
              ))}
            </div>
            {selectedImage && (
              <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 8, fontSize: '0.78rem', color: '#475569' }}>
                已选: <strong>{selectedImage.label}</strong> · {selectedImage.detail}
              </div>
            )}
            <div style={{ padding: '8px 12px', background: '#fefce8', borderRadius: 8, fontSize: '0.75rem', color: '#92400e' }}>
              参考官方文档：<a href="https://developer.d-robotics.cc/rdk_doc/Quick_start" target="_blank" rel="noreferrer">快速开始 / 系统烧录</a>
            </div>
            <div className="ob-nav">
              <div />
              <button className="ob-btn primary" disabled={!flashImage} onClick={() => setStep('target')}>下一步 →</button>
            </div>
          </>
        )}

        {/* Step 2: Select Target */}
        {step === 'target' && (
          <>
            <h2 className="ob-heading">选择写入介质</h2>
            <p className="ob-sub">镜像将写入到以下存储介质，原有数据会被覆盖</p>
            <div className="option-list" style={{ gap: 8 }}>
              {STORAGE_TARGETS.map(t => (
                <button key={t.id} className={`select-card ${flashTarget === t.id ? 'active' : ''}`} onClick={() => setFlashTarget(t.id)}>
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
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('image')}>← 返回</button>
              <button className="ob-btn primary" disabled={!flashTarget} onClick={() => setStep('wifi')}>下一步 →</button>
            </div>
          </>
        )}

        {/* Step 3: WiFi Pre-config */}
        {step === 'wifi' && (
          <>
            <h2 className="ob-heading">预配置 WiFi（可选）</h2>
            <p className="ob-sub">提前写入 WiFi 信息，开机后自动连接网络</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#475569', display: 'block', marginBottom: 4 }}>WiFi 名称</label>
                <input className="clean-input" style={{ width: '100%' }} placeholder="例如: MyHome-5G" value={wifiName} onChange={e => setWifiName(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#475569', display: 'block', marginBottom: 4 }}>WiFi 密码</label>
                <input className="clean-input" style={{ width: '100%' }} type="password" placeholder="留空则不预配置" value={wifiPass} onChange={e => setWifiPass(e.target.value)} />
              </div>
            </div>
            <div style={{ padding: '8px 12px', background: '#f0f9ff', borderRadius: 8, fontSize: '0.78rem', color: '#1e40af' }}>
              💡 跳过也可以，开机后在终端或桌面中手动配置 WiFi
            </div>
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('target')}>← 返回</button>
              <button className="ob-btn primary" onClick={() => setStep('flash')}>{wifiName ? '下一步 →' : '跳过，直接烧录 →'}</button>
            </div>
          </>
        )}

        {/* Step 4: Flash */}
        {step === 'flash' && (
          <>
            <h2 className="ob-heading">执行真实烧录</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#94a3b8' }}>镜像</span><strong>{selectedImage?.label}</strong></div>
              </div>
              <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#94a3b8' }}>写入到</span><strong>{selectedTarget?.label} ({selectedTarget?.path})</strong></div>
              </div>
              {wifiName && (
                <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#94a3b8' }}>WiFi</span><strong>{wifiName}</strong></div>
                </div>
              )}
              <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.78rem', color: '#334155' }}>
                推荐流程：
                <div>1) 下载官方镜像并校验 SHA256</div>
                <div>2) 使用 balenaEtcher 或 rpi-imager 写入 {selectedTarget?.label}</div>
                <div>3) 首次启动后在设备端执行 rdkos_info / cat /etc/version</div>
              </div>
            </div>

            <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 10, marginTop: 10 }}>
              <div style={{ fontSize: '0.76rem', color: '#64748b', marginBottom: 6 }}>Windows PowerShell 示例：</div>
              <div className="terminal-screen" style={{ minHeight: 'auto', padding: '8px 10px' }}>
                <div className="terminal-line"># 仅示例：请按实际盘符操作，避免误写系统盘</div>
                <div className="terminal-line"># 建议优先使用 balenaEtcher 图形界面</div>
              </div>
            </div>

            <label className="toggle-row" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={confirmWritten} onChange={(e) => setConfirmWritten(e.target.checked)} />
              <span>我已完成镜像写入</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={confirmVerified} onChange={(e) => setConfirmVerified(e.target.checked)} />
              <span>我已在设备上验证版本与启动状态</span>
            </label>

            <button
              className="clean-btn"
              style={{ width: '100%', marginTop: 8, padding: '12px', fontSize: '0.95rem' }}
              disabled={!(confirmWritten && confirmVerified)}
              onClick={() => {
                startFlash();
                setStep('done');
                addToast('已记录真实烧录完成状态', 'success');
              }}
            >
              ✅ 标记烧录完成
            </button>
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('wifi')}>← 返回</button>
              <div />
            </div>
          </>
        )}

        {/* Done */}
        {step === 'done' && (
          <>
            <h2 className="ob-heading">🎉 烧录完成</h2>
            <p className="ob-sub">系统已写入成功，拔卡插入设备后上电即可启动</p>
            <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 10, fontSize: '0.78rem', color: '#16a34a', textAlign: 'center' }}>
              {flashPhase || '下一步: 打开终端进行首次配置 → 验证 BPU → 部署模型'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="clean-btn" onClick={() => { setActiveTab('terminal'); addToast('已跳转到终端', 'info'); }}>💻 打开终端</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('hardware'); addToast('已跳转到硬件检测', 'info'); }}>📊 硬件检测</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('files'); addToast('已跳转到文件管理', 'info'); }}>📂 文件管理</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
