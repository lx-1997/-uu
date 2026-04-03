import { useEffect, useRef, useState } from 'react';
import { apiPathForFetch, fetchApi } from '../utils/apiBase';

/** 经 fetchApi 拉取本地可承受上限；再大则退回直接 URL（依赖 Range/整文件） */
const MAX_LOCAL_FILES_MEDIA_BLOB_BYTES = 50 * 1024 * 1024;

/**
 * `<video>` / `<audio>` 用 src 请求无法带 X-RDK-Sso-Session；开发态 Vite 代理对 Range 也可能异常。
 * 对 `/api/local-files/` 优先 fetch（带镜像头与 Cookie）为 Blob 再播放，失败或过大时回退为原始 URL。
 */
export function useLocalFilesBlobPlayUrl(resolvedSrc: string): { playUrl: string; loading: boolean } {
  const blobRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<'loading' | 'ready'>(() => {
    if (!resolvedSrc) return 'ready';
    return resolvedSrc.includes('/api/local-files/') ? 'loading' : 'ready';
  });
  const [playUrl, setPlayUrl] = useState<string>(() => {
    if (!resolvedSrc || resolvedSrc.includes('/api/local-files/')) return '';
    return resolvedSrc;
  });

  useEffect(() => {
    if (!resolvedSrc) {
      setPlayUrl('');
      setPhase('ready');
      return;
    }
    if (!resolvedSrc.includes('/api/local-files/')) {
      setPlayUrl(resolvedSrc);
      setPhase('ready');
      return;
    }

    let cancelled = false;

    const revokePending = () => {
      if (blobRef.current) {
        try {
          URL.revokeObjectURL(blobRef.current);
        } catch {
          /* noop */
        }
        blobRef.current = null;
      }
    };

    const run = async () => {
      revokePending();
      setPhase('loading');
      setPlayUrl('');
      try {
        const path = apiPathForFetch(resolvedSrc);
        const res = await fetchApi(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const cl = res.headers.get('content-length');
        if (cl && Number(cl) > MAX_LOCAL_FILES_MEDIA_BLOB_BYTES) {
          if (!cancelled) {
            setPlayUrl(resolvedSrc);
            setPhase('ready');
          }
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobRef.current = objectUrl;
        setPlayUrl(objectUrl);
        setPhase('ready');
      } catch {
        if (!cancelled) {
          setPlayUrl(resolvedSrc);
          setPhase('ready');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      revokePending();
    };
  }, [resolvedSrc]);

  const loading = phase === 'loading';
  const urlOut = playUrl || (loading ? '' : resolvedSrc);

  return { playUrl: urlOut, loading };
}
