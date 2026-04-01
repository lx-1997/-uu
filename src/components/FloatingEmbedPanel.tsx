import { useCallback, useRef, useState } from 'react';

/**
 * 浏览器端：将 iframe 嵌入区变为可拖拽悬浮层，便于与 AI Dock 并排对照。
 * 桌面端由 Electron 独立 BrowserWindow 实现，不使用本组件。
 */
export default function FloatingEmbedPanel({
  title,
  dockLabel,
  floating,
  onFloatingChange,
  children,
}: {
  title: string;
  dockLabel: string;
  floating: boolean;
  onFloatingChange: (floating: boolean) => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState({ x: 40, y: 56 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

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
    setPos((p) => {
      const nextX = d.originX + dx;
      const nextY = d.originY + dy;
      const maxX = Math.max(16, window.innerWidth - 160);
      const maxY = Math.max(16, window.innerHeight - 120);
      return {
        x: Math.max(8, Math.min(nextX, maxX)),
        y: Math.max(8, Math.min(nextY, maxY)),
      };
    });
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  if (!floating) {
    return <div className="floating-embed-docked">{children}</div>;
  }

  return (
    <div className="floating-embed-float" style={{ left: pos.x, top: pos.y }}>
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFloatingChange(false)}>
          {dockLabel}
        </button>
      </div>
      <div className="floating-embed-float-body">{children}</div>
    </div>
  );
}
