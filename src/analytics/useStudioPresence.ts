import { useEffect, useRef } from 'react';
import type { Tab } from '../app-types';
import { trackEvent } from './client';

/**
 * 记录主内容区 Tab 切换与停留时长（用于「哪个页面停留最久」类分析）。
 */
export function useStudioPresence(activeTab: Tab): void {
  const prevTab = useRef<Tab | null>(null);
  const enteredAt = useRef<number>(Date.now());

  useEffect(() => {
    const now = Date.now();
    if (prevTab.current !== null && prevTab.current !== activeTab) {
      trackEvent({
        type: 'page_leave',
        tab: prevTab.current,
        durationMs: Math.max(0, now - enteredAt.current),
        ts: now,
      });
    }
    prevTab.current = activeTab;
    enteredAt.current = now;
    trackEvent({ type: 'page_enter', tab: activeTab, ts: now });
  }, [activeTab]);

  useEffect(() => {
    const onPageHide = () => {
      if (prevTab.current === null) return;
      trackEvent({
        type: 'page_leave',
        tab: prevTab.current,
        durationMs: Math.max(0, Date.now() - enteredAt.current),
        ts: Date.now(),
      });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);
}
