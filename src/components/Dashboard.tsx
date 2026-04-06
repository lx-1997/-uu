import { useState, useEffect, useRef, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import {
  fetchDeviceDiagnostics,
  fetchDeviceOpenClawHealth,
  fetchDeviceWorkspaceHealth,
  fetchStudioHealth,
  ensurePartnerAdvisorySkill,
  ensureBoardSkillBundle,
  type OpenClawHealthStatus,
} from '../api';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import {
  ONE_SHOT_DEV_WORKFLOW_PROMPT_ZH,
  ONE_SHOT_DEV_WORKFLOW_PROMPT_EN,
  DASHBOARD_HEALTH_CHECK_PROMPT_ZH,
  DASHBOARD_HEALTH_CHECK_PROMPT_EN,
  DASHBOARD_CHAT_INTRO_PROMPT_ZH,
  DASHBOARD_CHAT_INTRO_PROMPT_EN,
} from '../i18n/prompts';
import {
  DEVICE_DIAGNOSTICS_POLL_MS,
  DEVICE_POLL_PHASE_BOARD_HEALTH_MS,
  DEVICE_POLL_PHASE_DIAGNOSTICS_MS,
  DEVICE_POLL_PHASE_STUDIO_BACKEND_MS,
} from '../constants';
import { formatDashboardBoardModelDisplay, formatDashboardMemoryDisplay, parseMetrics } from '../utils/diagnostics';
import { isDeviceShownOnline } from '../utils/device-connection';
import { fetchWifiLinkState } from '../utils/wifi-link-probe';
import {
  persistOpenClawHealthSnapshot,
  persistBoardSkillBundleHint,
  readStudioUiHintsForDevice,
} from '../studio-ui-hints';
import { BadgeCheck, Shrimp } from 'lucide-react';
import OnboardingWizard from './OnboardingWizard';

type WorkspaceModule = {
  ready: boolean;
  installed: boolean;
  running?: boolean;
  summary: string;
  recommendedAction: string;
};

/** 切换 Tab 会卸载页，useRef 会丢；模块级键区分「设备上下文真变」与「只是重新挂载」。 */
let lastDashboardDiagnosticsContextKey = '';

const dashboardWsHealthKey = (deviceId: string) =>
  `rdk:dashboard-ws-health:${String(deviceId || '').trim()}`;

function readDashboardWorkspaceHealthCache(deviceId: string): Record<string, WorkspaceModule> | null {
  if (typeof window === 'undefined' || !String(deviceId || '').trim()) return null;
  try {
    const raw = sessionStorage.getItem(dashboardWsHealthKey(deviceId));
    if (!raw) return null;
    const o = JSON.parse(raw) as { modules?: Record<string, WorkspaceModule> };
    return o?.modules && typeof o.modules === 'object' ? o.modules : null;
  } catch {
    return null;
  }
}

function writeDashboardWorkspaceHealthCache(deviceId: string, modules: Record<string, WorkspaceModule>) {
  if (typeof window === 'undefined' || !String(deviceId || '').trim()) return;
  try {
    sessionStorage.setItem(dashboardWsHealthKey(deviceId), JSON.stringify({ at: Date.now(), modules }));
  } catch {
    /* quota */
  }
}

function openClawFromStudioHints(deviceId: string): OpenClawHealthStatus | null {
  const h = readStudioUiHintsForDevice(deviceId);
  if (!h) return null;
  const o = h.openclaw;
  const g = h.gateway;
  if (!o && !g) return null;
  const installed = Boolean(o?.installed ?? g?.installed ?? false);
  const gatewayRunning = Boolean(o?.gatewayRunning ?? g?.running ?? false);
  const version = String(o?.version ?? g?.version ?? '');
  return {
    installed,
    gatewayRunning,
    version,
    hasToken: false,
    tokenStatus: 'unknown',
    aiReady: Boolean(o?.aiReady ?? false),
    summary: '',
  };
}

/**
 * Throttled canvas gradient animation — renders at ~20 FPS instead of 60 FPS.
 * The slow-moving orb animation is visually indistinguishable at lower frame rates,
 * but CPU usage drops by ~60% since gradient fills are expensive compositing ops.
 */
const GRADIENT_FPS_INTERVAL = 1000 / 20;

function FlowingGradientBg({ accent }: { accent: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let t = 0;
    let lastFrameTime = 0;

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

    const draw = (now: number) => {
      animId = requestAnimationFrame(draw);
      if (now - lastFrameTime < GRADIENT_FPS_INTERVAL) return;
      lastFrameTime = now;

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
    };

    animId = requestAnimationFrame(draw);
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

/**
 * Eased number transition with proper rAF cleanup.
 * Previous implementation could stack multiple rAF chains when `value`
 * changed rapidly — now each new value cancels the in-progress animation.
 */
function AnimatedNumber({ value, suffix }: { value: string; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);

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
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    prevRef.current = value;

    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <>{display}{suffix || ''}</>;
}

export default function Dashboard() {
  const {
    currentDevice,
    setShowAddDevice,
    setActiveTab,
    setChatExpanded,
    setCmd,
    obStep, setObStep,
  } = useAppState();
  const { t, isEn } = useI18n();

  /** 与 useDeviceStore 中「当前设备」一致（有列表时默认首台，可点击切换） */
  const effectiveDevice = currentDevice;

  const [openclawHealth, setOpenclawHealth] = useState<OpenClawHealthStatus | null>(null);
  /** RDK Studio 本机服务（/api/health），与套件端 OpenClaw 无关 */
  const [studioBackendOk, setStudioBackendOk] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState({
    memory: '--',
    temp: '--',
    cpu: '--',
    bpu: '--',
    disk: '--',
    uptime: '--',
    tempC: -1,
    memPct: -1,
    cpuVal: -1,
    bpuVal: -1,
    diskPct: -1,
    /** 诊断 SSH 采集的板型字符串；与设备列表已保存的 boardModel 二选一展示 */
    boardModelProbe: '',
  });
  const [wsHealth, setWsHealth] = useState<Record<string, WorkspaceModule> | null>(null);
  const [deviceNetUp, setDeviceNetUp] = useState<boolean | null>(null);
  useEffect(() => {
    if (!effectiveDevice) { setDeviceNetUp(null); return; }
    const id = effectiveDevice.id;
    let cancelled = false;
    const probe = async () => {
      const s = await fetchWifiLinkState(id);
      if (!cancelled) setDeviceNetUp(s.state === 'up');
    };
    void probe();
    const iv = setInterval(probe, DEVICE_DIAGNOSTICS_POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [effectiveDevice?.id]);

  useEffect(() => {
    let cancelled = false;
    let studioKick: ReturnType<typeof setTimeout> | null = null;
    let studioIv: ReturnType<typeof setInterval> | null = null;
    const poll = () => {
      void fetchStudioHealth().then((r) => {
        if (!cancelled) setStudioBackendOk(r.ok);
      });
    };
    studioKick = setTimeout(() => {
      poll();
      studioIv = setInterval(poll, DEVICE_DIAGNOSTICS_POLL_MS);
    }, DEVICE_POLL_PHASE_STUDIO_BACKEND_MS);
    return () => {
      cancelled = true;
      if (studioKick) clearTimeout(studioKick);
      if (studioIv) clearInterval(studioIv);
    };
  }, []);

  /** 设备已判定离线时立即清空指标，避免关机后仍显示上一次的 MEM/TEMP/uptime */
  useEffect(() => {
    if (!effectiveDevice || isDeviceShownOnline(effectiveDevice)) return;
    setMetrics({
      memory: '--',
      temp: '--',
      cpu: '--',
      bpu: '--',
      disk: '--',
      uptime: '--',
      tempC: -1,
      memPct: -1,
      cpuVal: -1,
      bpuVal: -1,
      diskPct: -1,
      boardModelProbe: '',
    });
  }, [effectiveDevice?.id, effectiveDevice?.status, effectiveDevice?.sshSessionVerified]);

  useEffect(() => {
    if (!effectiveDevice) return;
    const deviceId = effectiveDevice.id;
    let cancelled = false;
    const ctxKey = `${deviceId}:${effectiveDevice.status}:${effectiveDevice.sshSessionVerified}`;
    const diagnosticsNeedFresh = lastDashboardDiagnosticsContextKey !== ctxKey;
    if (diagnosticsNeedFresh) {
      lastDashboardDiagnosticsContextKey = ctxKey;
    }

    const load = (fresh: boolean) => {
      if (!isDeviceShownOnline(effectiveDevice)) {
        if (!cancelled) {
          setMetrics({
            memory: '--',
            temp: '--',
            cpu: '--',
            bpu: '--',
            disk: '--',
            uptime: '--',
            tempC: -1,
            memPct: -1,
            cpuVal: -1,
            bpuVal: -1,
            diskPct: -1,
            boardModelProbe: '',
          });
        }
        return;
      }
      fetchDeviceDiagnostics(deviceId, { fresh })
        .then((r) => {
          if (cancelled) return;
          const m = parseMetrics(r.output, {
            boardModel: effectiveDevice.boardModel,
            boardPlatform: effectiveDevice.boardPlatform,
          });
          const memory = formatDashboardMemoryDisplay(
            m,
            effectiveDevice.boardModel,
            effectiveDevice.boardPlatform,
          );
          const disk =
            m.diskUsed !== '--' && m.diskTotal !== '--' ? `${m.diskUsed}/${m.diskTotal}` : '--';
          setMetrics({
            memory,
            temp: m.temp,
            cpu: m.cpuUsage,
            bpu: m.bpu,
            disk,
            uptime: m.uptime,
            tempC: m.tempC,
            memPct: m.memPercent,
            cpuVal: m.cpuUsageVal,
            bpuVal: m.bpuValue,
            diskPct: m.diskPercent,
            boardModelProbe: m.boardModelFromProbe,
          });
        })
        .catch(() => {
          if (!cancelled) {
            setMetrics({
              memory: '--',
              temp: '--',
              cpu: '--',
              bpu: '--',
              disk: '--',
              uptime: '--',
              tempC: -1,
              memPct: -1,
              cpuVal: -1,
              bpuVal: -1,
              diskPct: -1,
              boardModelProbe: '',
            });
          }
        });
    };
    let diagKick: ReturnType<typeof setTimeout> | null = null;
    let diagIv: ReturnType<typeof setInterval> | null = null;
    diagKick = setTimeout(() => {
      load(diagnosticsNeedFresh);
      diagIv = setInterval(() => load(false), DEVICE_DIAGNOSTICS_POLL_MS);
    }, DEVICE_POLL_PHASE_DIAGNOSTICS_MS);
    return () => {
      cancelled = true;
      if (diagKick) clearTimeout(diagKick);
      if (diagIv) clearInterval(diagIv);
    };
  }, [effectiveDevice?.id, effectiveDevice?.status, effectiveDevice?.sshSessionVerified]);

  const partnerSkillSyncedRef = useRef<Set<string>>(new Set());
  /** 已尝试过同步同伴技能（避免 health 轮询重复打 SSH） */
  const partnerSkillAttemptedRef = useRef<Set<string>>(new Set());
  const boardSkillBundleSyncedRef = useRef<Set<string>>(new Set());

  const effectiveDeviceRef = useRef(effectiveDevice);
  effectiveDeviceRef.current = effectiveDevice;

  useEffect(() => {
    if (!effectiveDevice) {
      setOpenclawHealth(null);
      setWsHealth(null);
      return;
    }
    const id = effectiveDevice.id;
    setOpenclawHealth(openClawFromStudioHints(id));
    setWsHealth(readDashboardWorkspaceHealthCache(id));

    let cancelled = false;
    const loadBoardHealth = async () => {
      const dev = effectiveDeviceRef.current;
      if (!dev || dev.id !== id) return;
      try {
        const r = await fetchDeviceOpenClawHealth(id);
        if (cancelled) return;
        setOpenclawHealth(r.status);
        persistOpenClawHealthSnapshot(id, r.status);
        if (!cancelled && r.ok && r.status.installed) {
          const latestDev = effectiveDeviceRef.current;
          const runBoardBundle = () => {
            if (boardSkillBundleSyncedRef.current.has(id)) return;
            void ensureBoardSkillBundle(id)
              .then((bundleRes) => {
                if (!bundleRes?.ok) return;
                boardSkillBundleSyncedRef.current.add(id);
                const freshDev = effectiveDeviceRef.current;
                persistBoardSkillBundleHint(id, {
                  platform: bundleRes.platform ?? freshDev?.boardPlatform,
                  model: freshDev?.boardModel,
                  synced: true,
                });
              })
              .catch(() => {});
          };
          if (!partnerSkillAttemptedRef.current.has(id)) {
            partnerSkillAttemptedRef.current.add(id);
            void ensurePartnerAdvisorySkill(id)
              .then((res) => {
                if (res?.ok && res.verified === true) partnerSkillSyncedRef.current.add(id);
              })
              .catch(() => {})
              .finally(() => {
                runBoardBundle();
              });
          } else {
            runBoardBundle();
          }
        }
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      try {
        const r = await fetchDeviceWorkspaceHealth(id);
        if (cancelled) return;
        const mods = r.status?.modules ?? null;
        setWsHealth(mods);
        if (mods) {
          writeDashboardWorkspaceHealthCache(id, mods);
        }
      } catch {
        /* ignore */
      }
    };

    let healthKick: ReturnType<typeof setTimeout> | null = null;
    let healthIv: ReturnType<typeof setInterval> | null = null;
    healthKick = setTimeout(() => {
      void loadBoardHealth();
      healthIv = setInterval(() => {
        void loadBoardHealth();
      }, DEVICE_DIAGNOSTICS_POLL_MS);
    }, DEVICE_POLL_PHASE_BOARD_HEALTH_MS);
    return () => {
      cancelled = true;
      if (healthKick) clearTimeout(healthKick);
      if (healthIv) clearInterval(healthIv);
    };
  }, [effectiveDevice?.id]);

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
  const connectJustCompleted = obStep === 'connect' && !!effectiveDevice;
  const showOnboarding = onboardingInProgress && (!currentDevice || postConnectSteps || connectJustCompleted);

  if (showOnboarding) {
    return (
      <div className="dash">
        <FlowingGradientBg accent={!!effectiveDevice} />
        <div className="dash-morph-halo" />
        <div className="dash-morph-halo secondary" />
        <OnboardingWizard />
      </div>
    );
  }

  if (!effectiveDevice) {
    return (
      <div className="dash">
        <FlowingGradientBg accent={false} />
        <div className="dash-morph-halo" />
        <div className="dash-morph-halo secondary" />
        <div className="dash-empty-hero">
          <div className="dash-brand dash-enter">RDK Studio</div>
          <p className="dash-tagline dash-enter dash-enter-d1">{t('dashboard.tagline', '连接开发者套件后即可开始')}</p>
          <button type="button" className="dash-action primary dash-enter dash-enter-d2" onClick={() => setShowAddDevice(true)}>
            <span className="dash-action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </span>
            {t('dashboard.addDevice', '添加设备')}
          </button>
          <div className="dash-nodevice-actions dash-enter dash-enter-d3">
            <button className="btn btn-ghost" onClick={() => prompt(isEn ? DASHBOARD_CHAT_INTRO_PROMPT_EN : DASHBOARD_CHAT_INTRO_PROMPT_ZH)}>
              {t('dashboard.chatFirst', '打开对话')}
            </button>
            <button className="btn btn-ghost" onClick={() => setObStep('board')}>
              {t('dashboard.restartOnboarding', '重新开始引导')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const boardModelDisplay = formatDashboardBoardModelDisplay(
    String(effectiveDevice.boardModel || '').trim() || metrics.boardModelProbe.trim(),
  );

  const stats = [
    { key: 'mem', val: metrics.memory, label: t('dashboard.metric.mem', 'MEM'), warn: metrics.memPct >= 90 },
    { key: 'temp', val: metrics.temp, label: t('dashboard.metric.temp', 'TEMP'), warn: metrics.tempC >= 85 },
    { key: 'cpu', val: metrics.cpu, label: t('dashboard.metric.cpu', 'CPU'), warn: metrics.cpuVal >= 90 },
    { key: 'bpu', val: metrics.bpu, label: t('dashboard.metric.bpu', 'BPU'), warn: metrics.bpuVal >= 90 },
    {
      key: 'disk',
      val: metrics.disk,
      label: t('dashboard.metric.disk', 'DISK'),
      warn: metrics.diskPct >= 90,
    },
    { key: 'up', val: metrics.uptime, label: t('dashboard.metric.uptime', 'UPTIME') },
  ];

  /** 与顶栏同源：须本机已验证过 SSH 且当前 ping 为在线 */
  const deviceChannelOk = !!effectiveDevice && isDeviceShownOnline(effectiveDevice);

  return (
    <div className="dash" onMouseMove={parallax.onMove} onMouseLeave={parallax.onLeave}>
      <FlowingGradientBg accent={true} />
      <div className="dash-morph-halo" />
      <div className="dash-morph-halo secondary" />

      {/* ── Hero: device name as the centerpiece ── */}
      <div className="lp-hero lp-enter">
        <div className="lp-status-row">
          <span className={`lp-pill ${studioBackendOk ? 'ok' : ''}`} title={studioBackendOk ? t('dashboard.rdkclaw.ok', 'RDKClaw 工作站服务正常') : studioBackendOk === null ? t('dashboard.rdkclaw.checking', 'RDKClaw 状态检测中…') : t('dashboard.rdkclaw.down', 'RDKClaw 工作站服务异常')}>
            <span
              className={`status-dot ${
                studioBackendOk === null ? 'warn' : studioBackendOk ? 'online' : 'offline'
              }`}
            />
            <BadgeCheck size={14} strokeWidth={2.25} className="lp-pill-mark" aria-hidden />
            RDKClaw
          </span>
          <span
            className={`lp-pill ${
              openclawHealth?.installed || openclawHealth?.gatewayRunning
                ? (deviceNetUp === false ? '' : 'ok')
                : ''
            }`}
            title={
              openclawHealth == null
                ? t('dashboard.oc.checking', 'OpenClaw 状态检测中…')
                : !openclawHealth.installed
                  ? t('dashboard.oc.notInstalled', 'OpenClaw 未安装，请进入 OpenClaw 页面部署')
                  : deviceNetUp === false
                    ? t('dashboard.oc.noNetwork', 'OpenClaw 已安装但开发者套件未联网，无法访问云端模型')
                    : openclawHealth.gatewayRunning
                      ? t('dashboard.oc.ready', 'OpenClaw 已就绪')
                      : t('dashboard.oc.gwDown', 'OpenClaw 已安装但网关未运行')
            }
          >
            <span
              className={`status-dot ${
                openclawHealth == null
                  ? 'warn'
                  : openclawHealth.installed || openclawHealth.gatewayRunning
                    ? (deviceNetUp === false ? 'warn' : 'online')
                    : 'offline'
              }`}
            />
            <Shrimp size={14} strokeWidth={2.25} className="lp-pill-mark" aria-hidden />
            OpenClaw
          </span>
          <span className={`lp-pill ${deviceChannelOk ? 'online' : ''}`} title={deviceChannelOk ? t('dashboard.device.onlineDetail', '设备 SSH 已连接，可正常通信') : t('dashboard.device.offlineDetail', '设备未连接，请检查 USB/ 网线连接')}>
            <span className={`status-dot ${deviceChannelOk ? 'online' : 'offline'}`} />
            {deviceChannelOk
              ? t('dashboard.deviceOnline', '设备在线')
              : t('dashboard.deviceOffline', '设备离线')}
          </span>
        </div>
        <h1 className="lp-device-name">{effectiveDevice.name}</h1>
        {boardModelDisplay && (
          <p className="lp-device-model" title={boardModelDisplay}>
            <span className="lp-device-model-label">{t('dashboard.deviceModel', '设备型号')}</span>
            <span className="lp-device-model-value">{boardModelDisplay}</span>
          </p>
        )}
        {deviceNetUp === false && deviceChannelOk && (
          <p className="lp-network-warn" style={{ color: 'var(--color-accent, #e67e22)', fontSize: '0.82rem', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            {t('dashboard.networkWarn', '开发者套件已连接但未联网 — AI 对话、软件安装等依赖网络的功能暂不可用')}
          </p>
        )}
      </div>

      {/* ── Live metrics strip ── */}
      <div className="lp-metrics lp-enter lp-d1">
        {stats.map((s, i) => (
          <div key={s.key} className={`lp-metric ${(s as any).warn ? 'warn' : ''}`} style={{ animationDelay: `${200 + i * 60}ms` }}>
            <span className="lp-metric-val"><AnimatedNumber value={s.val} /></span>
            <span className="lp-metric-lbl">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── CTA: primary action ── */}
      <div className="lp-cta lp-enter lp-d2">
        <button className="lp-cta-btn primary" onClick={() => prompt(isEn ? ONE_SHOT_DEV_WORKFLOW_PROMPT_EN : ONE_SHOT_DEV_WORKFLOW_PROMPT_ZH)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/></svg>
          {t('dashboard.oneShotDev', '快捷开发')}
        </button>
        <button className="lp-cta-btn" onClick={() => setActiveTab('terminal')}>Terminal</button>
        <button className="lp-cta-btn" onClick={() => setActiveTab('openclaw')}>OpenClaw</button>
        <button className="lp-cta-btn" onClick={() => prompt(isEn ? DASHBOARD_HEALTH_CHECK_PROMPT_EN : DASHBOARD_HEALTH_CHECK_PROMPT_ZH)}>{t('dashboard.healthCheck', '设备体检')}</button>
      </div>

      {/* ── Workspace capability badges ── */}
      {wsHealth && (
        <div className="lp-caps lp-enter lp-d3">
          {([
            { key: 'development', label: t('dashboard.cap.dev', '开发环境'), tab: 'terminal' as const },
            { key: 'codeServer', label: 'IDE', tab: 'ide' as const },
            { key: 'vnc', label: t('dashboard.cap.vnc', '远程桌面'), tab: 'vnc' as const },
          ]).map(item => {
            const mod = wsHealth[item.key] as WorkspaceModule | undefined;
            if (!mod) return null;
            return (
              <button key={item.key} className={`lp-cap ${mod.ready ? 'ready' : ''}`} onClick={() => setActiveTab(item.tab)}>
                <span className={`lp-cap-dot ${mod.ready ? 'ok' : mod.installed ? 'partial' : ''}`} />
                <span className="lp-cap-name">{item.label}</span>
                <span className="lp-cap-status">{mod.ready ? t('dashboard.cap.ready', '就绪') : mod.installed ? t('dashboard.cap.notRunning', '未启动') : t('dashboard.cap.notInstalled', '未安装')}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
