import { resolveApiUrl } from '../utils/apiBase';
import { getTrainingDataOptIn } from './consent';
import { ANALYTICS_SCHEMA, type StudioAnalyticsEvent } from './types';

const STORAGE_SESSION = 'rdk:analytics-session-id';

function clientEnabled(): boolean {
  try {
    if (import.meta.env.VITE_ANALYTICS_ENABLED === '0') return false;
  } catch {
    /* ignore */
  }
  return typeof window !== 'undefined';
}

function getOrCreateSessionId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_SESSION)?.trim();
    if (existing) return existing;
    const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(STORAGE_SESSION, id);
    return id;
  } catch {
    return `anon_${Date.now()}`;
  }
}

const queue: StudioAnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 12_000;
const MAX_QUEUE = 60;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, FLUSH_MS);
}

function consentPayload() {
  return {
    trainingDataOptIn: getTrainingDataOptIn(),
    recordedAt: Date.now(),
  };
}

export async function flushNow(): Promise<void> {
  if (!clientEnabled() || queue.length === 0) return;
  const batch = queue.splice(0, MAX_QUEUE);
  const clientSessionId = getOrCreateSessionId();
  try {
    await fetch(resolveApiUrl('/api/analytics/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        schema: ANALYTICS_SCHEMA,
        clientSessionId,
        consent: consentPayload(),
        events: batch,
      }),
    });
  } catch {
    queue.unshift(...batch);
  }
}

/** 用户切换「改进」开关后立即上报 consent（无行为事件时也可单独发送） */
export async function reportConsentSnapshot(reason: string): Promise<void> {
  if (!clientEnabled()) return;
  const clientSessionId = getOrCreateSessionId();
  try {
    await fetch(resolveApiUrl('/api/analytics/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        schema: ANALYTICS_SCHEMA,
        clientSessionId,
        consent: consentPayload(),
        events: [
          {
            type: 'consent_snapshot',
            reason,
            trainingDataOptIn: getTrainingDataOptIn(),
            ts: Date.now(),
          },
        ],
      }),
    });
  } catch {
    /* ignore */
  }
}

/** 通用埋点：页面停留、设置打开等 */
export function trackEvent(ev: StudioAnalyticsEvent): void {
  if (!clientEnabled()) return;
  queue.push(ev);
  if (queue.length >= 20) {
    void flushNow();
    return;
  }
  scheduleFlush();
}

/** 便捷：命名操作 */
export function trackUiAction(name: string, detail?: Record<string, string | number | boolean | null>): void {
  trackEvent({
    type: 'ui_action',
    name,
    detail,
    ts: Date.now(),
  });
}

export function initAnalyticsFlushListeners(): void {
  if (typeof window === 'undefined' || !clientEnabled()) return;
  try {
    void reportConsentSnapshot('app_init');
  } catch {
    /* ignore */
  }
  const onHide = () => {
    void flushNow();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onHide);
}
