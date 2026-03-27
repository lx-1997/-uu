import { useEffect, useRef } from 'react';
import { resolveApiUrl } from '../utils/apiBase';

const STORAGE_ANON = 'rdk:studio-anon-id';
const STORAGE_LAST = 'rdk:studio-daily-active-utc-day';

function getOrCreateAnonymousId(): string {
  try {
    let id = localStorage.getItem(STORAGE_ANON)?.trim();
    if (id && id.length >= 16) return id;
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_ANON, id);
    return id;
  } catch {
    return `fallback-${Date.now()}`;
  }
}

function utcDayString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 每个浏览器环境每个 UTC 日最多上报一次；失败静默。
 */
export function useDailyActivePing() {
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    const today = utcDayString();
    try {
      const last = localStorage.getItem(STORAGE_LAST);
      if (last === today) return;
    } catch {
      /* ignore */
    }

    const anonymousId = getOrCreateAnonymousId();
    const appVersion = import.meta.env.VITE_APP_VERSION || '';

    void (async () => {
      try {
        const res = await fetch(resolveApiUrl('/api/analytics/daily-active'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ anonymousId, appVersion }),
        });
        if (!res.ok) return;
        let data: { persisted?: boolean } = {};
        try {
          data = (await res.json()) as { persisted?: boolean };
        } catch {
          return;
        }
        // 服务端未写入（如显式关闭日活）时不标记本日，便于配置生效后下次启动再试
        if (data.persisted === false) return;
        try {
          localStorage.setItem(STORAGE_LAST, today);
        } catch {
          /* ignore */
        }
      } catch {
        /* offline / blocked */
      }
    })();
  }, []);
}
