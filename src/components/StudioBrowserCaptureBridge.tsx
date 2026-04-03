import { useEffect, useState, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import { resolveSocketUrl, socketIoClientOptions } from '../utils/socket';
import { fetchApi } from '../utils/apiBase';
import { dispatchStudioAgentWebOpen } from '../utils/studio-agent-web';

function coerceStudioWebUrl(raw: string): string {
  const u = String(raw || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/.*)?$/i.test(u)) return `https://${u}`;
  return '';
}

/** 抓取回退路径：主窗口内嵌（需 captureEmbeddedPageText / closeUrl） */
function openCaptureEmbedInMain(url: string) {
  const rdk = window.rdkDesktop;
  if (rdk?.openUrl) {
    rdk.openUrl(url);
    rdk.setActiveUrl?.(url);
    dispatchStudioAgentWebOpen(url);
  }
}

/** studio_open_url：桌面端优先独立 BrowserWindow（默认可缩放、非全屏、系统关闭）；失败再回退主窗口内嵌或 window.open */
async function openStudioAgentBrowsePopup(url: string) {
  const rdk = window.rdkDesktop;
  if (rdk?.openAgentBrowserPopup) {
    const r = await rdk.openAgentBrowserPopup(url);
    if (r?.ok) return;
  }
  if (rdk?.openUrl) {
    openCaptureEmbedInMain(url);
    return;
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    /* ignore */
  }
}

type Pending = {
  captureId: string;
  url: string;
};

const POLL_MS = 1400;
/** 自动提交最低正文字符数（过高会导致 SPA/长页未稳定时永远不提交） */
const MIN_AUTO_CHARS = 120;
const STABLE_TICKS = 2;
/** 页面打开后至少展示多久再自动提交（秒），便于用户看到内容 */
const MIN_VISIBLE_MS = 5000;
/** 打开超过此时长仍满足「有正文、已稳定」则强制提交，避免永远不结束 */
const FORCE_SUBMIT_AFTER_MS = 75_000;

function looksLikeLoginShell(text: string): boolean {
  const t = text.trim();
  if (t.length > 4000) return false;
  if (t.length > 800 && /项目|描述|RDK|GitHub|Apache|官方/i.test(t)) return false;
  return /请\s*登录|登录\s*\/\s*注册|请先登录/i.test(t);
}

type CaptureMode = 'floating' | 'embed';

async function capturePageFromDesktop(cap: Pending, mode: CaptureMode | null) {
  const rdk = window.rdkDesktop;
  if (mode === 'floating' && rdk?.captureFloatingPageText) {
    return rdk.captureFloatingPageText(cap.captureId);
  }
  if (mode === 'embed' && rdk?.captureEmbeddedPageText) {
    return rdk.captureEmbeddedPageText(cap.url);
  }
  return { ok: false as const, error: '不可用' };
}

async function closeCaptureUi(cap: Pending) {
  const rdk = window.rdkDesktop;
  if (rdk?.closeFloatingCapture) {
    await rdk.closeFloatingCapture(cap.captureId);
  } else if (rdk?.closeUrl) {
    rdk.closeUrl(cap.url);
  }
}

type DockMode = 'hidden' | 'full';

/**
 * Agent studio_embedded_browser_capture：独立小悬浮窗浏览页面，主界面不再被全屏 WebContentsView 挡住。
 * 悬浮窗成功时隐藏主界面右下角条；自动轮询并在正文稳定且满足最短展示时间后提交。
 */
export default function StudioBrowserCaptureBridge() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [dockMode, setDockMode] = useState<DockMode>('full');
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState('');
  const [hint, setHint] = useState('');
  const [status, setStatus] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  const pollRef = useRef<number | null>(null);
  /** 抓取页已就绪的时间戳（悬浮窗 load 成功或内嵌 openUrl）；0 表示尚未就绪 */
  const captureOpenedAtRef = useRef(0);
  /** 悬浮窗打开时绝不能走内嵌 IPC（viewsMap 无该 URL，会报 No handler） */
  const captureModeRef = useRef<CaptureMode | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const submitText = useCallback(async (text: string, opts?: { closeEmbed?: boolean }) => {
    const cap = pendingRef.current;
    if (!cap?.captureId) return;
    const closeEmbed = opts?.closeEmbed !== false;
    setBusy(true);
    setHint('');
    try {
      const res = await fetchApi('/api/studio/browser-capture/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId: cap.captureId, text }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setHint(j.error || `提交失败 HTTP ${res.status}`);
        return;
      }
      if (closeEmbed) {
        await closeCaptureUi(cap);
      }
      setPending(null);
      setDockMode('full');
      setPaste('');
      setStatus('');
      captureOpenedAtRef.current = 0;
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const cap = pendingRef.current;
    if (!cap?.captureId) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      await fetchApi('/api/studio/browser-capture/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId: cap.captureId }),
      });
    } catch {
      /* ignore */
    } finally {
      await closeCaptureUi(cap);
      setBusy(false);
      setPending(null);
      setDockMode('full');
      setPaste('');
      setStatus('');
      captureOpenedAtRef.current = 0;
    }
  }, []);

  useEffect(() => {
    const socket = io(resolveSocketUrl(), socketIoClientOptions);
    const onReq = (data: { captureId?: string; url?: string }) => {
      const captureId = String(data?.captureId || '').trim();
      const url = coerceStudioWebUrl(String(data?.url || ''));
      if (!captureId || !url) return;
      captureOpenedAtRef.current = 0;
      setPending({ captureId, url });
      setPaste('');
      setHint('');
      setStatus('正在打开页面…');
      setShowPaste(false);
      setDockMode('full');

      const rdk = window.rdkDesktop;
      if (rdk?.openFloatingCaptureBrowser) {
        captureModeRef.current = 'floating';
        setDockMode('hidden');
      } else if (rdk?.openUrl) {
        captureModeRef.current = 'embed';
      } else {
        captureModeRef.current = null;
      }

      void (async () => {
        if (rdk?.openFloatingCaptureBrowser) {
          const r = await rdk.openFloatingCaptureBrowser({ captureId, url });
          if (r?.ok) {
            captureOpenedAtRef.current = Date.now();
            setStatus('抓取窗口已打开，正文就绪后将自动提交（至少展示约 5s）');
            return;
          }
          setHint(r?.error || '无法打开悬浮窗口');
          captureModeRef.current = 'embed';
          setDockMode('full');
          if (rdk.openUrl) {
            openCaptureEmbedInMain(url);
            captureOpenedAtRef.current = Date.now();
          }
          setStatus('已回退到主窗口内嵌，请用下方按钮抓取');
          return;
        }
        if (rdk?.openUrl) {
          openCaptureEmbedInMain(url);
          captureOpenedAtRef.current = Date.now();
          setStatus('已打开内嵌页（旧版），请用下方按钮抓取');
        }
      })();
    };
    const onOpenUrl = (data: { url?: string }) => {
      const url = coerceStudioWebUrl(String(data?.url || ''));
      if (!url) return;
      void openStudioAgentBrowsePopup(url);
    };
    const onLocalPreview = (data: { filePath?: string }) => {
      const fp = String(data?.filePath || '').trim();
      if (!fp) return;
      const rdk = window.rdkDesktop;
      if (rdk?.openLocalPreview) {
        void rdk.openLocalPreview(fp).then((r) => {
          if (!r?.ok) {
            console.warn('[studio_open_local_preview]', r?.error || 'open failed');
          }
        });
      }
    };

    socket.on('studio_browser_capture_request', onReq);
    socket.on('studio_open_url_request', onOpenUrl);
    socket.on('studio_open_local_preview_request', onLocalPreview);
    return () => {
      socket.off('studio_browser_capture_request', onReq);
      socket.off('studio_open_url_request', onOpenUrl);
      socket.off('studio_open_local_preview_request', onLocalPreview);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const mode = captureModeRef.current;
    const rdk = window.rdkDesktop;
    const hasNeeded =
      mode === 'floating'
        ? !!rdk?.captureFloatingPageText
        : mode === 'embed'
          ? !!rdk?.captureEmbeddedPageText
          : !!(rdk?.captureFloatingPageText || rdk?.captureEmbeddedPageText);
    if (!hasNeeded) {
      setStatus('非桌面端：请用手动粘贴');
      return;
    }

    let lastSample = '';
    let stable = 0;
    let submitted = false;
    setStatus('等待页面加载，将自动抓取…');

    const tick = async () => {
      if (submitted) return;
      const cap = pendingRef.current;
      if (!cap) return;

      const openedAt = captureOpenedAtRef.current;
      if (openedAt === 0) {
        setStatus('正在打开页面…');
        return;
      }

      const r = await capturePageFromDesktop(cap, captureModeRef.current);
      if (!r.ok || !(r.text || '').trim()) {
        setStatus('等待页面内容…');
        return;
      }
      const text = (r.text || '').trim();
      const elapsed = Date.now() - openedAt;

      if (looksLikeLoginShell(text)) {
        setStatus('检测到登录页，请先在小窗口登录；登录后仍会自动提交');
        lastSample = '';
        stable = 0;
        return;
      }

      if (text.length < MIN_AUTO_CHARS) {
        if (elapsed >= FORCE_SUBMIT_AFTER_MS && text.length >= 60) {
          submitted = true;
          if (pollRef.current != null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          void submitText(text, { closeEmbed: true });
          return;
        }
        setStatus(`加载中…（${text.length} 字）`);
        lastSample = '';
        stable = 0;
        return;
      }

      if (text === lastSample) {
        stable += 1;
        setStatus(`内容已稳定 ${stable}/${STABLE_TICKS}…`);
      } else {
        lastSample = text;
        stable = 0;
        setStatus(`分析正文…（${text.length} 字）`);
      }
      if (stable >= STABLE_TICKS) {
        if (elapsed < MIN_VISIBLE_MS) {
          const leftSec = Math.max(1, Math.ceil((MIN_VISIBLE_MS - elapsed) / 1000));
          setStatus(`正文已就绪，约 ${leftSec}s 后自动提交…`);
          return;
        }
        submitted = true;
        if (pollRef.current != null) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
        void submitText(text, { closeEmbed: true });
        return;
      }
      if (elapsed >= FORCE_SUBMIT_AFTER_MS && text.length >= MIN_AUTO_CHARS) {
        submitted = true;
        if (pollRef.current != null) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
        void submitText(text, { closeEmbed: true });
      }
    };

    const id = window.setTimeout(() => void tick(), 800);
    pollRef.current = window.setInterval(() => void tick(), POLL_MS);

    return () => {
      window.clearTimeout(id);
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [pending, submitText]);

  const onManualCapture = useCallback(async () => {
    const cap = pendingRef.current;
    if (!cap) return;
    setBusy(true);
    setHint('');
    try {
      const r = await capturePageFromDesktop(cap, captureModeRef.current);
      if (r.ok && (r.text || '').trim()) {
        await submitText(r.text || '', { closeEmbed: true });
        return;
      }
      setHint((r as { error?: string }).error || '读取失败，可尝试手动粘贴。');
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [submitText]);

  if (!pending) return null;

  /** 悬浮成功时仍保留一条窄条，避免自动条件未满足时无法手动「立即抓取」 */
  if (dockMode === 'hidden') {
    return (
      <div
        className="fixed bottom-4 right-4 z-[12000] flex items-center gap-2 pointer-events-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 shadow-lg"
        style={{ fontSize: 11, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
      >
        <span className="text-[var(--text-muted)] max-w-[10rem] truncate" title={pending.url}>
          抓取中
        </span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ fontSize: 11, padding: '2px 8px' }}
          disabled={busy}
          onClick={() => void onManualCapture()}
        >
          立即抓取
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 11, padding: '2px 8px' }}
          disabled={busy}
          onClick={() => void cancel()}
        >
          取消
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[12000] max-w-[min(100vw-2rem,22rem)] pointer-events-none"
      style={{ fontSize: 12 }}
    >
      <div
        className="pointer-events-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-lg"
        style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}
      >
        <div className="font-medium text-[var(--text)] mb-1">网页正文抓取</div>
        <p className="text-[var(--text-muted)] mb-2 leading-snug">{status || '准备中…'}</p>
        <div className="text-[10px] break-all text-[var(--text-muted)] opacity-90 mb-2 max-h-10 overflow-hidden">
          {pending.url}
        </div>
        {hint ? <div className="mb-2 text-amber-600 dark:text-amber-400 text-[11px]">{hint}</div> : null}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ fontSize: 11, padding: '4px 10px' }}
            disabled={busy}
            onClick={() => void onManualCapture()}
          >
            立即抓取并结束
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11, padding: '4px 10px' }}
            disabled={busy}
            onClick={() => void cancel()}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setShowPaste((v) => !v)}
          >
            {showPaste ? '收起粘贴' : '手动粘贴'}
          </button>
        </div>
        {showPaste ? (
          <>
            <textarea
              className="w-full min-h-[72px] mt-2 rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-[11px] font-mono"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="粘贴页面文字…"
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-1"
              style={{ fontSize: 11 }}
              disabled={busy || !paste.trim()}
              onClick={() => void submitText(paste, { closeEmbed: true })}
            >
              提交粘贴并关闭
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
