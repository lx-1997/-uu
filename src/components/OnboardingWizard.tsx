import { useEffect, useState, useRef, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import {
  fetchDeviceOpenClawHealth,
  checkDevicePing,
} from '../api';
import { resolveApiUrl } from '../utils/apiBase';

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

const SKIP_RISKS = [
  '板端 AI Agent 能力不可用（智能对话、自动化执行）',
  '无法通过飞书等消息渠道远程控制设备',
  '板端技能（摄像头、推理、GPIO 等）无法被 AI 调用',
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

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
  const [ocInstalled, setOcInstalled] = useState<boolean | null>(null);
  const [ocGatewayRunning, setOcGatewayRunning] = useState<boolean | null>(null);
  const [ocSummary, setOcSummary] = useState('');
  const [ocVersion, setOcVersion] = useState('');
  const [ocInstalling, setOcInstalling] = useState(false);
  const [ocStartingGw, setOcStartingGw] = useState(false);
  const [deviceOnline, setDeviceOnline] = useState<boolean | null>(null);
  const [ocInstallLog, setOcInstallLog] = useState('');
  const [ocGwLog, setOcGwLog] = useState('');
  const [installElapsed, setInstallElapsed] = useState(0);
  const [showSkipWarning, setShowSkipWarning] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLPreElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (obStep === 'connect' && currentDevice) {
      setObStep('openclaw');
    }
  }, [obStep, currentDevice]);

  useEffect(() => {
    if (obStep !== 'openclaw' || !currentDevice) return;
    setOcChecking(true);
    setDeviceOnline(null);
    checkDevicePing(currentDevice.id)
      .then((r) => setDeviceOnline(!!r.ok))
      .catch(() => setDeviceOnline(false));
    fetchDeviceOpenClawHealth(currentDevice.id)
      .then(r => {
        const s = r.status;
        setOcInstalled(!!s?.installed);
        setOcGatewayRunning(!!s?.gatewayRunning);
        setOcReady(!!s?.aiReady);
        setOcSummary(s?.summary || '');
        setOcVersion(s?.version || '');
      })
      .catch(() => {
        setOcInstalled(null);
        setOcGatewayRunning(null);
        setOcReady(false);
        setOcSummary('无法获取状态');
      })
      .finally(() => setOcChecking(false));
  }, [obStep, currentDevice?.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ocInstallLog, ocGwLog]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const handleInstallOC = useCallback(async () => {
    if (!currentDevice) return;
    if (deviceOnline === false) {
      addToast('设备当前无法连通（请先确认网络与 SSH），再安装 OpenClaw', 'warning');
      return;
    }

    try {
      const ping = await checkDevicePing(currentDevice.id);
      if (!ping.ok) {
        addToast('安装前检测：设备未响应，请检查网络后重试', 'warning');
        return;
      }
    } catch {
      addToast('安装前检测：无法连接设备', 'warning');
      return;
    }

    setOcInstalling(true);
    setOcInstallLog('');
    setInstallElapsed(0);
    setShowSkipWarning(false);

    timerRef.current = setInterval(() => {
      setInstallElapsed(prev => prev + 1);
    }, 1000);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/install-stream`);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'log') {
              setOcInstallLog(prev => prev + payload.text);
            } else if (payload.type === 'done') {
              if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
              setOcInstalling(false);
              if (payload.ok) {
                addToast('OpenClaw 安装完成', 'success');
                setOcInstalled(true);
                setOcGatewayRunning(true);
                setOcReady(true);
              } else {
                addToast('OpenClaw 安装未成功，请查看日志或到 OpenClaw 页重试', 'warning');
                setOcReady(false);
              }
            }
          } catch { /* malformed SSE line */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setOcInstallLog(prev => prev + `\n[错误] ${msg}\n`);
      addToast('OpenClaw 安装请求失败，请稍后在 OpenClaw 页重试', 'warning');
    } finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setOcInstalling(false);
      abortRef.current = null;
    }
  }, [currentDevice, deviceOnline, addToast]);

  const recheckHealth = useCallback(async () => {
    if (!currentDevice) return;
    setOcChecking(true);
    try {
      const r = await fetchDeviceOpenClawHealth(currentDevice.id);
      const s = r.status;
      setOcInstalled(!!s?.installed);
      setOcGatewayRunning(!!s?.gatewayRunning);
      setOcReady(!!s?.aiReady);
      setOcSummary(s?.summary || '');
      setOcVersion(s?.version || '');
    } catch {
      setOcSummary('检查失败，请重试');
    } finally {
      setOcChecking(false);
    }
  }, [currentDevice]);

  const handleStartGateway = useCallback(async () => {
    if (!currentDevice) return;
    setOcStartingGw(true);
    setOcGwLog('[网关] 正在发送启动指令...\n');

    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/restart-gateway`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { ok: boolean; output?: string };
      const gwOutput = (data.output || '').trim();
      setOcGwLog(prev => prev + (gwOutput ? gwOutput + '\n' : '') + '\n[网关] 启动指令已执行，等待网关就绪...\n');

      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 3000));
        setOcGwLog(prev => prev + `[检查] 第 ${i + 1}/8 次状态轮询...\n`);
        try {
          const health = await fetchDeviceOpenClawHealth(currentDevice.id);
          const s = health.status;
          setOcInstalled(!!s?.installed);
          setOcGatewayRunning(!!s?.gatewayRunning);
          setOcReady(!!s?.aiReady);
          setOcSummary(s?.summary || '');
          setOcVersion(s?.version || '');
          if (s?.gatewayRunning) {
            setOcGwLog(prev => prev + `[成功] 网关已启动 ✓\n`);
            addToast('OpenClaw 网关已启动', 'success');
            return;
          }
          setOcGwLog(prev => prev + `[检查] 网关尚未就绪 (${s?.summary || '等待中'})\n`);
        } catch {
          setOcGwLog(prev => prev + `[检查] 状态查询失败，继续等待...\n`);
        }
      }
      setOcGwLog(prev => prev + '\n[超时] 8 次轮询后网关仍未就绪，请点击「重新检查」或前往 OpenClaw 页面\n');
      addToast('网关可能仍在启动中，请点击「重新检查」刷新状态', 'warning');
    } catch (e) {
      setOcGwLog(prev => prev + `\n[错误] ${e instanceof Error ? e.message : '网关启动请求失败'}\n`);
      addToast('网关启动失败，请前往 OpenClaw 页面手动操作', 'warning');
    } finally {
      setOcStartingGw(false);
    }
  }, [currentDevice, addToast]);

  const handleSkipConfirm = () => {
    if (ocInstalling) {
      addToast('OpenClaw 安装仍在后台进行，完成后可在 OpenClaw 页面查看', 'info');
      abortRef.current?.abort();
    }
    setShowSkipWarning(false);
    setObStep('rdkclaw');
  };

  const handleCopyLog = async () => {
    if (!ocInstallLog.trim()) return;
    try {
      await navigator.clipboard.writeText(ocInstallLog);
      addToast('日志已复制到剪贴板', 'success');
    } catch {
      addToast('复制失败', 'warning');
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
            {!ocChecking && deviceOnline === false && (
              <div className="ob-oc-offline">
                <span>设备当前<strong>无法连通</strong>，请先确认开发板已联网、IP 正确且本机能 SSH，再安装 OpenClaw。</span>
              </div>
            )}
            {!ocChecking && ocReady === true && (
              <div className="ob-oc-ready">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <div>
                  <span>OpenClaw 已就绪</span>
                  {ocVersion && <span className="ob-oc-detail">版本: {ocVersion}</span>}
                  {ocSummary && <span className="ob-oc-detail">{ocSummary}</span>}
                </div>
              </div>
            )}
            {!ocChecking && !ocReady && ocInstalled && !showSkipWarning && (
              <div className="ob-oc-missing">
                <span>
                  OpenClaw 已安装{ocVersion ? ` (${ocVersion})` : ''}{ocGatewayRunning === false ? '，但网关未启动' : ''}
                </span>
                {ocSummary && <span className="ob-oc-detail">{ocSummary}</span>}
                <div className="ob-oc-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleStartGateway}
                    disabled={ocStartingGw}
                  >
                    {ocStartingGw ? '启动中...' : '启动网关'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={recheckHealth} disabled={ocChecking}>
                    重新检查
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={goOpenClaw}>
                    前往 OpenClaw 页面
                  </button>
                </div>
              </div>
            )}
            {!ocChecking && ocReady === false && !ocInstalled && !showSkipWarning && (
              <div className="ob-oc-missing">
                <span>OpenClaw 未安装</span>
                {ocSummary && <span className="ob-oc-detail">{ocSummary}</span>}
                <div className="ob-oc-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleInstallOC}
                    disabled={ocInstalling || deviceOnline === false}
                    title={deviceOnline === false ? '请先恢复设备连通' : undefined}
                  >
                    {ocInstalling ? '安装中...' : '一键安装 OpenClaw'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={recheckHealth} disabled={ocChecking}>
                    重新检查
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={goOpenClaw}>
                    前往 OpenClaw 页面
                  </button>
                </div>
              </div>
            )}

            {/* Gateway log */}
            {(ocStartingGw || ocGwLog) && !ocInstalling && !showSkipWarning && (
              <div className="ob-install-terminal">
                <div className="ob-install-terminal-header">
                  <span className="ob-install-terminal-dots">
                    <span className="td red" /><span className="td yellow" /><span className="td green" />
                  </span>
                  <span className="ob-install-terminal-title">网关日志</span>
                  {ocStartingGw && <span className="ob-elapsed">启动中...</span>}
                  {ocGwLog && (
                    <button className="ob-install-terminal-copy" onClick={() => {
                      navigator.clipboard.writeText(ocGwLog).then(() => addToast('日志已复制', 'success')).catch(() => {});
                    }} type="button">复制日志</button>
                  )}
                </div>
                <pre className="ob-install-terminal-body" ref={!ocInstalling ? logContainerRef : undefined}>
                  {ocGwLog || '准备启动网关...\n'}
                  {ocStartingGw && <span className="ob-install-cursor">_</span>}
                  <div ref={!ocInstalling ? logEndRef : undefined} />
                </pre>
              </div>
            )}

            {/* Terminal-style install log */}
            {(ocInstalling || ocInstallLog) && !showSkipWarning && (
              <div className="ob-install-terminal">
                <div className="ob-install-terminal-header">
                  <span className="ob-install-terminal-dots">
                    <span className="td red" /><span className="td yellow" /><span className="td green" />
                  </span>
                  <span className="ob-install-terminal-title">安装日志</span>
                  {ocInstalling && (
                    <span className="ob-elapsed">{formatElapsed(installElapsed)}</span>
                  )}
                  {ocInstallLog && (
                    <button className="ob-install-terminal-copy" onClick={handleCopyLog} type="button">
                      复制日志
                    </button>
                  )}
                </div>
                <pre className="ob-install-terminal-body" ref={logContainerRef}>
                  {ocInstallLog || '正在连接设备，准备安装...\n'}
                  {ocInstalling && <span className="ob-install-cursor">_</span>}
                  <div ref={logEndRef} />
                </pre>
              </div>
            )}

            {/* Skip warning overlay */}
            {showSkipWarning && (
              <div className="ob-skip-warning">
                <div className="ob-skip-warning-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <strong className="ob-skip-warning-title">跳过将影响以下功能</strong>
                <ul className="ob-skip-warning-list">
                  {SKIP_RISKS.map((risk, i) => (
                    <li key={i}>{risk}</li>
                  ))}
                </ul>
                <p className="ob-skip-warning-hint">
                  你可以稍后在 OpenClaw 页面随时安装。
                </p>
                <div className="ob-skip-warning-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowSkipWarning(false)}>
                    返回
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={handleSkipConfirm}>
                    仍然跳过
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="ob-actions">
            <button className="btn btn-ghost" onClick={() => setObStep('connect')}>上一步</button>
            {ocReady ? (
              <button className="btn btn-primary" onClick={() => setObStep('rdkclaw')}>
                下一步
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => setShowSkipWarning(true)}>
                跳过此步骤
              </button>
            )}
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
