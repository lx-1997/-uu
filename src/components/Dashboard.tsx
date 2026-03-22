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
          grad.addColorStop(0, 'rgba(255, 107, 0, 0.08)');
          grad.addColorStop(0.4, 'rgba(255, 60, 0, 0.04)');
          grad.addColorStop(1, 'transparent');
        } else {
          grad.addColorStop(0, 'rgba(148, 163, 184, 0.06)');
          grad.addColorStop(0.4, 'rgba(100, 116, 139, 0.03)');
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

  const prompt = useCallback((text: string) => {
    setChatExpanded(true);
    setCmd(text);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      (document.querySelector('.dock-input') as HTMLFormElement | null)?.requestSubmit();
    }));
  }, [setChatExpanded, setCmd]);

  const parallax = useParallax();

  const onboardingInProgress = obStep !== 'done';
  const postConnectSteps = obStep === 'openclaw' || obStep === 'rdkclaw';
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
    { key: 'mem', val: metrics.memory, label: 'MEM', warn: false },
    { key: 'temp', val: metrics.temp, label: 'TEMP', warn: metrics.tempC >= 85 },
    { key: 'bpu', val: metrics.bpu, label: 'BPU', warn: metrics.bpuVal >= 90 },
    { key: 'up', val: metrics.uptime, label: 'UP', warn: false },
  ];

  const cards = [
    {
      key: 'dev',
      title: '一句话开发',
      desc: '用自然语言描述需求，AI 自动实现',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>,
      primary: true,
      action: () => prompt('帮我生成一个最小可运行的 RDK 应用，并直接开始实现'),
    },
    {
      key: 'term',
      title: 'Terminal',
      desc: '远程终端，命令直达设备',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3" /><rect x="2.25" y="4.5" width="19.5" height="15" rx="2.25" /></svg>,
      primary: false,
      action: () => setActiveTab('terminal'),
    },
    {
      key: 'oc',
      title: 'OpenClaw',
      desc: '板端 AI 智能体管理',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5m14 0l-4.091-4.091a2.25 2.25 0 01-.659-1.591V3.104m-4.5 0a24.301 24.301 0 014.5 0m0 0v5.714M5 14.5V17a2 2 0 002 2h10a2 2 0 002-2v-2.5" /></svg>,
      primary: false,
      action: () => setActiveTab('openclaw'),
    },
  ];

  return (
    <div className="dash" onMouseMove={parallax.onMove} onMouseLeave={parallax.onLeave}>
      <FlowingGradientBg accent={true} />
      <div className="dash-morph-halo" />
      <div className="dash-morph-halo secondary" />

      <div className={`dash-hero ${mounted ? 'dash-enter' : ''}`}>
        <h1 className="dash-device-name">{currentDevice.name}</h1>
        <p className="dash-tagline">{currentDevice.ip}</p>
      </div>

      <div className={`dash-status ${mounted ? 'dash-enter dash-enter-d1' : ''}`}>
        {stats.map((s, i) => (
          <span key={s.key}>
            {i > 0 && <span className="dash-stat-sep" />}
            <span className="dash-stat" style={{ animationDelay: `${200 + i * 80}ms` }}>
              <span className={`dash-stat-val ${s.warn ? 'warn' : ''}`}><AnimatedNumber value={s.val} /></span>
              <span className="dash-stat-lbl">{s.label}</span>
            </span>
          </span>
        ))}
      </div>

      <div className={`dash-cards ${mounted ? 'dash-enter dash-enter-d2' : ''}`}>
        {cards.map((card, i) => (
          <button
            key={card.key}
            className={`dash-3d-card ${card.primary ? 'primary' : ''}`}
            onClick={card.action}
            style={{
              transform: `perspective(800px) rotateY(${parallax.tilt.x * (0.6 + i * 0.2)}deg) rotateX(${parallax.tilt.y * (0.6 + i * 0.2)}deg) translateZ(0)`,
              animationDelay: `${400 + i * 100}ms`,
            }}
          >
            <div className="dash-3d-card-glow" />
            <div className="dash-3d-card-icon">{card.icon}</div>
            <div className="dash-3d-card-body">
              <span className="dash-3d-card-title">{card.title}</span>
              <span className="dash-3d-card-desc">{card.desc}</span>
            </div>
          </button>
        ))}
      </div>

      {wsHealth && (
        <div className={`dash-quickstart ${mounted ? 'dash-enter dash-enter-d3' : ''}`}>
          {([
            { key: 'development', label: '开发环境', icon: '>', tab: 'terminal' as const },
            { key: 'codeServer', label: 'IDE', icon: '<>', tab: 'ide' as const },
            { key: 'vnc', label: '远程桌面', icon: '[]', tab: 'vnc' as const },
            { key: 'ros', label: 'ROS', icon: 'R', tab: 'ros' as const },
          ] as const).map(item => {
            const mod = wsHealth[item.key] as WorkspaceModule | undefined;
            if (!mod) return null;
            return (
              <button
                key={item.key}
                className={`dash-qs-item ${mod.ready ? 'ready' : ''}`}
                onClick={() => setActiveTab(item.tab)}
              >
                <span className={`dash-qs-dot ${mod.ready ? 'ok' : mod.installed ? 'partial' : ''}`} />
                <span className="dash-qs-label">{item.label}</span>
                <span className="dash-qs-status">{mod.ready ? '就绪' : mod.installed ? '未启动' : '未安装'}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className={`dash-footer ${mounted ? 'dash-enter' : ''}`} style={{ animationDelay: '800ms' }}>
        <span className="dash-footer-item">
          <span className={`status-dot ${openclawHealth?.aiReady ? 'online' : 'warn'}`} />
          OpenClaw {openclawHealth?.aiReady ? 'Ready' : '未就绪'}
        </span>
        <span className="dash-footer-item">
          {currentDevice.status === 'connected' ? '在线' : '离线'}
        </span>
      </div>
    </div>
  );
}
