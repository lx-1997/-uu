import { useState, useEffect, useRef, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import {
  fetchDeviceDiagnostics,
  fetchDeviceOpenClawHealth,
  fetchDeviceWorkspaceHealth,
  type OpenClawHealthStatus,
} from '../api';
import { useAppState } from '../hooks/useAppState';
import { parseMetrics } from '../utils/diagnostics';
import OnboardingWizard from './OnboardingWizard';

function FlowingGradientBg({ accent }: { accent: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let t = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const orbs = Array.from({ length: 5 }, (_, i) => ({
      cx: 0.2 + Math.random() * 0.6,
      cy: 0.2 + Math.random() * 0.6,
      rx: 0.15 + Math.random() * 0.12,
      ry: 0.12 + Math.random() * 0.1,
      speed: 0.0003 + Math.random() * 0.0004,
      phase: (i / 5) * Math.PI * 2,
    }));

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);
      t += 1;

      for (const orb of orbs) {
        const x = (orb.cx + Math.sin(t * orb.speed + orb.phase) * 0.15) * w;
        const y = (orb.cy + Math.cos(t * orb.speed * 0.7 + orb.phase) * 0.12) * h;
        const r = Math.max(w, h) * (orb.rx + Math.sin(t * orb.speed * 0.5) * 0.03);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        if (accent) {
          grad.addColorStop(0, 'rgba(255, 107, 0, 0.14)');
          grad.addColorStop(0.4, 'rgba(255, 60, 0, 0.07)');
          grad.addColorStop(1, 'transparent');
        } else {
          grad.addColorStop(0, 'rgba(148, 163, 184, 0.10)');
          grad.addColorStop(0.4, 'rgba(100, 116, 139, 0.05)');
          grad.addColorStop(1, 'transparent');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      animId = requestAnimationFrame(draw);
    };

    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [accent]);

  return (
    <canvas
      ref={canvasRef}
      className="dash-flowing-bg"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
    />
  );
}

function useParallax() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const onMove = useCallback((e: ReactMouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const x = ((e.clientX - cx) / rect.width) * 12;
    const y = -((e.clientY - cy) / rect.height) * 8;
    setTilt({ x, y });
  }, []);
  const onLeave = useCallback(() => setTilt({ x: 0, y: 0 }), []);
  return { tilt, onMove, onLeave };
}

function AnimatedNumber({ value, suffix }: { value: string; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value === '--' || value === prevRef.current) { setDisplay(value); prevRef.current = value; return; }
    const numMatch = value.match(/^([\d.]+)/);
    if (!numMatch) { setDisplay(value); prevRef.current = value; return; }
    const target = parseFloat(numMatch[1]);
    const rest = value.slice(numMatch[1].length);
    const start = prevRef.current.match(/^([\d.]+)/) ? parseFloat(prevRef.current.match(/^([\d.]+)/)![1]) : 0;
    const duration = 600;
    const t0 = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = start + (target - start) * ease;
      setDisplay(`${Number.isInteger(target) ? Math.round(current) : current.toFixed(1)}${rest}`);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    prevRef.current = value;
  }, [value]);

  return <>{display}{suffix || ''}</>;
}

export default function Dashboard() {
  const {
    currentDevice,
    addToast,
    setShowAddDevice,
    setActiveTab,
    setChatExpanded,
    setCmd,
    obStep, setObStep,
  } = useAppState();

  const [openclawHealth, setOpenclawHealth] = useState<OpenClawHealthStatus | null>(null);
  const [metrics, setMetrics] = useState({ memory: '--', temp: '--', bpu: '--', uptime: '--', tempC: -1, bpuVal: -1 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setMounted(true)); }, []);

  useEffect(() => {
    if (!currentDevice) return;
    let cancelled = false;
    const load = () => {
      fetchDeviceDiagnostics(currentDevice.id)
        .then((r) => {
          if (cancelled) return;
          const m = parseMetrics(r.output);
          setMetrics({
            memory: m.memUsed !== '--' && m.memTotal !== '--' ? `${m.memUsed}/${m.memTotal}` : '--',
            temp: m.temp, bpu: m.bpu, uptime: m.uptime, tempC: m.tempC, bpuVal: m.bpuValue,
          });
        })
        .catch(() => { if (!cancelled) setMetrics({ memory: '--', temp: '--', bpu: '--', uptime: '--', tempC: -1, bpuVal: -1 }); });
    };
    load();
    const t = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [currentDevice?.id]);

  type WorkspaceModule = { ready: boolean; installed: boolean; running?: boolean; summary: string; recommendedAction: string };
  const [wsHealth, setWsHealth] = useState<Record<string, WorkspaceModule> | null>(null);

  useEffect(() => {
    if (!currentDevice) { setOpenclawHealth(null); setWsHealth(null); return; }
    fetchDeviceOpenClawHealth(currentDevice.id)
      .then((r) => setOpenclawHealth(r.status))
      .catch(() => {});
    fetchDeviceWorkspaceHealth(currentDevice.id)
      .then((r) => setWsHealth(r.status?.modules ?? null))
      .catch(() => {});
  }, [currentDevice?.id]);

  const prompt = useCallback((text: string, autoSubmit = true) => {
    setChatExpanded(true);
    setCmd(text);
    if (autoSubmit) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        (document.querySelector('.dock-input') as HTMLFormElement | null)?.requestSubmit();
      }));
    } else {
      requestAnimationFrame(() => {
        const input = document.querySelector('.dock-input input, .dock-input textarea') as HTMLElement | null;
        input?.focus();
      });
    }
  }, [setChatExpanded, setCmd]);

  const parallax = useParallax();

  const onboardingInProgress = obStep !== 'done';
  const postConnectSteps = obStep === 'model' || obStep === 'openclaw' || obStep === 'rdkclaw';
  const connectJustCompleted = obStep === 'connect' && !!currentDevice;
  const showOnboarding = onboardingInProgress && (!currentDevice || postConnectSteps || connectJustCompleted);

  if (showOnboarding) {
    return (
      <div className="dash">
        <FlowingGradientBg accent={!!currentDevice} />
        <div className="dash-morph-halo" />
        <div className="dash-morph-halo secondary" />
        <OnboardingWizard />
      </div>
    );
  }

  if (!currentDevice) {
    return (
      <div className="dash">
        <FlowingGradientBg accent={false} />
        <div className="dash-morph-halo" />
        <div className="dash-morph-halo secondary" />
        <div className={`dash-empty-hero ${mounted ? 'dash-enter' : ''}`}>
          <div className="dash-brand">RDK Studio</div>
          <p className="dash-tagline">连接你的 RDK 开发板，开始构建</p>
          <button className="dash-action primary" onClick={() => setShowAddDevice(true)}>
            <span className="dash-action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </span>
            添加设备
          </button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setObStep('board')}>
            重新开始引导
          </button>
        </div>
      </div>
    );
  }

  const stats = [
    { key: 'mem', val: metrics.memory, label: 'MEM' },
    { key: 'temp', val: metrics.temp, label: 'TEMP', warn: metrics.tempC >= 85 },
    { key: 'bpu', val: metrics.bpu, label: 'BPU', warn: metrics.bpuVal >= 90 },
    { key: 'up', val: metrics.uptime, label: 'UPTIME' },
  ];

  return (
    <div className="dash" onMouseMove={parallax.onMove} onMouseLeave={parallax.onLeave}>
      <FlowingGradientBg accent={true} />
      <div className="dash-morph-halo" />
      <div className="dash-morph-halo secondary" />

      {/* ── Hero: device name as the centerpiece ── */}
      <div className={`lp-hero ${mounted ? 'lp-enter' : ''}`}>
        <div className="lp-status-row">
          <span className={`lp-pill ${openclawHealth?.aiReady ? 'ok' : ''}`}>
            <span className={`status-dot ${openclawHealth?.aiReady ? 'online' : 'warn'}`} />
            RDKClaw
          </span>
          <span className={`lp-pill ${openclawHealth?.gatewayRunning ? 'ok' : ''}`}>
            <span className={`status-dot ${openclawHealth?.gatewayRunning ? 'online' : 'warn'}`} />
            OpenClaw
          </span>
          <span className={`lp-pill ${currentDevice.status !== 'offline' && currentDevice.status !== 'disconnected' ? 'online' : ''}`}>
            <span className={`status-dot ${currentDevice.status !== 'offline' && currentDevice.status !== 'disconnected' ? 'online' : 'offline'}`} />
            设备在线
          </span>
        </div>
        <h1 className="lp-device-name">{currentDevice.name}</h1>
        <p className="lp-device-ip">{currentDevice.ip}</p>
      </div>

      {/* ── Live metrics strip ── */}
      <div className={`lp-metrics ${mounted ? 'lp-enter lp-d1' : ''}`}>
        {stats.map((s, i) => (
          <div key={s.key} className={`lp-metric ${(s as any).warn ? 'warn' : ''}`} style={mounted ? { animationDelay: `${200 + i * 60}ms` } : undefined}>
            <span className="lp-metric-val"><AnimatedNumber value={s.val} /></span>
            <span className="lp-metric-lbl">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── CTA: primary action ── */}
      <div className={`lp-cta ${mounted ? 'lp-enter lp-d2' : ''}`}>
        <button className="lp-cta-btn primary" onClick={() => prompt('', false)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/></svg>
          一句话开发
        </button>
        <button className="lp-cta-btn" onClick={() => setActiveTab('terminal')}>Terminal</button>
        <button className="lp-cta-btn" onClick={() => setActiveTab('openclaw')}>OpenClaw</button>
        <button className="lp-cta-btn" onClick={() => prompt('帮我全面检查设备健康状态')}>设备体检</button>
      </div>

      {/* ── Workspace capability badges ── */}
      {wsHealth && (
        <div className={`lp-caps ${mounted ? 'lp-enter lp-d3' : ''}`}>
          {([
            { key: 'development', label: '开发环境', tab: 'terminal' as const },
            { key: 'codeServer', label: 'IDE', tab: 'ide' as const },
            { key: 'vnc', label: '远程桌面', tab: 'vnc' as const },
            { key: 'ros', label: 'ROS', tab: 'ros' as const },
          ]).map(item => {
            const mod = wsHealth[item.key] as WorkspaceModule | undefined;
            if (!mod) return null;
            return (
              <button key={item.key} className={`lp-cap ${mod.ready ? 'ready' : ''}`} onClick={() => setActiveTab(item.tab)}>
                <span className={`lp-cap-dot ${mod.ready ? 'ok' : mod.installed ? 'partial' : ''}`} />
                <span className="lp-cap-name">{item.label}</span>
                <span className="lp-cap-status">{mod.ready ? '就绪' : mod.installed ? '未启动' : '未安装'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
