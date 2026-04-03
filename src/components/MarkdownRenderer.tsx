import React from 'react';
import { Copy } from 'lucide-react';
import { resolveMediaUrl } from '../utils/apiBase';

/** 行内链接：图片扩展名则渲染为 <img>（含 /api/local-files/xxx.jpg） */
function isMarkdownImageHref(href: string): boolean {
  const base = (href.trim().split(/[?#]/)[0] || '').trim();
  return /\.(jpe?g|png|gif|webp|bmp|svg|ico|tiff?)$/i.test(base);
}

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
          <button
            type="button"
            className="md-code-copy"
            aria-label={copyLabel}
            title={copyLabel}
            onClick={() => { void navigator.clipboard.writeText(code); }}
          >
            <Copy size={15} strokeWidth={2} aria-hidden />
          </button>
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

function isTableSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|')) return false;
  if (!/-{3,}/.test(t.replace(/\|/g, ''))) return false;
  return /^[\s|:-]+$/.test(t);
}

function looksLikeTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|')) return false;
  if (isTableSeparatorLine(t)) return false;
  return true;
}

function parseTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** GFM 风格：表头 + 分隔行 + 数据行；空行或非表格行结束 */
function tryParseTable(lines: string[], start: number): { rows: string[][]; end: number } | null {
  if (start + 1 >= lines.length) return null;
  const headerLine = lines[start].trim();
  const sepLine = lines[start + 1].trim();
  if (!looksLikeTableRow(headerLine) || !isTableSeparatorLine(sepLine)) return null;
  const rows: string[][] = [parseTableRow(headerLine)];
  let i = start + 2;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) break;
    if (!looksLikeTableRow(t)) break;
    if (isTableSeparatorLine(t)) {
      i += 1;
      continue;
    }
    rows.push(parseTableRow(t));
    i += 1;
  }
  return { rows, end: i };
}

function isHorizontalRuleLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return false;
  if (/^[-*_]{3,}$/.test(t)) return true;
  if (/^(?:-\s*){3,}$/.test(t)) return true;
  return false;
}

function renderTable(rows: string[][], keyOffset: number, keySuffix: number, streaming?: boolean): React.ReactNode {
  if (rows.length === 0) return null;
  const header = rows[0];
  const colCount = Math.max(...rows.map((r) => r.length), header.length);
  const norm = (r: string[]) => {
    const x = [...r];
    while (x.length < colCount) x.push('');
    return x.slice(0, colCount);
  };
  return (
    <div key={`tbl-${keyOffset}-${keySuffix}`} className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {norm(header).map((cell, j) => (
              <th key={j}>{renderInlineWithBr(cell, streaming)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((row, ri) => (
            <tr key={ri}>
              {norm(row).map((cell, ci) => (
                <td key={ci}>{renderInlineWithBr(cell, streaming)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 将 &lt;br&gt; 解析为真实换行，再交给行内 Markdown */
function renderInlineWithBr(text: string, streaming?: boolean): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/<br\s*\/?>/gi);
  if (parts.length === 1) return renderInline(text, streaming);
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <br /> : null}
          {renderInline(part, streaming)}
        </React.Fragment>
      ))}
    </>
  );
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
        {listItems.map((item, j) => (
          <li key={j}>{renderInlineWithBr(item, streaming)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    const tableParsed = tryParseTable(lines, i);
    if (tableParsed) {
      flushList();
      result.push(renderTable(tableParsed.rows, keyOffset, result.length, streaming));
      i = tableParsed.end;
      continue;
    }

    if (isHorizontalRuleLine(trimmed)) {
      flushList();
      result.push(<hr key={`hr-${keyOffset}-${i}`} className="md-hr" />);
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushList();
      const qStart = i;
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      result.push(
        <blockquote key={`bq-${keyOffset}-${qStart}`} className="md-bq">
          {quoteLines.map((ql, qi) => (
            <span key={qi}>
              {qi > 0 ? <br /> : null}
              {renderInlineWithBr(ql, streaming)}
            </span>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*•]\s+/, ''));
      i += 1;
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^\d+\.\s+/, ''));
      i += 1;
      continue;
    }
    flushList();

    if (trimmed.startsWith('### ')) {
      result.push(<h4 key={`h-${keyOffset}-${i}`} className="md-h4">{renderInlineWithBr(trimmed.slice(4), streaming)}</h4>);
      i += 1;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      result.push(<h3 key={`h-${keyOffset}-${i}`} className="md-h3">{renderInlineWithBr(trimmed.slice(3), streaming)}</h3>);
      i += 1;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      result.push(<h2 key={`h-${keyOffset}-${i}`} className="md-h2">{renderInlineWithBr(trimmed.slice(2), streaming)}</h2>);
      i += 1;
      continue;
    }
    if (!trimmed) {
      result.push(<br key={`br-${keyOffset}-${i}`} />);
      i += 1;
      continue;
    }
    result.push(
      <span key={`l-${keyOffset}-${i}`}>
        {renderInlineWithBr(trimmed, streaming)}
        {i < lines.length - 1 ? <br /> : null}
      </span>,
    );
    i += 1;
  }
  flushList();
  return result;
}

/** 行内：反引号链接等仍要求成对闭合；加粗在 streaming 下支持未闭合 **… */
function renderPlainTokens(s: string, keyBase: number, wrapStrong: boolean): React.ReactNode[] {
  const TOKEN_RE = /(`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
  const parts = s.split(TOKEN_RE);
  const inner = parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={`pt-${keyBase}-c-${i}`} className="md-inline-code">{part.slice(1, -1)}</code>;
    const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const url = resolveMediaUrl(imgMatch[2]);
      const alt = imgMatch[1] || '';
      return (
        <img
          key={`pt-${keyBase}-img-${i}`}
          className="md-inline-img"
          src={url}
          alt={alt}
          loading="lazy"
          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
        />
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const hrefRaw = linkMatch[2];
      if (isMarkdownImageHref(hrefRaw)) {
        const url = resolveMediaUrl(hrefRaw);
        const label = linkMatch[1] || '';
        return (
          <img
            key={`pt-${keyBase}-imglnk-${i}`}
            className="md-inline-img"
            src={url}
            alt={label}
            loading="lazy"
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
          />
        );
      }
      return (
        <a key={`pt-${keyBase}-a-${i}`} href={hrefRaw} target="_blank" rel="noopener noreferrer">
          {linkMatch[1]}
        </a>
      );
    }
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
  const TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(TOKEN_RE);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="md-inline-code">{part.slice(1, -1)}</code>;
    const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const url = resolveMediaUrl(imgMatch[2]);
      const alt = imgMatch[1] || '';
      return (
        <img
          key={i}
          className="md-inline-img"
          src={url}
          alt={alt}
          loading="lazy"
          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
        />
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const hrefRaw = linkMatch[2];
      if (isMarkdownImageHref(hrefRaw)) {
        const url = resolveMediaUrl(hrefRaw);
        const label = linkMatch[1] || '';
        return (
          <img
            key={i}
            className="md-inline-img"
            src={url}
            alt={label}
            loading="lazy"
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
          />
        );
      }
      return (
        <a key={i} href={hrefRaw} target="_blank" rel="noopener noreferrer">
          {linkMatch[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
