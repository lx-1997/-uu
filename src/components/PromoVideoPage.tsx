import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import '../promo-video.css';

const TOTAL_MS = 30_000;

/** 在 .env 中设置 VITE_PROMO_TRIAL_URL=你的预约/试用链接，二维码会指向该地址 */
const TRIAL_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PROMO_TRIAL_URL) ||
  'https://www.d-robotics.cc/rdk_doc';

type SceneId =
  | 'intro'
  | 'quickstart'
  | 'env'
  | 'device'
  | 'workflow'
  | 'logs'
  | 'outro';

type Scene = {
  id: SceneId;
  untilMs: number;
  /** QR 下方「当前功能」小标签 */
  qrSceneLabel: string;
  headline: string;
  sub?: string;
};

const SCENES: Scene[] = [
  { id: 'intro', untilMs: 2000, qrSceneLabel: '片头', headline: 'RDK Studio', sub: '面向开发者的一站式工作台' },
  {
    id: 'quickstart',
    untilMs: 6000,
    qrSceneLabel: '快速开始',
    headline: '降低上手门槛',
    sub: '向导与模板，把「第一次」变成可复制的流程',
  },
  {
    id: 'env',
    untilMs: 12_000,
    qrSceneLabel: '环境配置',
    headline: '从 0 到 1，更快',
    sub: '依赖与检查项集中呈现，少切工具、少踩坑',
  },
  {
    id: 'device',
    untilMs: 18_000,
    qrSceneLabel: '设备连接',
    headline: '连接、配置、状态，一屏掌握',
    sub: '设备就绪一眼可见，减少反复核对',
  },
  {
    id: 'workflow',
    untilMs: 24_000,
    qrSceneLabel: '任务编排',
    headline: '把流程变成「一键执行」',
    sub: '构建、部署、运行 — 步骤流水线化',
  },
  {
    id: 'logs',
    untilMs: 28_000,
    qrSceneLabel: '日志诊断',
    headline: '结果清晰、问题可追踪',
    sub: '日志过滤与定位，迭代更快闭环',
  },
  {
    id: 'outro',
    untilMs: TOTAL_MS,
    qrSceneLabel: '预约演示',
    headline: 'RDK Studio',
    sub: '加速你的开发进度 · 扫码申请试用',
  },
];

function sceneAt(elapsedMs: number): Scene {
  for (const s of SCENES) {
    if (elapsedMs < s.untilMs) return s;
  }
  return SCENES[SCENES.length - 1]!;
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${String(s).padStart(2, '0')}:${String(c).padStart(2, '0')}`;
}

export default function PromoVideoPage() {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const playingRef = useRef(playing);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(TRIAL_URL, {
      margin: 1,
      width: 220,
      color: { dark: '#0a0e16', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setQrSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const tick = useCallback((now: number) => {
    if (!playingRef.current) return;
    if (startRef.current == null) startRef.current = now;
    const next = Math.min(now - startRef.current, TOTAL_MS);
    setElapsedMs(next);
    if (next >= TOTAL_MS) {
      setPlaying(false);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    startRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, tick]);

  const scene = useMemo(() => sceneAt(elapsedMs), [elapsedMs]);

  const restart = useCallback(() => {
    startRef.current = null;
    setElapsedMs(0);
    setPlaying(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === 'r' || e.key === 'R') restart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [restart]);

  const progressPct = Math.min(100, (elapsedMs / TOTAL_MS) * 100);

  const mockActiveTab = useMemo(() => {
    switch (scene.id) {
      case 'quickstart':
        return 'dashboard';
      case 'env':
        return 'openclaw';
      case 'device':
        return 'dashboard';
      case 'workflow':
        return 'openclaw';
      case 'logs':
        return 'terminal';
      default:
        return 'dashboard';
    }
  }, [scene.id]);

  const showMock = scene.id !== 'intro' && scene.id !== 'outro';

  return (
    <div className="promo-video-root" role="presentation">
      <div className="promo-scanlines" aria-hidden />
      <div className="promo-vignette" aria-hidden />

      <div className="promo-hud">
        <div className="promo-brand">
          <strong>RDK Studio</strong>
          <span>宣传短片 · 30s</span>
        </div>
        <div className="promo-time">
          {formatTime(elapsedMs)} / {formatTime(TOTAL_MS)}
          {!playing ? ' · 已暂停' : ''}
        </div>
      </div>

      {scene.id === 'intro' || scene.id === 'outro' ? (
        <div className="promo-floating-tagline" aria-hidden={false}>
          <div className="promo-big-line">{scene.headline}</div>
          {scene.sub ? <div className="promo-small-line">{scene.sub}</div> : null}
          {scene.id === 'intro' ? <div className="promo-caption-chip">降低上手门槛 · 加速开发进度</div> : null}
          <div className="promo-hero-line" />
        </div>
      ) : null}

      {showMock ? (
        <div className="promo-stage">
          <div
            className="promo-mock-frame"
            style={{
              animation: 'promo-title-in 0.55s ease-out both',
            }}
          >
            <div className="promo-pulse-ring" aria-hidden />
            <div className="promo-mock-topbar">
              <span className="promo-dot" />
              <span className="promo-dot" />
              <span className="promo-dot" />
              <span className="promo-mock-title">RDK Studio — 演示画面（示意）</span>
            </div>
            <div className="promo-mock-body">
              <aside className="promo-mock-rail">
                <div className={`promo-rail-item ${mockActiveTab === 'dashboard' ? 'is-active' : ''}`}>工作台</div>
                <div className={`promo-rail-item ${mockActiveTab === 'openclaw' ? 'is-active' : ''}`}>OpenClaw</div>
                <div className={`promo-rail-item ${mockActiveTab === 'terminal' ? 'is-active' : ''}`}>终端</div>
                <div className="promo-rail-item">设备</div>
                <div className="promo-rail-item">文件</div>
              </aside>
              <div className="promo-mock-main">
                <MockSceneBody sceneId={scene.id} t={elapsedMs} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {scene.id !== 'intro' && scene.id !== 'outro' ? (
        <div className="promo-floating-tagline" style={{ top: '11%' }} aria-hidden={false}>
          <div className="promo-big-line">{scene.headline}</div>
          {scene.sub ? <div className="promo-small-line">{scene.sub}</div> : null}
        </div>
      ) : null}

      {qrSrc ? (
        <div className="promo-qr-dock">
          <img src={qrSrc} alt="预约试用二维码" width={108} height={108} />
          <div className="promo-qr-scene">{scene.qrSceneLabel}</div>
          <div className="promo-qr-caption">扫码申请试用 / 预约演示</div>
        </div>
      ) : (
        <div className="promo-qr-dock" aria-busy="true">
          <div
            style={{
              width: 108,
              height: 108,
              borderRadius: 6,
              background: 'rgba(255,255,255,0.08)',
            }}
          />
          <div className="promo-qr-caption">生成二维码中…</div>
        </div>
      )}

      <div className="promo-controls-hint">空格 暂停/继续 · R 重播 · 浏览器全屏便于录屏</div>
      <div className="promo-progress" aria-hidden>
        <div className="promo-progress-bar" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}

function MockSceneBody({ sceneId, t }: { sceneId: SceneId; t: number }) {
  const phase = Math.floor((t % 1600) / 400);

  if (sceneId === 'quickstart') {
    return (
      <>
        <div className="promo-card-row">
          <div className="promo-card">
            <strong>新建项目向导</strong>
            <span>模板选择 · 一键初始化工作区</span>
          </div>
          <div className="promo-card">
            <strong>推荐工作流</strong>
            <span>从连接到首跑，步骤已排好</span>
          </div>
        </div>
        <div className="promo-steps">
          <div className={`promo-step-pill ${phase >= 0 ? 'is-on' : ''}`}>选模板</div>
          <div className={`promo-step-pill ${phase >= 1 ? 'is-on' : ''}`}>配路径</div>
          <div className={`promo-step-pill ${phase >= 2 ? 'is-on' : ''}`}>创建</div>
          <div className={`promo-step-pill ${phase >= 3 ? 'is-on' : ''}`}>首跑</div>
        </div>
      </>
    );
  }

  if (sceneId === 'env') {
    return (
      <>
        <div className="promo-card-row">
          <div className="promo-card">
            <strong>运行环境检查</strong>
            <span>依赖项 / 版本 / 路径 · 一页汇总</span>
          </div>
          <div className="promo-card">
            <strong>修复建议</strong>
            <span>缺失项标红，可一键跟随指引</span>
          </div>
        </div>
        <div className="promo-log">
          <span className="ok">[check]</span> node v22.x · ok
          <br />
          <span className="ok">[check]</span> 工具链 · ok
          <br />
          <span className={phase % 2 === 0 ? 'warn' : 'ok'}>
            [check] 设备探测 {phase % 2 === 0 ? '… retry' : '· ok'}
          </span>
        </div>
      </>
    );
  }

  if (sceneId === 'device') {
    const online = phase >= 1;
    return (
      <>
        <div className="promo-card-row">
          <div className="promo-card">
            <strong>设备 · rdk-board-01</strong>
            <span>{online ? 'SSH 已连接 · 心跳正常' : '正在连接…'}</span>
          </div>
          <div className="promo-card">
            <strong>状态面板</strong>
            <span>IP / 架构 / Agent 版本</span>
          </div>
        </div>
        <div className="promo-steps">
          <div className={`promo-step-pill ${phase >= 0 ? 'is-on' : ''}`}>发现</div>
          <div className={`promo-step-pill ${phase >= 1 ? 'is-on' : ''}`}>认证</div>
          <div className={`promo-step-pill ${phase >= 2 ? 'is-on' : ''}`}>同步</div>
          <div className={`promo-step-pill ${phase >= 3 ? 'is-on' : ''}`}>就绪</div>
        </div>
      </>
    );
  }

  if (sceneId === 'workflow') {
    const step = Math.min(3, Math.floor((t % 2200) / 550));
    return (
      <>
        <div className="promo-card-row">
          <div className="promo-card">
            <strong>编排任务</strong>
            <span>Build → Deploy → Run</span>
          </div>
          <div className="promo-card">
            <strong>一键执行</strong>
            <span>步骤自动推进 · 可重复运行</span>
          </div>
        </div>
        <div className="promo-steps">
          <div className={`promo-step-pill ${step >= 0 ? 'is-on' : ''}`}>Build</div>
          <div className={`promo-step-pill ${step >= 1 ? 'is-on' : ''}`}>Deploy</div>
          <div className={`promo-step-pill ${step >= 2 ? 'is-on' : ''}`}>Run</div>
          <div className={`promo-step-pill ${step >= 3 ? 'is-on' : ''}`}>Done</div>
        </div>
      </>
    );
  }

  if (sceneId === 'logs') {
    return (
      <>
        <div className="promo-card-row">
          <div className="promo-card">
            <strong>日志视图</strong>
            <span>过滤 / 搜索 / 关键行高亮</span>
          </div>
          <div className="promo-card">
            <strong>结果回传</strong>
            <span>成功与失败一眼分辨</span>
          </div>
        </div>
        <div className="promo-log">
          <span className="ok">[task]</span> pipeline finished in 3.2s
          <br />
          <span className="warn">[warn]</span> deprecated flag — ignored
          <br />
          <span className="ok">[done]</span> artifact ready · /out/build.zip
        </div>
      </>
    );
  }

  return null;
}
