import { useEffect, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import {
  fetchDeviceOpenClawHealth,
  installDeviceOpenClaw,
} from '../api';

type Step = 'board' | 'flash' | 'connect' | 'openclaw' | 'rdkclaw' | 'done';

const STEPS: { key: Step; label: string }[] = [
  { key: 'board', label: '选择硬件' },
  { key: 'flash', label: '烧录系统' },
  { key: 'connect', label: '连接设备' },
  { key: 'openclaw', label: 'OpenClaw' },
  { key: 'rdkclaw', label: '试用 AI' },
];

const BOARDS = [
  {
    key: 'x3',
    name: 'RDK X3',
    chip: '旭日3',
    tops: '5 TOPS',
    cpu: '4x A53 @1.5GHz',
    mem: '2/4GB',
    desc: '入门级机器人开发套件，200+ 开源算法',
    url: 'https://developer.d-robotics.cc/rdkx3',
  },
  {
    key: 'x5',
    name: 'RDK X5',
    chip: '旭日5',
    tops: '10 TOPS',
    cpu: '8x A55 @1.5GHz',
    mem: '4/8GB',
    desc: 'Type-C 闪连开发，Wi-Fi 6 + BT 5.4',
    url: 'https://developer.d-robotics.cc/rdkx5',
  },
  {
    key: 's100',
    name: 'RDK S100',
    chip: 'Journey 6',
    tops: '128 TOPS',
    cpu: '6x A78AE + 4x R52',
    mem: '12/24GB',
    desc: '具身智能平台，大小脑架构，全场景算力',
    url: 'https://developer.d-robotics.cc/rdks100',
  },
];

const IMAGE_RECOMMENDATIONS: Record<string, { name: string; tag: string; url: string }> = {
  x3: { name: 'RDKOS 3.0.3 Desktop', tag: 'ubuntu22.04 / 图形界面', url: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/' },
  x5: { name: 'RDKOS 3.4.1 Desktop', tag: 'ubuntu22.04 / 图形界面', url: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/' },
  s100: { name: 'RDKS100-V4.0.4-Beta Desktop', tag: 'ubuntu22.04', url: 'https://archive.d-robotics.cc/downloads/os_images/rdk_s100/' },
};

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.findIndex(s => s.key === current);
  return (
    <div className="ob-steps">
      {STEPS.map((s, i) => (
        <div key={s.key} className={`ob-step ${i < idx ? 'done' : i === idx ? 'active' : ''}`}>
          <span className="ob-step-num">
            {i < idx ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
            ) : i + 1}
          </span>
          {i < STEPS.length - 1 && <span className="ob-step-line" />}
        </div>
      ))}
    </div>
  );
}

export default function OnboardingWizard() {
  const {
    obStep, setObStep, selectedBoard, setSelectedBoard,
    setActiveTab, setShowAddDevice, currentDevice,
    setChatExpanded, setCmd, addToast,
    setObReturnStep,
  } = useAppState();

  const [ocChecking, setOcChecking] = useState(false);
  const [ocReady, setOcReady] = useState<boolean | null>(null);
  const [ocInstalling, setOcInstalling] = useState(false);

  useEffect(() => {
    if (obStep === 'connect' && currentDevice) {
      setObStep('openclaw');
    }
  }, [obStep, currentDevice]);

  useEffect(() => {
    if (obStep !== 'openclaw' || !currentDevice) return;
    setOcChecking(true);
    fetchDeviceOpenClawHealth(currentDevice.id)
      .then(r => setOcReady(!!r.status?.aiReady))
      .catch(() => setOcReady(false))
      .finally(() => setOcChecking(false));
  }, [obStep, currentDevice?.id]);

  const handleInstallOC = async () => {
    if (!currentDevice) return;
    setOcInstalling(true);
    try {
      await installDeviceOpenClaw(currentDevice.id);
      addToast('OpenClaw 安装完成', 'success');
      setOcReady(true);
    } catch {
      addToast('OpenClaw 安装失败，请稍后在 OpenClaw 页重试', 'warning');
    } finally {
      setOcInstalling(false);
    }
  };

  const goFlasher = () => {
    setObReturnStep('flash');
    setActiveTab('flasher');
  };

  const goOpenClaw = () => {
    setObReturnStep('openclaw');
    setActiveTab('openclaw');
  };

  const handleTryRDKClaw = () => {
    setChatExpanded(true);
    setCmd('帮我全面检查当前设备的健康状态，包括温度、内存、BPU 负载和网络，并给出优化建议');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      (document.querySelector('.dock-input') as HTMLFormElement | null)?.requestSubmit();
    }));
  };

  const finish = () => {
    setObStep('done');
    addToast('新手引导已完成，尽情使用 RDK Studio 吧！', 'success');
  };

  const stepIdx = STEPS.findIndex(s => s.key === obStep);

  return (
    <div className="ob-wizard">
      <div className="ob-header">
        <div className="ob-brand">RDK Studio</div>
        <p className="ob-subtitle">欢迎使用，让我们一步步配置你的开发环境</p>
      </div>

      <StepIndicator current={obStep} />

      <div className="ob-title">{STEPS[stepIdx]?.label}</div>

      {/* ── Step 1: 选择硬件 ── */}
      {obStep === 'board' && (
        <div className="ob-content">
          <p className="ob-desc">选择你手上的 RDK 开发板型号：</p>
          <div className="ob-board-grid">
            {BOARDS.map(b => (
              <button
                key={b.key}
                className={`ob-board-card ${selectedBoard === b.key ? 'selected' : ''}`}
                onClick={() => setSelectedBoard(b.key)}
              >
                <div className="ob-board-head">
                  <strong className="ob-board-name">{b.name}</strong>
                  <span className="ob-board-tops">{b.tops}</span>
                </div>
                <div className="ob-board-specs">
                  <span>{b.chip}</span>
                  <span>{b.cpu}</span>
                  <span>{b.mem}</span>
                </div>
                <p className="ob-board-desc">{b.desc}</p>
                <a className="ob-board-link" href={b.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                  了解更多
                </a>
              </button>
            ))}
          </div>
          <div className="ob-actions">
            <button className="btn btn-ghost" onClick={() => setObStep('flash')}>
              跳过，直接烧录
            </button>
            <button className="btn btn-primary" disabled={!selectedBoard} onClick={() => setObStep('flash')}>
              下一步
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: 烧录系统 ── */}
      {obStep === 'flash' && (
        <div className="ob-content">
          {selectedBoard && IMAGE_RECOMMENDATIONS[selectedBoard] ? (
            <>
              <p className="ob-desc">
                为你的 <strong>{BOARDS.find(b => b.key === selectedBoard)?.name}</strong> 推荐以下系统镜像：
              </p>
              <div className="ob-flash-card">
                <div className="ob-flash-info">
                  <strong>{IMAGE_RECOMMENDATIONS[selectedBoard].name}</strong>
                  <span className="badge badge-muted">{IMAGE_RECOMMENDATIONS[selectedBoard].tag}</span>
                </div>
                <p className="ob-desc">
                  推荐 Desktop 版本，含图形界面和完整开发工具链。
                  需要将镜像写入 TF 卡（或 eMMC），请使用烧录工具。
                </p>
                <div className="ob-flash-actions">
                  <a className="btn btn-ghost btn-sm" href={IMAGE_RECOMMENDATIONS[selectedBoard].url} target="_blank" rel="noreferrer">
                    下载镜像
                  </a>
                  <button className="btn btn-primary btn-sm" onClick={goFlasher}>
                    打开烧录工具
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="ob-desc">请先在烧录工具中选择板卡和镜像完成烧录。</p>
          )}
          <div className="ob-actions">
            <button className="btn btn-ghost" onClick={() => setObStep('board')}>上一步</button>
            <button className="btn btn-primary" onClick={() => setObStep('connect')}>
              已烧录完成，下一步
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: 连接设备 ── */}
      {obStep === 'connect' && (
        <div className="ob-content">
          <p className="ob-desc">
            将开发板通电并通过网线或 WiFi 连接到与本机同一局域网，然后添加设备。
          </p>
          <div className="ob-connect-methods">
            <div className="ob-connect-card">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M5 12.55a11 11 0 0114 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/></svg>
              <div>
                <strong>SSH 网络</strong>
                <span>输入 IP 地址，远程连接</span>
              </div>
            </div>
            <div className="ob-connect-card">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M12 18v-6"/><path d="M8 18v-2"/><path d="M16 18v-4"/><rect x="6" y="18" width="4" height="4" rx="1"/><rect x="14" y="18" width="4" height="4" rx="1"/><circle cx="12" cy="8" r="2"/><path d="M12 2v4"/></svg>
              <div>
                <strong>USB 串口</strong>
                <span>调试口直连，适合首次配网</span>
              </div>
            </div>
          </div>
          <div className="ob-actions">
            <button className="btn btn-ghost" onClick={() => setObStep(selectedBoard ? 'flash' : 'board')}>上一步</button>
            <button className="btn btn-primary" onClick={() => setShowAddDevice(true)}>
              添加设备
            </button>
          </div>
          <button className="ob-skip" onClick={() => { setObStep('done'); }}>
            稍后连接，跳过引导
          </button>
        </div>
      )}

      {/* ── Step 4: OpenClaw 检查 ── */}
      {obStep === 'openclaw' && (
        <div className="ob-content">
          <p className="ob-desc">
            OpenClaw 是 RDK 板端 AI Agent 运行环境。检查你的设备是否已安装：
          </p>
          <div className="ob-oc-status">
            {ocChecking && (
              <div className="ob-oc-checking"><div className="spinner" /><span>正在检查 OpenClaw 状态...</span></div>
            )}
            {!ocChecking && ocReady === true && (
              <div className="ob-oc-ready">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>OpenClaw 已就绪</span>
              </div>
            )}
            {!ocChecking && ocReady === false && (
              <div className="ob-oc-missing">
                <span>OpenClaw 未安装或未就绪</span>
                <div className="ob-oc-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleInstallOC} disabled={ocInstalling}>
                    {ocInstalling ? '安装中...' : '一键安装 OpenClaw'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={goOpenClaw}>
                    前往 OpenClaw 页面
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="ob-actions">
            <button className="btn btn-ghost" onClick={() => setObStep('connect')}>上一步</button>
            <button className="btn btn-primary" onClick={() => setObStep('rdkclaw')}>
              {ocReady ? '下一步' : '跳过，稍后安装'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 5: 试用 RDKClaw ── */}
      {obStep === 'rdkclaw' && (
        <div className="ob-content">
          <p className="ob-desc">
            RDKClaw 是 RDK Studio 内置的 AI 智能体，可以用自然语言操控设备、开发应用、诊断问题。
            试试给它一个小任务：
          </p>
          <div className="ob-try-card">
            <div className="ob-try-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/></svg>
            </div>
            <div className="ob-try-body">
              <strong>设备健康检查</strong>
              <span>"检查设备温度、内存、BPU 负载并给出优化建议"</span>
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleTryRDKClaw}>
              发送
            </button>
          </div>
          <p className="ob-desc ob-try-hint">
            你也可以在底部对话框中随时输入任何任务，RDKClaw 会自动规划并执行。
          </p>
          <div className="ob-actions">
            <button className="btn btn-ghost" onClick={() => setObStep('openclaw')}>上一步</button>
            <button className="btn btn-primary" onClick={finish}>
              完成引导
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
