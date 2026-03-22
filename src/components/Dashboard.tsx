import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchDeviceDiagnostics,
  fetchDeviceOpenClawHealth,
  type OpenClawHealthStatus,
} from '../api';
import { useAppState } from '../hooks/useAppState';
import { parseMetrics } from '../utils/diagnostics';

function ParticleCanvas({ accent }: { accent: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    const particles: { x: number; y: number; vx: number; vy: number; r: number; o: number }[] = [];
    const COUNT = 25;
    const LINK_DIST = 120;

    const resize = () => {
      canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
      canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    };

    resize();
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.offsetWidth,
        y: Math.random() * canvas.offsetHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 2 + 1,
        o: Math.random() * 0.4 + 0.1,
      });
    }

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      const color = accent ? '255, 107, 0' : '148, 163, 184';

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${p.o})`;
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(${color}, ${0.08 * (1 - dist / LINK_DIST)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
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
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
    />
  );
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

  useEffect(() => {
    if (!currentDevice) { setOpenclawHealth(null); return; }
    fetchDeviceOpenClawHealth(currentDevice.id)
      .then((r) => setOpenclawHealth(r.status))
      .catch(() => {});
  }, [currentDevice?.id]);

  const prompt = useCallback((text: string) => {
    setChatExpanded(true);
    setCmd(text);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      (document.querySelector('.dock-input') as HTMLFormElement | null)?.requestSubmit();
    }));
  }, [setChatExpanded, setCmd]);

  if (!currentDevice) {
    return (
      <div className="dash">
        <ParticleCanvas accent={false} />
        <div className="dash-decor dash-decor-hex" />
        <div className="dash-decor dash-decor-ring" />
        <div className={`dash-empty-hero ${mounted ? 'dash-enter' : ''}`}>
          <div className="dash-brand">RDK Studio</div>
          <p className="dash-tagline">连接你的 RDK 开发板，开始构建</p>
          <button className="dash-action primary" onClick={() => setShowAddDevice(true)}>
            <span className="dash-action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </span>
            添加设备
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

  return (
    <div className="dash">
      <ParticleCanvas accent={true} />
      <div className="dash-decor dash-decor-hex" />
      <div className="dash-decor dash-decor-ring" />
      <div className="dash-decor dash-decor-dot" />

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

      <div className={`dash-actions ${mounted ? 'dash-enter dash-enter-d2' : ''}`}>
        <button className="dash-action primary" onClick={() => prompt('帮我生成一个最小可运行的 RDK 应用，并直接开始实现')}>
          <span className="dash-action-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
          </span>
          一句话开发
        </button>
        <button className="dash-action" onClick={() => setActiveTab('terminal')}>
          <span className="dash-action-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3" /><rect x="2.25" y="4.5" width="19.5" height="15" rx="2.25" /></svg>
          </span>
          Terminal
        </button>
        <button className="dash-action" onClick={() => setActiveTab('openclaw')}>
          <span className="dash-action-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5m14 0l-4.091-4.091a2.25 2.25 0 01-.659-1.591V3.104m-4.5 0a24.301 24.301 0 014.5 0m0 0v5.714M5 14.5V17a2 2 0 002 2h10a2 2 0 002-2v-2.5" /></svg>
          </span>
          OpenClaw
        </button>
      </div>

      <div className={`dash-footer ${mounted ? 'dash-enter dash-enter-d3' : ''}`}>
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
