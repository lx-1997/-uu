import React from 'react';

const VIDEO_EXTS = /\.(mp4|webm|mov|avi|mkv)$/i;
const VIDEO_MIME: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska' };

function resolveVideoMime(url: string) {
  const ext = url.split('.').pop()?.toLowerCase() || 'mp4';
  return VIDEO_MIME[ext] || 'video/mp4';
}

function VideoPlayer({ src, keyId }: { src: string; keyId: string }) {
  return (
    <div key={keyId} className="msg-block video-block" style={{ margin: '8px 0' }}>
      <video className="video-block-player" controls playsInline preload="auto" style={{ maxWidth: '100%', borderRadius: 8 }}>
        <source src={src} type={resolveVideoMime(src)} />
      </video>
    </div>
  );
}

export function renderMarkdown(text: string): React.ReactNode[] | null {
  if (!text) return null;

  const htmlVideoRegex = /<video[^>]*src=["']([^"']+)["'][^>]*>[\s\S]*?<\/video>/gi;
  let processed = text;
  const videoPlaceholders: { placeholder: string; src: string }[] = [];
  processed = processed.replace(htmlVideoRegex, (_, src) => {
    const ph = `__VIDEO_PH_${videoPlaceholders.length}__`;
    videoPlaceholders.push({ placeholder: ph, src });
    return ph;
  });

  const sourceVideoRegex = /<video[^>]*>[\s\S]*?<source[^>]*src=["']([^"']+)["'][^>]*\/>[\s\S]*?<\/video>/gi;
  processed = processed.replace(sourceVideoRegex, (_, src) => {
    const ph = `__VIDEO_PH_${videoPlaceholders.length}__`;
    videoPlaceholders.push({ placeholder: ph, src });
    return ph;
  });

  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  const segments: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(processed)) !== null) {
    if (match.index > lastIdx) {
      segments.push(...renderInlineMarkdown(processed.slice(lastIdx, match.index), segments.length, videoPlaceholders));
    }
    const lang = match[1] || '';
    const code = match[2].trim();
    segments.push(
      <div key={`cb-${segments.length}`} className="md-code-block">
        <div className="md-code-header">
          <span className="md-code-lang">{lang || 'code'}</span>
          <button className="md-code-copy" onClick={() => { navigator.clipboard.writeText(code); }}>复制</button>
        </div>
        <pre className="md-code-body"><code>{code}</code></pre>
      </div>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < processed.length) {
    segments.push(...renderInlineMarkdown(processed.slice(lastIdx), segments.length, videoPlaceholders));
  }
  return segments;
}

function renderInlineMarkdown(text: string, keyOffset: number, videoPlaceholders: { placeholder: string; src: string }[] = []): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    result.push(
      <ul key={`ul-${keyOffset}-${result.length}`} className="md-list">
        {listItems.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    const vph = videoPlaceholders.find((v) => trimmed.includes(v.placeholder));
    if (vph) {
      flushList();
      result.push(<VideoPlayer key={`vid-${keyOffset}-${i}`} src={vph.src} keyId={`vid-${keyOffset}-${i}`} />);
      return;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*•]\s+/, ''));
      return;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^\d+\.\s+/, ''));
      return;
    }
    flushList();
    if (trimmed.startsWith('### ')) {
      result.push(<h4 key={`h-${keyOffset}-${i}`} className="md-h4">{renderInline(trimmed.slice(4))}</h4>);
      return;
    }
    if (trimmed.startsWith('## ')) {
      result.push(<h3 key={`h-${keyOffset}-${i}`} className="md-h3">{renderInline(trimmed.slice(3))}</h3>);
      return;
    }
    if (!trimmed) {
      result.push(<br key={`br-${keyOffset}-${i}`} />);
      return;
    }
    result.push(<span key={`l-${keyOffset}-${i}`}>{renderInline(trimmed)}{i < lines.length - 1 ? <br /> : null}</span>);
  });
  flushList();
  return result;
}

function renderInline(text: string): React.ReactNode {
  const TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(TOKEN_RE);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="md-inline-code">{part.slice(1, -1)}</code>;
    const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch)
      return <img key={i} src={imgMatch[2]} alt={imgMatch[1]} className="md-inline-img" loading="lazy" />;
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      if (VIDEO_EXTS.test(linkMatch[2])) {
        return <VideoPlayer key={`vl-${i}`} src={linkMatch[2]} keyId={`vl-${i}`} />;
      }
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">{linkMatch[1]}</a>;
    }
    return <span key={i}>{part}</span>;
  });
}
