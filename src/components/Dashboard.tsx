import { useState, useEffect } from 'react';
import {
  fetchDeviceDiagnostics,
  fetchDeviceOpenClawHealth,
  type OpenClawHealthStatus,
} from '../api';
import { useAppState } from '../hooks/useAppState';
import { parseMetrics } from '../utils/diagnostics';

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

  const prompt = (text: string) => {
    setChatExpanded(true);
    setCmd(text);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      (document.querySelector('.dock-input') as HTMLFormElement | null)?.requestSubmit();
    }));
  };

  /* ── No device ── */
  if (!currentDevice) {
    return (
      <div className="dash">
        <div className="dash-empty-hero">
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

  /* ── Connected ── */
  return (
    <div className="dash">
      {/* Hero */}
      <div className="dash-hero">
        <h1 className="dash-device-name">{currentDevice.name}</h1>
        <p className="dash-tagline">{currentDevice.ip}</p>
      </div>

      {/* Status */}
      <div className="dash-status">
        <div className="dash-stat">
          <span className="dash-stat-val">{metrics.memory}</span>
          <span className="dash-stat-lbl">MEM</span>
        </div>
        <span className="dash-stat-sep" />
        <div className="dash-stat">
          <span className={`dash-stat-val ${metrics.tempC >= 85 ? 'warn' : ''}`}>{metrics.temp}</span>
          <span className="dash-stat-lbl">TEMP</span>
        </div>
        <span className="dash-stat-sep" />
        <div className="dash-stat">
          <span className={`dash-stat-val ${metrics.bpuVal >= 90 ? 'warn' : ''}`}>{metrics.bpu}</span>
          <span className="dash-stat-lbl">BPU</span>
        </div>
        <span className="dash-stat-sep" />
        <div className="dash-stat">
          <span className="dash-stat-val">{metrics.uptime}</span>
          <span className="dash-stat-lbl">UP</span>
        </div>
      </div>

      {/* Actions */}
      <div className="dash-actions">
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

      {/* Footer status */}
      <div className="dash-footer">
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
