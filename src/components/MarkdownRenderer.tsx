import React from 'react';

export function renderMarkdown(text: string, copyLabel = '复制'): React.ReactNode[] | null {
  if (!text) return null;

  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  const segments: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push(...renderInlineMarkdown(text.slice(lastIdx, match.index), segments.length));
    }
    const lang = match[1] || '';
    const code = match[2].trim();
    segments.push(
      <div key={`cb-${segments.length}`} className="md-code-block">
        <div className="md-code-header">
          <span className="md-code-lang">{lang || 'code'}</span>
          <button type="button" className="md-code-copy" onClick={() => { navigator.clipboard.writeText(code); }}>{copyLabel}</button>
        </div>
        <pre className="md-code-body"><code>{code}</code></pre>
      </div>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    segments.push(...renderInlineMarkdown(text.slice(lastIdx), segments.length));
  }
  return segments;
}

function renderInlineMarkdown(text: string, keyOffset: number): React.ReactNode[] {
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
  const TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(TOKEN_RE);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="md-inline-code">{part.slice(1, -1)}</code>;
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch)
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">{linkMatch[1]}</a>;
    return <span key={i}>{part}</span>;
  });
}
