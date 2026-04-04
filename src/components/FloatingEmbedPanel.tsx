import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const STORAGE_PREFIX = 'rdk-float-embed:';

/**
 * 浏览器端：将 iframe 嵌入区变为可拖拽悬浮层，便于与 AI Dock 并排对照。
 * 悬浮层通过 Portal 挂到 document.body，避免父级 persistent-pane 的 visibility:hidden 把 fixed 层一并隐藏。
 * 桌面端由 Electron 独立 WebContentsView 实现，不使用本组件。
 */
export default function FloatingEmbedPanel({
  title,
  dockLabel,
  floating,
  onFloatingChange,
  children,
  backfill,
  dragbarExtra,
  storageKey,
}: {
  title: string;
  dockLabel: string;
  floating: boolean;
  onFloatingChange: (floating: boolean) => void;
  children: ReactNode;
  /** 悬浮时主视口占位（切换侧栏标签后仍可提示） */
  backfill?: ReactNode;
  /** 悬浮条右侧、「贴回」左侧的额外操作（如关闭连接） */
  dragbarExtra?: ReactNode;
  /** sessionStorage 键后缀，用于记住位置与大小 */
  storageKey?: string;
}) {
  const fullKey = storageKey ? `${STORAGE_PREFIX}${storageKey}` : null;
  const floatRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);

  const [pos, setPos] = useState({ x: 40, y: 56 });
  /** null 表示使用 CSS 默认宽高；有值则内联以支持恢复与 resize */
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const persistFromDom = useCallback(() => {
    if (!fullKey) return;
    const el = floatRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    try {
      sessionStorage.setItem(
        fullKey,
        JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height }),
      );
    } catch {
      /* ignore quota / private mode */
    }
  }, [fullKey]);

  const schedulePersist = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => persistFromDom(), 320);
  }, [persistFromDom]);

  /** 贴回主区域时清掉内联尺寸，避免影响下次悬浮从 storage 恢复 */
  useEffect(() => {
    if (!floating) setSize(null);
  }, [floating]);

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  /** 先于 ResizeObserver 从 sessionStorage 恢复，避免被首帧 DOM 尺寸覆盖 */
  useLayoutEffect(() => {
    if (!fullKey || !floating) return;
    try {
      const raw = sessionStorage.getItem(fullKey);
      if (!raw) return;
      const p = JSON.parse(raw) as { x?: number; y?: number; w?: number; h?: number };
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        setPos({ x: p.x, y: p.y });
      }
      if (typeof p.w === 'number' && typeof p.h === 'number' && p.w >= 280 && p.h >= 200) {
        setSize({ w: p.w, h: p.h });
      }
    } catch {
      /* ignore */
    }
  }, [fullKey, floating]);

  useLayoutEffect(() => {
    if (!floating) return;
    const el = floatRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width < 280 || r.height < 200) return;
      setSize((prev) => {
        if (prev && Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5) return prev;
        return { w: r.width, h: r.height };
      });
      schedulePersist();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [floating, schedulePersist]);

  useEffect(() => {
    if (!floating) return;
    const onWinResize = () => {
      const el = floatRef.current;
      const w = el?.offsetWidth ?? 560;
      const h = el?.offsetHeight ?? 420;
      const pad = 8;
      setPos((p) => ({
        x: Math.max(pad, Math.min(p.x, window.innerWidth - w - pad)),
        y: Math.max(pad, Math.min(p.y, window.innerHeight - h - pad)),
      }));
    };
    window.addEventListener('resize', onWinResize);
    return () => window.removeEventListener('resize', onWinResize);
  }, [floating]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: pos.x,
        originY: pos.y,
      };
    },
    [pos.x, pos.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const el = floatRef.current;
    const w = el?.offsetWidth ?? 560;
    const h = el?.offsetHeight ?? 420;
    const pad = 8;
    setPos(() => {
      const nextX = d.originX + dx;
      const nextY = d.originY + dy;
      return {
        x: Math.max(pad, Math.min(nextX, window.innerWidth - w - pad)),
        y: Math.max(pad, Math.min(nextY, window.innerHeight - h - pad)),
      };
    });
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      persistFromDom();
    },
    [persistFromDom],
  );

  const floatEl = (
    <div
      ref={floatRef}
      className="floating-embed-float"
      style={{
        left: pos.x,
        top: pos.y,
        ...(size ? { width: size.w, height: size.h } : {}),
      }}
    >
      <div
        className="floating-embed-dragbar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="toolbar"
        aria-label={title}
      >
        <span className="floating-embed-dragbar-title">{title}</span>
        <div className="floating-embed-dragbar-actions">
          {dragbarExtra}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFloatingChange(false)}>
            {dockLabel}
          </button>
        </div>
      </div>
      <div className="floating-embed-float-body">{children}</div>
    </div>
  );

  if (!floating) {
    return <div className="floating-embed-docked">{children}</div>;
  }

  return (
    <>
      {createPortal(floatEl, document.body)}
      <div className="floating-embed-backfill" role="status" aria-live="polite">
        {backfill ?? (
          <span className="floating-embed-backfill-default">
            内容已移至悬浮窗，可切换到其他页面或打开 AI 对话。
          </span>
        )}
      </div>
    </>
  );
}
