import React, { useState, useCallback } from 'react';
import { ImageOff } from 'lucide-react';

export type ChatImageWithFallbackProps = {
  src: string;
  alt?: string;
  className?: string;
  /** 包裹裂图提示的容器 class（如 md-inline-img-wrap） */
  wrapClassName?: string;
  /** 裂图说明 */
  failedHint?: string;
  /** 外链按钮文案 */
  openLinkLabel?: string;
};

/**
 * 对话内嵌图片：加载失败时展示说明 + 打开链接，避免仅裂图无提示。
 * 对外链使用 no-referrer，部分 CDN 防盗链在去掉 Referer 后可加载。
 */
export function ChatImageWithFallback({
  src,
  alt = '',
  className = '',
  wrapClassName = '',
  failedHint = '无法加载图片（可能不是图片直链或站点禁止嵌入）',
  openLinkLabel = '在新标签打开链接',
}: ChatImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => {
    setFailed(true);
  }, []);

  const external = /^https?:\/\//i.test(src);

  if (failed) {
    return (
      <div className={`chat-img-fallback ${wrapClassName}`.trim()} role="figure" aria-label={alt || failedHint}>
        <div className="chat-img-fallback-inner">
          <span className="chat-img-fallback-icon" aria-hidden>
            <ImageOff size={22} strokeWidth={1.75} />
          </span>
          <p className="chat-img-fallback-hint">{failedHint}</p>
          {alt ? <p className="chat-img-fallback-alt">{alt}</p> : null}
          <a href={src} target="_blank" rel="noopener noreferrer" className="chat-img-fallback-link">
            {openLinkLabel}
          </a>
        </div>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy={external ? 'no-referrer' : undefined}
      onError={onError}
      onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
    />
  );
}
