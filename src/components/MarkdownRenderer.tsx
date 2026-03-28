import React from 'react';

export type RenderMarkdownOptions = {
  /**
   * 为 true 时：未闭合 ``` 按「生成中」渲染；行内 `**` 在未写出闭合 `**` 前也按加粗显示（适合流式前缀）。
   */
  streaming?: boolean;
  /** 为 true 时不追加行尾闪烁光标（由外层拼接尾段后统一加） */
  suppressInlineCaret?: boolean;
  /** 代码块复制按钮文案 */
  copyLabel?: string;
};

/** 若 ``` 出现奇数次，则最后一段为未闭合围栏，拆成已闭合部分 + 尾部 */
function splitAtUnclosedFence(text: string): { head: string; tail: string } {
  const re = /```/g;
  let m: RegExpExecArray | null;
  let lastIdx = -1;
  let count = 0;
  while ((m = re.exec(text)) !== null) {
    lastIdx = m.index;
    count += 1;
  }
  if (count % 2 === 0 || lastIdx < 0) {
    return { head: text, tail: '' };
  }
  return { head: text.slice(0, lastIdx), tail: text.slice(lastIdx) };
}

function renderStreamingTail(tail: string, keyBase: number): React.ReactNode[] {
  if (!tail) return [];
  const m = tail.match(/^```([\w-]*)\n?([\s\S]*)$/);
  if (!m) {
    return [<span key={`st-${keyBase}`} className="md-stream-raw">{tail}</span>];
  }
  const lang = m[1] || '';
  const code = m[2];
  return [
    <div key={`st-${keyBase}`} className="md-code-block md-streaming">
      <div className="md-code-header">
        <span className="md-code-lang">{lang || 'code'}</span>
        <span className="md-streaming-badge">生成中</span>
      </div>
      <pre className="md-code-body">
        <code>{code}</code>
        <span className="md-stream-caret" aria-hidden />
      </pre>
    </div>,
  ];
}

function renderMarkdownComplete(text: string, streaming: boolean | undefined, copyLabel: string): React.ReactNode[] {
  if (!text) return [];

  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  const segments: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push(...renderInlineMarkdown(text.slice(lastIdx, match.index), segments.length, streaming));
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
      </div>,
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    segments.push(...renderInlineMarkdown(text.slice(lastIdx), segments.length, streaming));
  }
  return segments;
}

/**
 * 第二参数：`string` 为代码块复制按钮文案；`RenderMarkdownOptions` 为流式等高级选项（可含 copyLabel）。
 */
export function renderMarkdown(
  text: string,
  second?: string | RenderMarkdownOptions,
): React.ReactNode[] | null {
  if (!text) return null;

  let copyLabel = '复制';
  let streaming: boolean | undefined;
  let suppressInlineCaret: boolean | undefined;

  if (typeof second === 'string') {
    copyLabel = second;
  } else if (second && typeof second === 'object') {
    copyLabel = second.copyLabel ?? '复制';
    streaming = second.streaming;
    suppressInlineCaret = second.suppressInlineCaret;
  }

  if (!streaming) {
    return renderMarkdownComplete(text, false, copyLabel);
  }

  const split = splitAtUnclosedFence(text);
  const head = split.head;
  const tail = split.tail;

  const main = renderMarkdownComplete(head, true, copyLabel);
  const extra = renderStreamingTail(tail, main.length);
  const inlineCaret =
    !tail && !suppressInlineCaret
      ? [<span key="md-inline-caret" className="md-stream-caret md-stream-caret--inline" aria-hidden />]
      : [];

  if (main.length === 0 && extra.length === 0 && inlineCaret.length === 0) return null;
  return [...main, ...extra, ...inlineCaret];
}

function renderInlineMarkdown(text: string, keyOffset: number, streaming?: boolean): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    result.push(
      <ul key={`ul-${keyOffset}-${result.length}`} className="md-list">
        {listItems.map((item, j) => <li key={j}>{renderInline(item, streaming)}</li>)}
      </ul>,
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
      result.push(<h4 key={`h-${keyOffset}-${i}`} className="md-h4">{renderInline(trimmed.slice(4), streaming)}</h4>);
      return;
    }
    if (trimmed.startsWith('## ')) {
      result.push(<h3 key={`h-${keyOffset}-${i}`} className="md-h3">{renderInline(trimmed.slice(3), streaming)}</h3>);
      return;
    }
    if (!trimmed) {
      result.push(<br key={`br-${keyOffset}-${i}`} />);
      return;
    }
    result.push(<span key={`l-${keyOffset}-${i}`}>{renderInline(trimmed, streaming)}{i < lines.length - 1 ? <br /> : null}</span>);
  });
  flushList();
  return result;
}

/** 行内：反引号链接等仍要求成对闭合；加粗在 streaming 下支持未闭合 **… */
function renderPlainTokens(s: string, keyBase: number, wrapStrong: boolean): React.ReactNode[] {
  const TOKEN_RE = /(`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = s.split(TOKEN_RE);
  const inner = parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={`pt-${keyBase}-c-${i}`} className="md-inline-code">{part.slice(1, -1)}</code>;
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch)
      return <a key={`pt-${keyBase}-a-${i}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">{linkMatch[1]}</a>;
    return <span key={`pt-${keyBase}-s-${i}`}>{part}</span>;
  });
  if (inner.length === 0) return [];
  if (wrapStrong)
    return [<strong key={`pt-${keyBase}-bold`} style={{ fontWeight: 700 }}>{inner}</strong>];
  return inner;
}

function renderInlineStreamingBold(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let openBold = false;
  let seq = 0;
  while (rest.length) {
    const hit = rest.indexOf('**');
    if (hit === -1) {
      nodes.push(...renderPlainTokens(rest, seq, openBold));
      break;
    }
    const before = rest.slice(0, hit);
    if (before)
      nodes.push(...renderPlainTokens(before, seq, openBold));
    seq += 1;
    openBold = !openBold;
    rest = rest.slice(hit + 2);
  }
  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0];
  return <>{nodes}</>;
}

function renderInline(text: string, streaming?: boolean): React.ReactNode {
  if (streaming) {
    return renderInlineStreamingBold(text);
  }
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
