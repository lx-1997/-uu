import { Fragment, useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '../hooks/useAppState';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import { parseUiLanguageCommand } from '../i18n/language-command';
import { useStreamRevealSegments } from '../hooks/useStreamReveal';
import type { AiDockContentSlot, ChatBlock, ChatAttachment, ChatMessage, Tab } from '../app-types';
import type { AgentAttachmentPayload, StudioResponseMode } from '../api';
import { getCapabilityDisplayLabel } from '../ai';
import { resolveSocketUrl, socketIoClientOptions } from '../utils/socket';
import { resolveApiUrl, resolveMediaUrl, fetchApi } from '../utils/apiBase';
import { useLocalFilesBlobPlayUrl } from '../hooks/useLocalFilesBlobPlayUrl';
import { getRdkEmbedPanel, getRdkEmbedDockCtx, openOpenClawPopout } from '../utils/embed-mode';
import { useHubDockAnchor } from '../contexts/HubDockAnchorContext';
import { isDeviceShownOnline } from '../utils/device-connection';
import { DASHBOARD_CHAT_INTRO_PROMPT_EN, DASHBOARD_CHAT_INTRO_PROMPT_ZH } from '../i18n/prompts';
import { findAdjustedStreamingFadeSplitIndex } from '../utils/streaming-markdown-split';
import { renderMarkdown } from './MarkdownRenderer';
import { chatMessageToPlainText, chatMessageRetryExcerpt } from '../utils/chat-message-plain';
import { buildThreadSummaryLine } from '../utils/chat-history-thread-label';
import { confirmAndBeginNewChat } from '../utils/studio-new-chat';
import { DockFlashMentionWizard } from './DockFlashMentionWizard';
import {
  DOCK_MENTION_CAPABILITIES,
  filterMentionCapabilities,
  parseTrailingAtMention,
  type DockMentionCapabilityId,
} from '../constants/dock-mention-capabilities';
import io from 'socket.io-client';
import { Copy } from 'lucide-react';
import { sanitizeTerminalLineForDisplay } from '../utils/strip-ansi';
import { STUDIO_ENABLE_VOICE_TO_TEXT } from '../constants/studio-features';

import rdkclawAvatarUrl from '../assets/chat/rdkclaw-avatar.png';
import userAvatarUrl from '../assets/chat/user-avatar.png';

/* ─── Inline SVG icons (avoid emoji, keep crisp) ─── */
const Icon = {
  spark: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v1m0 16v1m-7.07-2.93l.71-.71M4.22 4.22l.71.71M3 12h1m16 0h1m-2.93 7.07l-.71-.71M19.78 4.22l-.71.71"/>
      <circle cx="12" cy="12" r="4"/>
    </svg>
  ),
  send: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
    </svg>
  ),
  expand: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
      <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  ),
  collapse: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
      <line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  ),
  close: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  /** 与「清空输入」并列：停止全部 RDKClaw 运行 */
  stopAll: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  ),
  flash: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h8l4 4v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z"/>
      <path d="M10 10h4M10 14h4"/>
    </svg>
  ),
};

type PendingAttachment = ChatAttachment & {
  file: File;
  /** 语音：本机/服务端转写进行中 */
  sttPending?: boolean;
  /** 语音：转写失败简要原因（展示在附件旁） */
  sttError?: string;
};

/** 设为 true 时不使用浏览器 Web Speech API（Chrome 等会连 Google）；仅录音 + 本机后端转写，需配置 whisper.cpp 或云端 Provider */
const RDK_DISABLE_BROWSER_SPEECH =
  import.meta.env.VITE_DISABLE_BROWSER_SPEECH === '1'
  || import.meta.env.VITE_DISABLE_BROWSER_SPEECH === 'true';

type SpeechRecognitionResultLike = ArrayLike<{ transcript?: string }> & { isFinal?: boolean };

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: {
    results: ArrayLike<SpeechRecognitionResultLike>;
    resultIndex?: number;
  }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

const MAX_PENDING_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_PENDING_VIDEO_BYTES = 50 * 1024 * 1024;

const RESPONSE_MODE_ORDER: StudioResponseMode[] = ['quick', 'thinking'];

/** Agent 单列顺行：user + ai 成对，用于「问题吸顶 + 下方全宽回答」 */
type DockTurnEntry =
  | { kind: 'pair'; user: ChatMessage; ai: ChatMessage }
  | { kind: 'user-only'; user: ChatMessage }
  | { kind: 'orphan-ai'; ai: ChatMessage };

function buildDockTurns(msgs: ChatMessage[]): DockTurnEntry[] {
  const out: DockTurnEntry[] = [];
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (m.role === 'user') {
      const next = msgs[i + 1];
      if (next?.role === 'ai') {
        out.push({ kind: 'pair', user: m, ai: next });
        i += 2;
      } else {
        out.push({ kind: 'user-only', user: m });
        i += 1;
      }
    } else {
      out.push({ kind: 'orphan-ai', ai: m });
      i += 1;
    }
  }
  return out;
}

const OFFICE_DOC_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-excel',
]);

function isTextLikeFile(file: File) {
  return file.type.startsWith('text/')
    || [
      'application/json',
      'application/xml',
      'application/javascript',
    ].includes(file.type)
    || /\.(txt|md|json|ya?ml|toml|ini|csv|ts|tsx|js|jsx|py|sh|log|xml|html|css|rst|tex|rtf|c|cpp|h|hpp|java|go|rs|rb|php|sql|r|lua|swift|kt|scala|dart)$/i.test(file.name);
}

function isDocumentFile(file: File) {
  if (OFFICE_DOC_MIMES.has(file.type)) return true;
  if (file.type === 'application/pdf') return true;
  return /\.(docx?|pptx?|xlsx?|pdf)$/i.test(file.name);
}

function getAttachmentIcon(name: string, mimeType?: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (/^(mp4|webm|avi|mov|mkv|flv|wmv|m4v)$/.test(ext) || mimeType?.startsWith('video/')) return '🎬';
  if (/^(mp3|wav|ogg|flac|aac|wma|m4a|webm)$/.test(ext) || mimeType?.startsWith('audio/')) return '🎵';
  if (/^(jpe?g|png|gif|bmp|webp|svg|ico|tiff?)$/.test(ext) || mimeType?.startsWith('image/')) return '🖼️';
  if (/^docx?$/.test(ext) || mimeType?.includes('word')) return '📄';
  if (/^pptx?$/.test(ext) || mimeType?.includes('presentation') || mimeType?.includes('powerpoint')) return '📊';
  if (/^xlsx?$/.test(ext) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return '📋';
  if (ext === 'pdf' || mimeType === 'application/pdf') return '📕';
  if (ext === 'md') return '📝';
  if (/^(zip|tar|gz|rar|7z|bz2|xz|zst)$/.test(ext)) return '📦';
  if (/^(exe|msi|deb|rpm|dmg|appimage|bin)$/.test(ext)) return '⚙️';
  if (/^(py|js|ts|jsx|tsx|c|cpp|h|java|go|rs|rb|php|sh|lua|swift|kt|scala|dart|sql|r)$/.test(ext)) return '💻';
  return '📎';
}

const MEDIA_VIDEO_RE = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp)$/i;
const MEDIA_IMAGE_RE = /\.(jpe?g|png|gif|bmp|webp|svg|ico|tiff?)$/i;

function extractMediaFromText(text: string): { cleanText: string; mediaBlocks: ChatBlock[] } {
  const mediaBlocks: ChatBlock[] = [];
  let t = text;

  t = t.replace(/<video[^>]*>[\s\S]*?<\/video>/gi, (match) => {
    const srcMatch = match.match(/src=["']([^"']+)["']/);
    if (srcMatch) {
      const src = srcMatch[1];
      const fileName = decodeURIComponent(src.split('/').pop() || 'video');
      mediaBlocks.push({ type: 'video', src, caption: fileName });
    }
    return '';
  });

  t = t.replace(/<img[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, (match, src) => {
    const alt = match.match(/alt=["']([^"']*)["']/)?.[1] || '';
    mediaBlocks.push({ type: 'image', src, caption: alt });
    return '';
  });

  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, url: string) => {
    if (MEDIA_VIDEO_RE.test(url)) {
      mediaBlocks.push({ type: 'video', src: url, caption: alt || '' });
      return '';
    }
    mediaBlocks.push({ type: 'image', src: url, caption: alt || '' });
    return '';
  });

  t = t.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (match, label: string, url: string) => {
    if (MEDIA_VIDEO_RE.test(url)) {
      mediaBlocks.push({ type: 'video', src: url, caption: label || '' });
      return '';
    }
    if (MEDIA_IMAGE_RE.test(url)) {
      mediaBlocks.push({ type: 'image', src: url, caption: label || '' });
      return '';
    }
    return match;
  });

  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return { cleanText: t, mediaBlocks };
}

/** 极简模式保留：正文 + 媒体/代码/审批等「结果」，隐藏工具/状态/推理/终端等过程块 */
function isResultLikeDockBlock(block: ChatBlock): boolean {
  switch (block.type) {
    case 'image':
    case 'video':
    case 'file':
    case 'code':
    case 'task-result':
    case 'continue-run':
    case 'approval':
    case 'confirm':
    case 'recommendation':
    case 'soul-update':
      return true;
    default:
      return false;
  }
}

function filterContentSlotsMinimal(slots: AiDockContentSlot[], blocks: ChatBlock[]): AiDockContentSlot[] {
  return slots.filter((slot) => {
    if (slot.kind === 'markdown') return true;
    const b = blocks[slot.index];
    return b ? isResultLikeDockBlock(b) : false;
  });
}

/** 从粘贴事件中收集文件。同一份内容常在 items.getAsFile() 与 files[] 各出现一次，且 lastModified 可能不一致，故不能合并两轮扫描。 */
function collectClipboardFiles(evt: ClipboardEvent): File[] {
  const cd = evt.clipboardData;
  if (!cd) return [];
  const seen = new Set<string>();
  const out: File[] = [];
  const push = (f: File) => {
    if (f.size === 0) return;
    const nameKey = (f.name || '').trim().toLowerCase() || '_';
    const key = `${nameKey}|${f.size}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };

  let fromItems = 0;
  for (const item of Array.from(cd.items)) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) {
        push(f);
        fromItems += 1;
      }
    }
  }
  // items 与 files 在多数浏览器里指向同一批文件；只扫 items 即可避免「粘一次出现两份」
  if (fromItems > 0) return out;

  for (let i = 0; i < cd.files.length; i += 1) {
    push(cd.files[i]);
  }
  return out;
}

/** 气泡内持久预览：小于此大小的图片转为 data URL，避免发送后立即 revokeObjectURL 导致消息里「裂图」 */
const DISPLAY_IMAGE_DATA_URL_MAX_BYTES = 8 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('FileReader'));
    r.readAsDataURL(file);
  });
}

/** 与 PendingAttachment 对应，生成写入 chatMessages 的附件（释放 pending 的 blob，换 data URL 或新 blob） */
async function buildDisplayAttachmentsFromPending(
  pending: PendingAttachment[],
): Promise<ChatAttachment[]> {
  return Promise.all(
    pending.map(async (a) => {
      const { file, ...rest } = a;
      if (rest.type === 'image' && file.size > 0 && file.size <= DISPLAY_IMAGE_DATA_URL_MAX_BYTES) {
        try {
          const dataUrl = await fileToDataUrl(file);
          if (dataUrl.startsWith('data:')) {
            URL.revokeObjectURL(a.url);
            return { ...rest, url: dataUrl };
          }
        } catch {
          /* 走下方新 blob */
        }
      }
      if (rest.type === 'image' || rest.type === 'video' || rest.type === 'audio') {
        const nu = URL.createObjectURL(file);
        URL.revokeObjectURL(a.url);
        return { ...rest, url: nu };
      }
      URL.revokeObjectURL(a.url);
      return { ...rest };
    }),
  );
}

function findPreviousStudioUserMessage(messages: ChatMessage[], aiMessageId: number): ChatMessage | null {
  const idx = messages.findIndex((m) => m.id === aiMessageId);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && !m.channelMeta && (m.source === 'studio' || !m.source)) return m;
  }
  return null;
}

/** 将历史气泡中的附件再编码为 Agent 请求体（重试时用） */
async function chatAttachmentsToAgentPayloadForRetry(
  attachments: ChatAttachment[],
): Promise<{ payloads: AgentAttachmentPayload[]; dropped: boolean }> {
  const payloads: AgentAttachmentPayload[] = [];
  let dropped = false;
  for (const a of attachments) {
    try {
      const payload: AgentAttachmentPayload = {
        id: a.id,
        type: a.type,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
        transcript: a.transcript,
        textContent: a.textContent,
        source: 'studio',
      };
      const url = (a.url || '').trim();
      if (url.startsWith('data:')) {
        const comma = url.indexOf(',');
        if (comma >= 0) {
          const header = url.slice(5, comma);
          const raw = url.slice(comma + 1);
          if (header.includes('base64')) payload.contentBase64 = raw;
        }
        payloads.push(payload);
        continue;
      }
      if (url) {
        const fetchUrl = /^https?:\/\//i.test(url) ? url : resolveMediaUrl(url);
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error('fetch');
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 0x8000;
        for (let j = 0; j < bytes.length; j += chunk) {
          binary += String.fromCharCode(...bytes.subarray(j, j + chunk));
        }
        payload.contentBase64 = btoa(binary);
        if (!payload.mimeType) payload.mimeType = res.headers.get('content-type') || undefined;
      }
      payloads.push(payload);
    } catch {
      dropped = true;
    }
  }
  return { payloads, dropped };
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function renderSummaryWithEmphasis(text: string): React.ReactNode {
  const trimmed = (text || '').trim();
  if (!trimmed) return text;
  const chunks = trimmed.split(/(\s*[·|]\s*)/);
  const keyTokenRe = /(运行中|处理中|已完成|完成|失败|成功|warning|error|done|running|\b\d+\/\d+\b|\b\d+(?:\.\d+)?(?:ms|s|m)\b)/i;
  return chunks.map((chunk, idx) => {
    if (/^(\s*[·|]\s*)$/.test(chunk)) {
      return <span key={`sep-${idx}`} className="dock-summary-sep">{chunk}</span>;
    }
    const c = chunk.trim();
    if (!c) return <span key={`plain-${idx}`}>{chunk}</span>;
    const prefix = c.split(':')[0];
    const shouldStrongPrefix = c.includes(':') && prefix.length > 0 && prefix.length <= 18;
    if (shouldStrongPrefix) {
      return (
        <span key={`strong-prefix-${idx}`}>
          <strong className="dock-summary-strong">{prefix}</strong>
          {c.slice(prefix.length)}
        </span>
      );
    }
    if (keyTokenRe.test(c)) {
      return <strong key={`strong-${idx}`} className="dock-summary-strong">{chunk}</strong>;
    }
    return <span key={`text-${idx}`}>{chunk}</span>;
  });
}

function summarizeInline(text: string, maxChars = 52): string {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length > maxChars ? `${oneLine.slice(0, Math.max(0, maxChars - 1))}…` : oneLine;
}

function summarizeLines(lines: string[], maxChars = 52): string {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const s = summarizeInline(sanitizeTerminalLineForDisplay(lines[i] || ""), maxChars);
    if (s) return s;
  }
  return "";
}

function composeCollapsedSummary(base: string, preview: string, open: boolean): string {
  const b = summarizeInline(base, 40) || base;
  if (open || !preview) return b;
  return `${b} | ${preview}`;
}

function ReasoningCollapsible({
  block,
  presentation = 'default',
}: {
  block: Extract<ChatBlock, { type: 'reasoning' }>;
  presentation?: 'default' | 'agent-footprint';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const preview = summarizeInline(block.text, 56);
  const summary =
    block.summary
    || (block.text.trim().length > 0
      ? t('dock.reasoning.summaryHasContent', '思考过程')
      : t('dock.reasoning.summaryEmpty', '思考过程'));
  const collapsedSummary = composeCollapsedSummary(summary, preview, open);
  return (
    <div
      className={`msg-block reasoning-collapsible dock-agent-card dock-agent-card--thinking ${open ? 'open' : ''}${
        presentation === 'agent-footprint' ? ' dock-agent-footprint' : ''
      }`}
    >
      <div className="reasoning-collapsible-toolbar">
        <button
          type="button"
          className="reasoning-collapsible-trigger"
          aria-expanded={open}
          onClick={() => setOpen((p) => !p)}
        >
          <span className="reasoning-collapsible-summary">{renderSummaryWithEmphasis(collapsedSummary)}</span>
          <span className="reasoning-collapsible-toggle">{open ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}</span>
        </button>
        {block.text.trim().length > 0 ? (
          <div className="reasoning-collapsible-actions">
            <DockCopyIconButton
              label={t('dock.reasoning.copy', '复制思考过程')}
              onCopy={() => { void copyDockPlainText(block.text); }}
            />
          </div>
        ) : null}
      </div>
      {open && (
        <pre className="reasoning-collapsible-body">{block.text}</pre>
      )}
    </div>
  );
}

function StatusCollapsible({
  block,
  presentation = 'default',
}: {
  block: Extract<ChatBlock, { type: 'status' }>;
  presentation?: 'default' | 'agent-footprint';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const summaryText = block.summary || block.title || block.items[0]?.label || t('dock.status.fallback', '详情');
  const preview = summarizeInline(block.items.map((item) => `${item.label}: ${item.value}`).join(' | '), 64);
  const collapsedSummary = composeCollapsedSummary(summaryText, preview, open);
  return (
    <div
      className={`msg-block status-collapsible dock-agent-card dock-agent-card--meta ${open ? 'open' : ''}${
        presentation === 'agent-footprint' ? ' dock-agent-footprint' : ''
      }`}
    >
      <button
        type="button"
        className="status-collapsible-trigger"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
      >
        <span className="status-collapsible-summary">
          {renderSummaryWithEmphasis(collapsedSummary)}
        </span>
        <span className="status-collapsible-toggle">{open ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}</span>
      </button>
      {open && (
        <div className="status-collapsible-body">
          {block.items.map((item) => (
            <div key={item.label} className="status-block-item">
              <span className={`status-block-dot ${item.ok ? 'ok' : 'warn'}`} />
              <span className="status-block-label">{item.label}</span>
              <span className="status-block-value">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 流式阶段：稳定前缀 Markdown + 本步新字 plain 段 dock-stream-seg 渐入（安全切分避免截断 ** / `） */
function DockStreamingPlainBody({ text }: { text: string }) {
  const { t } = useI18n();
  const copyLabel = t('markdown.copy', '复制');
  /* natural：标点/空格变速 + 积压略加速，与对外「动态步频」表述一致；勿改 uniform 除非刻意做匀速演示 */
  const { visible, tailKey, lastStepLen, singleInstant } = useStreamRevealSegments(text, true, 'natural');
  const showWarmup = !text.trim();
  const minTail = !singleInstant && lastStepLen > 0 ? lastStepLen : 0;
  const instantCatchup = singleInstant && visible.length > 0 && visible.length === text.length;

  let split =
    visible.length === 0 || instantCatchup || minTail <= 0
      ? visible.length
      : findAdjustedStreamingFadeSplitIndex(visible, minTail);
  /*
   * tail 若以 \\n 开头：在默认 white-space 下换行会塌成空格，进 Markdown 后变成 <br>，下一行首字会「跳」。
   * 把前导换行并进 head，让断行始终由 Markdown 的 <br> 负责。
   */
  if (visible.length > 0 && !instantCatchup && minTail > 0 && split < visible.length) {
    while (split < visible.length && visible[split] === '\n') {
      split += 1;
    }
  }
  const useTailFade =
    visible.length > 0 && !instantCatchup && minTail > 0 && split < visible.length;
  const head = useTailFade ? visible.slice(0, split) : visible;
  const tail = useTailFade ? visible.slice(split) : '';

  const headMd = useMemo(
    () =>
      head
        ? renderMarkdown(head, { streaming: true, suppressInlineCaret: useTailFade, copyLabel })
        : null,
    [head, useTailFade, copyLabel],
  );
  const fullMd = useMemo(
    () =>
      visible.length > 0 && !useTailFade
        ? renderMarkdown(visible, { streaming: !instantCatchup, copyLabel })
        : null,
    [visible, useTailFade, instantCatchup, copyLabel],
  );

  return (
    <>
      {showWarmup && (
        <span className="dock-stream-warmup" aria-live="polite">
          {t('dock.stream.organizing', '正在组织回答')}
          <span className="dock-stream-warmup-dots" aria-hidden>…</span>
        </span>
      )}
      {!showWarmup && (
        <div className="msg-text msg-text--streaming-md">
          {useTailFade ? (
            <>
              {headMd}
              {tail ? (
                <span
                  key={tailKey}
                  className="dock-stream-seg"
                >
                  {tail}
                </span>
              ) : null}
              <span className="md-stream-caret md-stream-caret--inline" aria-hidden />
            </>
          ) : (
            fullMd ?? <span className="md-stream-caret md-stream-caret--inline" aria-hidden />
          )}
        </div>
      )}
    </>
  );
}

function VideoBlockPlayer({ block }: { block: ChatBlock & { type: 'video' } }) {
  const { t } = useI18n();
  const videoSrc = resolveMediaUrl(block.src || '');
  const { playUrl, loading } = useLocalFilesBlobPlayUrl(videoSrc);
  const ext =
    videoSrc
      .split('/')
      .pop()
      ?.split('?')[0]
      ?.split('.')
      .pop()
      ?.toLowerCase() || 'mp4';
  const mimeMap: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
  };
  const mimeType = mimeMap[ext] || 'video/mp4';

  return (
    <div className="msg-block video-block">
      {loading ? (
        <div
          className="video-block-player video-block-loading"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 120,
            background: '#1a1a1a',
            color: '#888',
            fontSize: 13,
            borderRadius: 8,
          }}
        >
          {t('dock.video.loading', '加载视频中…')}
        </div>
      ) : (
        <video className="video-block-player" controls playsInline preload="auto">
          {playUrl ? <source src={playUrl} type={mimeType} /> : null}
        </video>
      )}
      {block.caption && <div className="video-block-caption">{block.caption}</div>}
      <a className="video-block-download" href={videoSrc} download target="_blank" rel="noopener noreferrer">
        {t('dock.video.download', '下载视频')}
      </a>
    </div>
  );
}

function BlockRenderer({
  block,
  onConfirm,
  onDismiss,
  onCancelTask,
  onApprovalAction,
  onRecommendationChoice,
  onSoulUpdateDecision,
  onContinueAgent,
  presentation = 'default',
}: {
  block: ChatBlock;
  onConfirm?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onCancelTask?: (taskId: string) => void;
  onApprovalAction?: (approvalId: string, action: 'allow_once' | 'allow_session_auto' | 'allow_global_auto' | 'deny' | 'cancel_run', runId?: string) => void;
  onRecommendationChoice?: (recommendationId: string, choiceId: string, autoExecute: boolean) => void;
  onSoulUpdateDecision?: (proposalId: string, accepted: boolean) => void;
  /** 轮次触顶后的「继续」：新发一条用户消息续跑 */
  onContinueAgent?: () => void;
  /** 顺行 Agent：轻量足迹（单行灰字 + 可展开详情） */
  presentation?: 'default' | 'agent-footprint';
}) {
  const { t } = useI18n();
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);
  const [rosFrame, setRosFrame] = useState(0);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);

  const needsRosAnimation = block.type === 'image' && !block.src;
  useEffect(() => {
    if (!needsRosAnimation) return;
    const timer = window.setInterval(() => setRosFrame((p) => (p + 1) % 3), 1200);
    return () => window.clearInterval(timer);
  }, [needsRosAnimation]);

  if (block.type === 'terminal') {
    const hasLines = block.lines.length > 0;
    const terminalPreview = hasLines ? summarizeLines(block.lines, 56) : '';
    const terminalTitle = composeCollapsedSummary(block.label || t('dock.agent.shell', '终端输出'), terminalPreview, terminalOpen);
    return (
      <div
        className={`msg-block terminal-block dock-agent-card dock-agent-card--terminal${
          presentation === 'agent-footprint' ? ' dock-agent-card--footprint' : ''
        }`}
      >
        <div
          className={`dock-agent-card-head${hasLines ? ' dock-agent-card-head--clickable' : ''}`}
          role={hasLines ? 'button' : undefined}
          aria-expanded={hasLines ? terminalOpen : undefined}
          tabIndex={hasLines ? 0 : -1}
          onClick={hasLines ? () => setTerminalOpen((prev) => !prev) : undefined}
          onKeyDown={hasLines ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setTerminalOpen((prev) => !prev);
            }
          } : undefined}
        >
          <span className="dock-agent-card-icon" aria-hidden>▸</span>
          <span className="dock-agent-card-title">{renderSummaryWithEmphasis(terminalTitle)}</span>
          <div className="dock-agent-card-actions">
            <DockCopyIconButton
              label={t('dock.terminal.copyOut', '复制输出')}
              onCopy={() => {
                void copyDockPlainText(block.lines.map((ln) => sanitizeTerminalLineForDisplay(ln)).join('\n'));
              }}
            />
            {hasLines ? (
              <button
                type="button"
                className="dock-card-aux-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTerminalOpen((prev) => !prev);
                }}
                title={terminalOpen ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}
              >
                {terminalOpen
                  ? t('dock.tt.collapse', '收起')
                  : tf('dock.terminal.expandLines', '展开 ({{n}} 行)', { n: block.lines.length })}
              </button>
            ) : null}
          </div>
        </div>
        {terminalOpen ? (
          <div className="dock-agent-shell dock-agent-shell--sanitized" role="log">
            {block.lines.map((line, i) => (
              <div key={i} className="dock-agent-shell-line">{sanitizeTerminalLineForDisplay(line)}</div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (block.type === 'collab') {
    const hasLines = block.lines.length > 0;
    const collabPreview = hasLines ? summarizeLines(block.lines, 56) : '';
    const role = block.collabRole;
    const sideClass = block.side === 'openclaw'
      ? 'collab-block--openclaw'
      : role === 'reverse'
        ? 'collab-block--reverse'
        : role === 'outbound'
          ? 'collab-block--outbound'
          : role === 'hint'
            ? 'collab-block--hint'
            : role === 'wait_hint'
              ? 'collab-block--wait-hint'
              : 'collab-block--rdkclaw';
    const badge = block.side === 'openclaw'
      ? 'OpenClaw'
      : role === 'reverse'
        ? t('dock.collab.badgeReverse', 'OpenClaw → RDKClaw')
        : role === 'outbound'
          ? t('dock.collab.badgeOutbound', 'RDKClaw → OpenClaw')
          : role === 'wait_hint'
            ? t('dock.collab.badgeWaitHint', 'RDKClaw · 等板端')
            : 'RDKClaw';
    const renderCollabLine = (line: string, idx: number) => {
      const safe = sanitizeTerminalLineForDisplay(line);
      if (role === 'outbound') {
        const mMulti = safe.match(/^([a-zA-Z][\w\s().\-→]+):\s*\n([\s\S]*)$/);
        if (mMulti) {
          return (
            <div key={idx} className="collab-block-line collab-block-line--kv">
              <span className="collab-kv-key">{mMulti[1]}:</span>
              <pre className="collab-kv-value">{mMulti[2]}</pre>
            </div>
          );
        }
        const mSingle = safe.match(/^([a-zA-Z][\w\s().\-→]+):\s*(.+)$/);
        if (mSingle) {
          return (
            <div key={idx} className="collab-block-line collab-block-line--kv collab-block-line--kv-single">
              <span className="collab-kv-key">{mSingle[1]}:</span>
              <span className="collab-kv-value-inline">{mSingle[2]}</span>
            </div>
          );
        }
      }
      return (
        <div key={idx} className="collab-block-line dock-agent-shell-line">
          {safe}
        </div>
      );
    };
    return (
      <div
        className={`msg-block collab-block dock-agent-card dock-agent-card--collab ${sideClass}${
          presentation === 'agent-footprint' ? ' dock-agent-card--footprint' : ''
        }`}
      >
        <div
          className={`collab-block-header dock-agent-card-head${hasLines ? ' dock-agent-card-head--clickable' : ''}`}
          role={hasLines ? 'button' : undefined}
          aria-expanded={hasLines ? collabOpen : undefined}
          tabIndex={hasLines ? 0 : -1}
          onClick={hasLines ? () => setCollabOpen((prev) => !prev) : undefined}
          onKeyDown={hasLines ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCollabOpen((prev) => !prev);
            }
          } : undefined}
        >
          <span className={`collab-block-badge ${sideClass}`}>{badge}</span>
          <div className="collab-block-titles">
            {block.title && <div className="collab-block-title">{renderSummaryWithEmphasis(composeCollapsedSummary(block.title, collabPreview, collabOpen))}</div>}
            {block.subtitle && <div className="collab-block-subtitle">{block.subtitle}</div>}
          </div>
          <div className="dock-agent-card-actions">
            <DockCopyIconButton
              label={t('dock.terminal.copyOut', '复制输出')}
              onCopy={() => {
                void copyDockPlainText(block.lines.map((ln) => sanitizeTerminalLineForDisplay(ln)).join('\n'));
              }}
            />
            {hasLines ? (
              <button
                type="button"
                className="dock-card-aux-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCollabOpen((prev) => !prev);
                }}
                title={collabOpen ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}
              >
                {collabOpen
                  ? t('dock.tt.collapse', '收起')
                  : tf('dock.terminal.expandLines', '展开 ({{n}} 行)', { n: block.lines.length })}
              </button>
            ) : null}
          </div>
        </div>
        {collabOpen ? (
          <div className="collab-block-body dock-agent-shell dock-agent-shell--sanitized">
            {block.lines.map((line, i) => renderCollabLine(line, i))}
          </div>
        ) : null}
      </div>
    );
  }

  if (block.type === 'code') {
    const codePreview = summarizeInline(block.content.split('\n').find((ln) => ln.trim()) || '', 52);
    const codeTitle = composeCollapsedSummary(block.lang || 'text', codePreview, codeOpen);
    return (
      <div
        className={`msg-block code-block dock-agent-card dock-agent-card--code${
          presentation === 'agent-footprint' ? ' dock-agent-card--footprint' : ''
        }`}
      >
        <div
          className="code-block-header dock-agent-card-head dock-agent-card-head--clickable"
          role="button"
          aria-expanded={codeOpen}
          tabIndex={0}
          onClick={() => setCodeOpen((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCodeOpen((prev) => !prev);
            }
          }}
        >
          <span className="dock-agent-card-icon" aria-hidden>#</span>
          <span className="dock-agent-card-title dock-agent-card-title--mono">{codeTitle}</span>
          <div className="dock-agent-card-actions">
            <DockCopyIconButton
              label={t('dock.code.copy', '复制代码')}
              onCopy={() => { void copyDockPlainText(block.content); }}
            />
            <button
              type="button"
              className="dock-card-aux-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCodeOpen((prev) => !prev);
              }}
              title={codeOpen ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}
            >
              {codeOpen ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}
            </button>
          </div>
        </div>
        {codeOpen ? <pre className="code-block-body dock-agent-code-body"><code>{block.content}</code></pre> : null}
      </div>
    );
  }

  if (block.type === 'status') {
    if (!block.items || block.items.length === 0) {
      return null;
    }
    return (
      <StatusCollapsible
        block={block}
        presentation={presentation}
      />
    );
  }

  if (block.type === 'image') {
    if (block.src) {
      const imgUrl = resolveMediaUrl(block.src);
      return (
        <div className="msg-block image-block">
          <img
            className="image-block-real"
            src={imgUrl}
            alt={block.caption || t('dock.image.alt', '设备图片')}
            loading="lazy"
            onClick={() => window.open(imgUrl, '_blank', 'noopener,noreferrer')}
          />
          {block.caption && <div className="image-block-caption">{block.caption}</div>}
        </div>
      );
    }
    return (
      <div className="msg-block image-block">
        <div className={`image-block-preview frame-${rosFrame}`}>
          <div className="ros-vision-overlay">
            <span className="ros-bbox first" />
            <span className="ros-bbox second" />
          </div>
          <div className="image-block-live">● LIVE</div>
        </div>
        {block.caption && <div className="image-block-caption">{block.caption}</div>}
      </div>
    );
  }

  if (block.type === 'video') {
    return <VideoBlockPlayer block={block as ChatBlock & { type: 'video' }} />;
  }

  if (block.type === 'file') {
    return (
      <div className="msg-block file-block">
        <a
          className="file-block-link"
          href={resolveMediaUrl(block.src)}
          download={block.fileName}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="file-block-icon">📄</span>
          <span className="file-block-name">{block.fileName}</span>
        </a>
        {block.caption && <div className="image-block-caption">{block.caption}</div>}
      </div>
    );
  }

  if (block.type === 'confirm') {
    return (
      <div className="msg-block confirm-block">
        <div className="confirm-block-head">
          <span className="confirm-block-title">{t('dock.confirm.title', '需要你的确认')}</span>
        </div>
        <p className="confirm-block-text">{block.text}</p>
        <div className="confirm-block-actions">
          <button className="confirm-btn yes" onClick={() => onConfirm?.(block.confirmId)}>{t('dock.confirm.continue', '继续执行')}</button>
          <button className="confirm-btn no" onClick={() => onDismiss?.(block.confirmId)}>{t('dock.confirm.pause', '暂不执行')}</button>
        </div>
      </div>
    );
  }

  if (block.type === 'recommendation') {
    return (
      <div className="msg-block confirm-block recommendation-card">
        <div className="confirm-block-head">
          <span className="confirm-block-title">{t('dock.rec.title', '方案推荐')}</span>
        </div>
        {block.question && <p className="confirm-block-text">{block.question}</p>}
        <div className="recommendation-options">
          {block.options.map((opt) => (
            <button
              key={opt.id}
              className={`recommendation-option ${opt.recommended ? 'recommended' : ''} ${block.chosen === opt.id ? 'chosen' : ''}`}
              disabled={!!block.chosen}
              onClick={() => onRecommendationChoice?.(block.recommendationId, opt.id, false)}
            >
              <span className="recommendation-option-label">
                {opt.recommended && <span className="recommendation-badge">{t('dock.rec.badge', '推荐')}</span>}
                {opt.label}
              </span>
              <span className="recommendation-option-desc">{opt.description}</span>
            </button>
          ))}
        </div>
        {block.allowAutoExecute && !block.chosen && (
          <div className="recommendation-auto">
            <button
              className="confirm-btn yes"
              onClick={() => {
                const rec = block.options.find(o => o.recommended) || block.options[0];
                if (rec) onRecommendationChoice?.(block.recommendationId, rec.id, true);
              }}
            >
              {t('dock.rec.autoRun', '自动执行推荐方案')}
            </button>
          </div>
        )}
        {block.chosen && (
          <div className="recommendation-chosen">
            {tf('dock.rec.chosen', '已选择: {{label}}', { label: block.options.find(o => o.id === block.chosen)?.label || block.chosen })}
          </div>
        )}
      </div>
    );
  }

  if (block.type === 'soul-update') {
    const actionLabel = block.action === 'add'
      ? t('dock.soul.action.add', '添加')
      : block.action === 'modify'
        ? t('dock.soul.action.modify', '修改')
        : t('dock.soul.action.remove', '删除');
    const decided = block.accepted !== null && block.accepted !== undefined;
    return (
      <div className="msg-block confirm-block soul-update-card">
        <div className="confirm-block-head">
          <span className="confirm-block-title">{t('dock.soul.title', 'SOUL.md 更新提议')}</span>
          <span className="soul-update-action">{actionLabel} &lt;{block.section}&gt;</span>
        </div>
        <p className="confirm-block-text">{block.reason}</p>
        {block.currentSnippet && (
          <div className="soul-update-diff">
            <div className="soul-update-label">{t('dock.soul.current', '当前内容')}</div>
            <pre className="soul-update-pre soul-update-old">{block.currentSnippet}</pre>
          </div>
        )}
        <div className="soul-update-diff">
          <div className="soul-update-label">{block.action === 'remove' ? t('dock.soul.willRemove', '将被删除') : t('dock.soul.proposed', '提议内容')}</div>
          <pre className="soul-update-pre soul-update-new">{block.content}</pre>
        </div>
        {!decided ? (
          <div className="confirm-block-actions">
            <button className="confirm-btn yes" onClick={() => onSoulUpdateDecision?.(block.proposalId, true)}>{t('dock.soul.accept', '接受')}</button>
            <button className="confirm-btn no" onClick={() => onSoulUpdateDecision?.(block.proposalId, false)}>{t('dock.soul.reject', '拒绝')}</button>
          </div>
        ) : (
          <div className="soul-update-result">{block.accepted ? t('dock.soul.resultOk', '已更新 SOUL.md') : t('dock.soul.resultNo', '已拒绝')}</div>
        )}
      </div>
    );
  }

  if (block.type === 'approval') {
    const risk = (block.risk || 'medium').toLowerCase();
    const riskLabel = risk === 'high'
      ? t('dock.approval.risk.high', '高风险')
      : risk === 'low'
        ? t('dock.approval.risk.low', '低风险')
        : t('dock.approval.risk.medium', '中风险');
    return (
      <div className={`msg-block confirm-block approval-card risk-${risk}`}>
        <div className="confirm-block-head">
          <span className="confirm-block-title">{t('dock.approval.title', '操作审批')}</span>
          <span className={`approval-risk ${risk}`}>{riskLabel}</span>
        </div>
        <p className="confirm-block-text">{block.text}</p>
        <div className="approval-hint">{t('dock.approval.hint', '请选择一个操作（建议先用“仅这次允许”）')}</div>
        <div className="confirm-block-actions">
          <button className="confirm-btn yes primary" onClick={() => onApprovalAction?.(block.approvalId, 'allow_once', block.runId)}>{t('dock.approval.allowOnce', '仅这次允许')}</button>
          <button className="confirm-btn yes" onClick={() => onApprovalAction?.(block.approvalId, 'allow_session_auto', block.runId)}>{t('dock.approval.allowSession', '本会话自动允许')}</button>
          <button className="confirm-btn yes" onClick={() => onApprovalAction?.(block.approvalId, 'allow_global_auto', block.runId)}>{t('dock.approval.allowGlobal', '全局自动允许')}</button>
          <button className="confirm-btn no" onClick={() => onApprovalAction?.(block.approvalId, 'deny', block.runId)}>{t('dock.approval.deny', '拒绝本次操作')}</button>
          <button className="confirm-btn no danger" onClick={() => onApprovalAction?.(block.approvalId, 'cancel_run', block.runId)}>{t('dock.approval.cancelRun', '结束当前任务')}</button>
        </div>
      </div>
    );
  }

  if (block.type === 'progress') {
    const hasRunning = block.steps.some(s => s.status === 'running');
    const activeStep = block.steps.find((s) => s.status === 'running')?.label || block.steps[0]?.label || '';
    const progressTitle = composeCollapsedSummary(t('dock.agent.steps', '执行步骤'), summarizeInline(activeStep, 48), progressOpen);
    return (
      <div
        className={`msg-block progress-block dock-agent-card dock-agent-card--progress${
          presentation === 'agent-footprint' ? ' dock-agent-card--footprint' : ''
        }`}
      >
        <div
          className="dock-agent-card-head dock-agent-card-head--compact dock-agent-card-head--clickable"
          role="button"
          aria-expanded={progressOpen}
          tabIndex={0}
          onClick={() => setProgressOpen((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setProgressOpen((prev) => !prev);
            }
          }}
        >
          <span className="dock-agent-card-icon" aria-hidden>↳</span>
          <span className="dock-agent-card-title">{renderSummaryWithEmphasis(progressTitle)}</span>
          <div className="dock-agent-card-actions">
            <button
              type="button"
              className="dock-card-aux-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setProgressOpen((prev) => !prev);
              }}
              title={progressOpen ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}
            >
              {progressOpen ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}
            </button>
          </div>
        </div>
        {progressOpen ? (
          <>
            <ul className="dock-agent-step-list">
              {block.steps.map((step, i) => (
                <li key={i} className={`dock-agent-step-line dock-agent-step-line--${step.status}`}>
                  <span className="dock-agent-step-mark" aria-hidden>
                    {step.status === 'done' ? '·' : step.status === 'running' ? '›' : '○'}
                  </span>
                  <span className="dock-agent-step-label">{step.label}</span>
                </li>
              ))}
            </ul>
            {hasRunning && block.taskId && onCancelTask && (
              <button className="task-cancel-btn" onClick={() => onCancelTask(block.taskId!)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                {t('dock.progress.cancelTask', '取消任务')}
              </button>
            )}
          </>
        ) : null}
      </div>
    );
  }

  if (block.type === 'task-result') {
    const detailClean = block.detail
      ? block.detail.split('\n').map((ln) => sanitizeTerminalLineForDisplay(ln)).join('\n')
      : '';
    const resultPreview = summarizeInline(detailClean, 56);
    const resultTitle = composeCollapsedSummary(block.title, resultPreview, resultOpen);
    return (
      <div
        className={`msg-block task-result-block dock-agent-card dock-agent-card--result ${block.success ? 'success' : 'fail'}${
          presentation === 'agent-footprint' ? ' dock-agent-card--footprint' : ''
        }`}
      >
        <div
          className={`task-result-header dock-agent-card-head${block.detail?.trim() ? ' dock-agent-card-head--clickable' : ''}`}
          role={block.detail?.trim() ? 'button' : undefined}
          aria-expanded={block.detail?.trim() ? resultOpen : undefined}
          tabIndex={block.detail?.trim() ? 0 : -1}
          onClick={block.detail?.trim() ? () => setResultOpen((prev) => !prev) : undefined}
          onKeyDown={block.detail?.trim() ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setResultOpen((prev) => !prev);
            }
          } : undefined}
        >
          <span className="dock-agent-card-icon" aria-hidden>{block.success ? '✓' : '✗'}</span>
          <span className="dock-agent-card-title">{renderSummaryWithEmphasis(resultTitle)}</span>
          {block.detail?.trim() ? (
            <div className="dock-agent-card-actions">
              <DockCopyIconButton
                label={t('dock.taskResult.copyDetail', '复制结果详情')}
                onCopy={() => { void copyDockPlainText(detailClean); }}
              />
              <button
                type="button"
                className="dock-card-aux-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setResultOpen((prev) => !prev);
                }}
                title={resultOpen ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}
              >
                {resultOpen ? t('dock.tt.collapse', '收起') : t('dock.tt.expand', '展开')}
              </button>
            </div>
          ) : null}
        </div>
        {block.detail && resultOpen ? (
          <pre className="task-result-detail dock-agent-result-body">{detailClean}</pre>
        ) : null}
      </div>
    );
  }

  if (block.type === 'continue-run') {
    return (
      <div
        className={`msg-block continue-run-block dock-agent-card dock-agent-card--continue${
          presentation === 'agent-footprint' ? ' dock-agent-card--footprint' : ''
        }`}
      >
        <div className="dock-agent-card-head dock-agent-card-head--compact">
          <span className="dock-agent-card-icon" aria-hidden>↻</span>
          <span className="dock-agent-card-title">
            {t('dock.continueRun.title', '本轮推理已达上限')}
          </span>
        </div>
        {block.hint ? (
          <p className="continue-run-hint">{block.hint}</p>
        ) : null}
        <p className="continue-run-body">
          {t(
            'dock.continueRun.body',
            '点击下方按钮会发送一条续跑指令，在同一对话中接着处理未完成任务（不重复已成功步骤）。',
          )}
        </p>
        <div className="continue-run-actions">
          <button
            type="button"
            className="btn btn-primary continue-run-cta"
            onClick={() => onContinueAgent?.()}
          >
            {t('dock.continueRun.cta', '继续')}
          </button>
        </div>
      </div>
    );
  }

  if (block.type === 'reasoning') {
    return <ReasoningCollapsible block={block} presentation={presentation} />;
  }

  return null;
}

const OMITTED_STORAGE_URL = '[omitted-large-data-url]';

function AttachmentVideoPlayer({ resolvedSrc, name }: { resolvedSrc: string; name: string }) {
  const { t } = useI18n();
  const { playUrl, loading } = useLocalFilesBlobPlayUrl(resolvedSrc);
  if (loading) {
    return (
      <div className="chat-attachment-video chat-attachment-loading" style={{ padding: '12px 0', color: 'var(--muted, #888)', fontSize: 12 }}>
        {t('dock.video.loading', '加载视频中…')}
      </div>
    );
  }
  return <video src={playUrl} controls preload="metadata" aria-label={name} />;
}

function AttachmentAudioPlayer({ resolvedSrc, name }: { resolvedSrc: string; name: string }) {
  const { t } = useI18n();
  const { playUrl, loading } = useLocalFilesBlobPlayUrl(resolvedSrc);
  if (loading) {
    return (
      <span className="file-attachment-size" style={{ color: 'var(--muted, #888)' }}>
        {t('dock.audio.loading', '加载音频中…')}
      </span>
    );
  }
  return <audio src={playUrl} controls preload="metadata" aria-label={name} />;
}

function AttachmentRenderer({ attachment }: { attachment: ChatAttachment }) {
  const { t } = useI18n();
  const rawUrl = attachment.url?.trim() ?? '';
  let resolvedSrc =
    rawUrl && rawUrl !== OMITTED_STORAGE_URL ? resolveMediaUrl(rawUrl) : '';
  if (
    !resolvedSrc
    && attachment.name
    && MEDIA_IMAGE_RE.test(attachment.name)
    && (attachment.type === 'file' || attachment.type === 'image')
  ) {
    resolvedSrc = resolveMediaUrl(`/api/local-files/${encodeURIComponent(attachment.name)}`);
  }

  if (attachment.type === 'image') {
    return (
      <div className="chat-attachment chat-attachment-image">
        {resolvedSrc ? (
          <img
            src={resolvedSrc}
            alt={attachment.name}
            loading="lazy"
            onClick={() => window.open(resolvedSrc, '_blank', 'noopener,noreferrer')}
          />
        ) : (
          <div className="file-attachment-info">
            <span className="file-attachment-name">{attachment.name}</span>
            <span className="file-attachment-size">
              {rawUrl === OMITTED_STORAGE_URL
                ? t('dock.attach.imageNotStored', '已从存档中省略大图预览，可重新发送图片')
                : t('dock.attach.imageHint', '图片附件已上传，可在当前会话继续分析')}
            </span>
          </div>
        )}
      </div>
    );
  }
  if (
    attachment.type === 'file'
    && resolvedSrc
    && MEDIA_IMAGE_RE.test(attachment.name)
  ) {
    return (
      <div className="chat-attachment chat-attachment-image">
        <img
          src={resolvedSrc}
          alt={attachment.name}
          loading="lazy"
          onClick={() => window.open(resolvedSrc, '_blank', 'noopener,noreferrer')}
        />
        {attachment.name ? <div className="image-block-caption">{attachment.name}</div> : null}
      </div>
    );
  }
  if (attachment.type === 'video') {
    return (
      <div className="chat-attachment chat-attachment-video">
        {resolvedSrc ? (
          <AttachmentVideoPlayer resolvedSrc={resolvedSrc} name={attachment.name} />
        ) : (
          <div className="file-attachment-info">
            <span className="file-attachment-name">{attachment.name}</span>
            <span className="file-attachment-size">{t('dock.attach.videoHint', '视频附件已上传')}</span>
          </div>
        )}
      </div>
    );
  }
  if (attachment.type === 'audio') {
    return (
      <div className="chat-attachment chat-attachment-audio">
        <div className="audio-msg-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
        </div>
        {resolvedSrc ? (
          <AttachmentAudioPlayer resolvedSrc={resolvedSrc} name={attachment.name} />
        ) : (
          <span className="file-attachment-size">{t('dock.attach.audioHint', '语音附件已上传')}</span>
        )}
        {attachment.transcript && (
          <div className="file-attachment-info">
            <span className="file-attachment-size">{t('dock.attach.transcriptPrefix', '转写：')}{attachment.transcript}</span>
          </div>
        )}
      </div>
    );
  }
  const sizeStr = attachment.size ? `${(attachment.size / 1024).toFixed(1)} KB` : '';
  return (
    <div className="chat-attachment chat-attachment-file">
      <div className="file-attachment-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div className="file-attachment-info">
        <span className="file-attachment-name">{attachment.name}</span>
        {sizeStr && <span className="file-attachment-size">{sizeStr}</span>}
      </div>
    </div>
  );
}

/** 卡片/思考区：图标复制（竞品式，悬停强化，避免长文案「复制」挤在栏外） */
function DockCopyIconButton({
  label,
  onCopy,
}: {
  label: string;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      className="dock-card-icon-btn"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCopy();
      }}
    >
      <Copy size={15} strokeWidth={2} aria-hidden />
    </button>
  );
}

async function copyDockPlainText(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function AIDock() {
  const {
    activeDevice, setActiveDevice, devices,
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, setChatMessages, chatExpanded, setChatExpanded, aiTyping, setAiTyping,
    handleCommand, setActiveTab, activeTab,
    executeConfirm, dismissConfirm, clearChatHistory,
    agentExecution,
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask,
    handleApprovalAction, handleRecommendationChoice, handleSoulUpdateDecision, stopCurrentRun, stopAllRuns,
    openclawConnected, setOpenclawConnected,
    openclawSendMessage,
    currentDevice, addToast, language, setLanguage,
    studioResponseMode, setStudioResponseMode,
    getStudioChatSessionId,
    setShowAddDevice,
    setObStep,
  } = useAppState();
  const cmdRef = useRef(cmd);
  cmdRef.current = cmd;
  const { hubAnchorEl, defaultHostNode } = useHubDockAnchor();
  const { t, isEn } = useI18n();
  const [dockFlashWizardOpen, setDockFlashWizardOpen] = useState(false);
  const [responseModeMenuOpen, setResponseModeMenuOpen] = useState(false);
  const responseModeMenuRef = useRef<HTMLDivElement | null>(null);
  const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0);
  const [unsatisfiedModal, setUnsatisfiedModal] = useState<{ msgId: number; preview: string } | null>(null);
  const [unsatisfiedNote, setUnsatisfiedNote] = useState('');

  const submitUnsatisfiedRetry = useCallback(() => {
    if (!unsatisfiedModal) return;
    if (aiTyping) {
      addToast(t('dock.msg.unsatisfiedBusy', '请等待当前回复结束后再试。'), 'warning');
      return;
    }
    const clip = unsatisfiedModal.preview;
    const note = unsatisfiedNote.trim();
    const body = isEn
      ? note
        ? `[rdk-studio: retry-previous-reply]\nImprove your previous assistant message using the excerpt below.\n\n---\n${clip}\n---\nUser note: ${note}`
        : `[rdk-studio: retry-previous-reply]\nThe user gave no details. Briefly confirm what was wrong or missing, then improve.\n\n---\n${clip}\n---`
      : note
        ? `[rdk-studio: 对上一则助手回复不满意]\n请针对下列节选改进上一则回答（更完整、更具体或更正错误）。\n\n---\n${clip}\n---\n用户补充：${note}`
        : `[rdk-studio: 对上一则助手回复不满意]\n用户未写补充说明；请先简短确认诉求或偏差，再给出更好的回答。\n\n---\n${clip}\n---`;
    const chatPreviewText = note
      ? fillTemplate(t('dock.msg.unsatisfiedPreviewWithNote', '不满意上一则 · {{note}}'), { note })
      : t('dock.msg.unsatisfiedPreview', '不满意上一则回复，请改进。');
    handleCommand({ preventDefault() {} } as React.FormEvent, {
      messageOverride: body,
      chatPreviewText,
    });
    setUnsatisfiedModal(null);
    setUnsatisfiedNote('');
  }, [unsatisfiedModal, unsatisfiedNote, aiTyping, addToast, t, isEn, handleCommand]);

  /** 轮次触顶后显式「继续」：发送一条续跑用户消息 */
  const handleContinueAfterTurnLimit = useCallback(() => {
    if (aiTyping) {
      addToast(t('dock.continueRun.busy', '请等待当前回复结束后再试。'), 'warning');
      return;
    }
    handleCommand({ preventDefault() {} } as React.FormEvent, {
      messageOverride: t(
        'chat.continueAgent.message',
        '请接着上一条助手回复继续执行：在未完成的操作、错误排查或上一步未完成处接着推进，不要重复已成功或已确认的步骤。',
      ),
      chatPreviewText: t('chat.continueAgent.preview', '继续任务'),
    });
  }, [aiTyping, addToast, t, handleCommand]);

  useEffect(() => {
    if (!unsatisfiedModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUnsatisfiedModal(null);
        setUnsatisfiedNote('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [unsatisfiedModal]);

  useEffect(() => {
    if (!responseModeMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = responseModeMenuRef.current;
      if (el && !el.contains(e.target as Node)) {
        // 延后一帧再关，避免同一次点击还要触发发送等操作时被子树更新干扰
        window.requestAnimationFrame(() => setResponseModeMenuOpen(false));
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setResponseModeMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [responseModeMenuOpen]);

  const mentionParse = useMemo(() => parseTrailingAtMention(cmd), [cmd]);
  const filteredMentionCaps = useMemo(() => {
    if (!mentionParse) return [];
    return filterMentionCapabilities(DOCK_MENTION_CAPABILITIES, mentionParse.query, isEn);
  }, [mentionParse, isEn]);
  const mentionMenuActive = Boolean(mentionParse);

  useLayoutEffect(() => {
    if (!mentionMenuActive) return;
    setMentionHighlightIdx((i) => {
      const n = filteredMentionCaps.length;
      if (n <= 0) return 0;
      return Math.min(i, n - 1);
    });
  }, [mentionMenuActive, filteredMentionCaps.length]);

  const pickMentionCapability = useCallback(
    (id: DockMentionCapabilityId) => {
      if (!mentionParse) return;
      const prefix = cmd.slice(0, mentionParse.atIndex).trimEnd();
      setCmd(prefix);
      setShowSuggestions(false);
      if (id === 'flash') {
        setDockFlashWizardOpen(true);
      }
    },
    [cmd, mentionParse, setCmd, setShowSuggestions],
  );

  const tfDock = useCallback(
    (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars),
    [t],
  );

  const formatDockDurationMs = useCallback(
    (ms: number) => {
      if (!Number.isFinite(ms) || ms < 0) return t('dock.msg.durationUnknown', '—');
      if (ms < 1000) return `${Math.round(ms)}${isEn ? ' ms' : ' 毫秒'}`;
      const s = ms / 1000;
      if (s < 60) {
        const str = s < 10 ? s.toFixed(1) : String(Math.round(s));
        return isEn ? `${str} s` : `${str} 秒`;
      }
      const m = Math.floor(s / 60);
      const rs = Math.round(s % 60);
      return isEn ? `${m}m ${rs}s` : `${m} 分 ${rs} 秒`;
    },
    [isEn, t],
  );

  const runRegenerate = useCallback(
    async (aiMsgId: number) => {
      if (aiTyping) {
        addToast(t('dock.msg.unsatisfiedBusy', '请等待当前回复结束后再试。'), 'warning');
        return;
      }
      const aiEntry = chatMessages.find((m) => m.id === aiMsgId);
      if (!aiEntry || aiEntry.role !== 'ai') return;
      const prev = findPreviousStudioUserMessage(chatMessages, aiMsgId);
      if (!prev) return;
      let attachments: AgentAttachmentPayload[] = [];
      if (prev.attachments && prev.attachments.length > 0) {
        const { payloads, dropped } = await chatAttachmentsToAgentPayloadForRetry(prev.attachments);
        attachments = payloads;
        if (dropped) {
          addToast(t('dock.retry.attachPartial', '部分附件无法再次发送，已跳过无效项。'), 'warning');
        }
      }
      const msgLine = prev.text.trim();
      if (!msgLine && attachments.length === 0) {
        addToast(t('dock.retry.nothingToSend', '没有可重试的内容。'), 'warning');
        return;
      }
      handleCommand({ preventDefault() {} } as React.FormEvent, {
        regenerate: {
          removeAiMessageId: aiMsgId,
          anchorUserMessageId: prev.id,
          message: msgLine,
          attachments,
        },
      });
    },
    [addToast, aiTyping, chatMessages, handleCommand, t],
  );

  const rdkEmbedPanel = useMemo(() => (typeof window !== 'undefined' ? getRdkEmbedPanel() : null), []);
  const embedDockCtxTab = useMemo(() => getRdkEmbedDockCtx(), []);

  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [dockOcMode, setDockOcMode] = useState(true);
  const [hideDockInSubpage, setHideDockInSubpage] = useState<boolean>(() => {
    try {
      return localStorage.getItem('rdk:dock:hide-subpage') === '1';
    } catch {
      return false;
    }
  });
  /** 产品固定：完整展示 + 单列顺行；顶栏不再展示模式标签 */
  const minimalResultMode = false;
  const agentTurnLayout = true;
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  /** 麦克风按钮提示：是否已配置本机/云端转写 */
  const [voiceMicTitleSuffix, setVoiceMicTitleSuffix] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTranscript, setRecordingTranscript] = useState('');
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  /** 停录后正在把语音转成文字填入输入框（不发音频附件） */
  const [voiceSttLoading, setVoiceSttLoading] = useState(false);
  const [inputContextMenu, setInputContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragOverInput, setDragOverInput] = useState(false);
  const activeDeviceName = currentDevice?.name?.trim() || '';
  const activeDeviceEndpoint = currentDevice ? `${currentDevice.ip || '-'}:${currentDevice.port ?? 22}` : '';
  const activeRdkclawDeviceLabel = useMemo(() => {
    if (!currentDevice) return t('dock.device.unbound', '未绑定设备');
    return `${activeDeviceName || t('dock.device.unnamed', '未命名设备')} · ${activeDeviceEndpoint}`;
  }, [activeDeviceName, activeDeviceEndpoint, currentDevice, t]);

  /** 与会话列表一致：首问摘要，便于顶栏与侧栏对齐认知 */
  const dockThreadTitleLine = useMemo(
    () => (chatMessages.length ? buildThreadSummaryLine(chatMessages, t) : ''),
    [chatMessages, t],
  );

  const beginNewChat = useCallback(async () => {
    await confirmAndBeginNewChat({ aiTyping, taskHistory, t, stopAllRuns, clearChatHistory });
  }, [aiTyping, taskHistory, stopAllRuns, clearChatHistory, t]);

  const channelStats = useMemo(() => {
    let feishuInbound = 0;
    let feishuTotal = 0;
    let weixinInbound = 0;
    let weixinTotal = 0;
    for (const message of chatMessages) {
      const channel = message.channelMeta?.channel;
      if (!channel) continue;
      const inbound = message.channelMeta?.direction === 'inbound';
      if (channel === 'feishu') {
        feishuTotal += 1;
        if (inbound) feishuInbound += 1;
      } else if (channel === 'weixin') {
        weixinTotal += 1;
        if (inbound) weixinInbound += 1;
      }
    }
    return { feishuInbound, feishuTotal, weixinInbound, weixinTotal };
  }, [chatMessages]);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  /** 实际滚动容器是 .dock-stream（仅 chatExpanded 时挂载），不能用仅首屏执行的 scrollIntoView */
  const streamScrollRef = useRef<HTMLDivElement | null>(null);
  /** 用户是否在底部附近；为 false 时流式更新不再强行滚到底，避免打断阅读 */
  const streamPinnedToBottomRef = useRef(true);
  const prevChatExpandedRef = useRef(false);
  const prevTabForWorkbenchScrollRef = useRef<Tab | null>(null);
  const prevChatLenRef = useRef(0);
  const prevAiTypingRef = useRef(false);
  const socketRef = useRef<SocketIOClient.Socket | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceTranscriptRef = useRef('');
  const isRecordingRef = useRef(false);
  /** 浏览器 Web Speech `network` 错误易短时连发，压成最多约 45s 一条提示 */
  const speechNetworkToastAtRef = useRef(0);

  useEffect(() => {
    if (rdkEmbedPanel !== 'ai-dock') return;
    setChatExpanded(true);
    setWorkspaceMode(true);
  }, [rdkEmbedPanel, setChatExpanded]);

  useEffect(() => {
    if (!inputContextMenu) return;
    const handleClose = () => setInputContextMenu(null);
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInputContextMenu(null);
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('keydown', handleEsc);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('keydown', handleEsc);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, [inputContextMenu]);

  const executeInputCommand = useCallback(async (command: 'cut' | 'copy' | 'paste' | 'selectAll') => {
    const input = chatInputRef.current;
    if (!input) return;
    input.focus();
    if (command === 'paste') {
      try {
        const text = await navigator.clipboard.readText();
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        const next = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
        setCmd(next);
        const caret = start + text.length;
        window.requestAnimationFrame(() => input.setSelectionRange(caret, caret));
        return;
      } catch {
        document.execCommand('paste');
        return;
      }
    }
    if (command === 'selectAll') {
      input.select();
      return;
    }
    document.execCommand(command);
  }, [setCmd]);

  const addAttachment = useCallback((file: File, extras?: { transcript?: string; textContent?: string }): string | undefined => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isImage = file.type.startsWith('image/') || /^(jpe?g|png|gif|bmp|webp|svg|ico|tiff?)$/.test(ext);
    const isVideo = file.type.startsWith('video/') || /^(mp4|webm|avi|mov|mkv|flv|wmv|m4v|3gp)$/.test(ext);
    const isAudio = file.type.startsWith('audio/') || /^(mp3|wav|ogg|flac|aac|wma|m4a)$/.test(ext);
    const sizeLimit = isVideo ? MAX_PENDING_VIDEO_BYTES : MAX_PENDING_ATTACHMENT_BYTES;
    if (file.size > sizeLimit) {
      addToast(fillTemplate(t('dock.attach.tooLarge', '附件 {{name}} 过大，请控制在 {{mb}}MB 以内'), {
        name: file.name,
        mb: Math.floor(sizeLimit / (1024 * 1024)),
      }), 'warning');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const att: PendingAttachment = {
      id,
      type: isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'file',
      name: file.name,
      url,
      mimeType: file.type || undefined,
      size: file.size,
      transcript: extras?.transcript,
      textContent: extras?.textContent,
      file,
    };
    setPendingAttachments(prev => [...prev, att]);
    return id;
  }, [addToast, t]);

  /** 仅转写：把录音发给本机后端（whisper.cpp / 云端 ASR），不把文件挂成附件 */
  const transcribeVoiceBlobToText = useCallback(async (file: File): Promise<string | null> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 180_000);
    try {
      const res = await fetchApi('/api/agent/transcribe-audio', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'audio/webm',
          'X-Attachment-Name': encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
        signal: controller.signal,
      });
      const raw = await res.json().catch(() => ({})) as { error?: string; transcript?: string };
      if (!res.ok) {
        addToast(String(raw.error || t('dock.voice.serverSttFail', '服务端语音转写失败')), 'warning');
        return null;
      }
      return String(raw.transcript || '').trim() || null;
    } catch (e) {
      const msg =
        e instanceof Error && e.name === 'AbortError'
          ? t('dock.voice.serverSttTimeout', '语音转写超时，请重试或检查本机 whisper / 网络')
          : e instanceof Error
            ? e.message
            : t('dock.voice.serverSttFail', '服务端语音转写失败');
      addToast(msg, 'warning');
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }, [addToast, t]);

  useEffect(() => {
    if (!STUDIO_ENABLE_VOICE_TO_TEXT) return;
    let cancelled = false;
    fetchApi('/api/agent/transcribe-capabilities')
      .then(r => r.json())
      .then((d: { localWhisper?: boolean; studioProvider?: boolean; cloudAsrSupported?: boolean }) => {
        if (cancelled) return;
        if (d.localWhisper) {
          setVoiceMicTitleSuffix(` · ${t('dock.voice.cap.local', '本机转写已开')}`);
        } else if (d.studioProvider && d.cloudAsrSupported) {
          setVoiceMicTitleSuffix(` · ${t('dock.voice.cap.cloud', '将用云端转写')}`);
        } else if (d.studioProvider && !d.cloudAsrSupported) {
          setVoiceMicTitleSuffix(` · ${t('dock.voice.cap.noCloudAsr', '对话渠道无语音 API，请配本机 whisper')}`);
        } else {
          setVoiceMicTitleSuffix(` · ${t('dock.voice.cap.none', '未配转写：语音可能无文字')}`);
        }
      })
      .catch(() => {
        if (!cancelled) setVoiceMicTitleSuffix('');
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const uploadSessionRef = useRef(`upload-${Date.now()}`);

  const uploadLargeAttachment = useCallback(async (file: File, type: string): Promise<{ id: string; storedPath: string }> => {
    const buffer = await file.arrayBuffer();
    const res = await fetchApi('/api/agent/upload-attachment', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Attachment-Name': encodeURIComponent(file.name),
        'X-Attachment-Type': type,
        'X-Session-Id': uploadSessionRef.current,
      },
      body: buffer,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: t('dock.upload.fail', '上传失败') }));
      throw new Error(String(err.error || t('dock.upload.fail', '上传失败')));
    }
    const data = await res.json() as { attachment: { id: string; storedPath: string } };
    return { id: data.attachment.id, storedPath: data.attachment.storedPath };
  }, [t]);

  const materializeAgentAttachments = useCallback(async (attachments: PendingAttachment[]): Promise<AgentAttachmentPayload[]> => {
    return Promise.all(attachments.map(async (attachment) => {
      const payload: AgentAttachmentPayload = {
        id: attachment.id,
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        transcript: attachment.transcript,
        textContent: attachment.textContent,
        source: 'studio',
      };

      const UPLOAD_THRESHOLD = 5 * 1024 * 1024;
      if (attachment.file.size > UPLOAD_THRESHOLD) {
        const uploaded = await uploadLargeAttachment(attachment.file, attachment.type);
        payload.id = uploaded.id;
        payload.storedPath = uploaded.storedPath;
      } else if (attachment.file.size > 0) {
        payload.contentBase64 = await fileToBase64(attachment.file);
      }

      if (!payload.textContent && isTextLikeFile(attachment.file) && attachment.file.size <= 256 * 1024) {
        try {
          payload.textContent = (await attachment.file.text()).slice(0, 12_000);
        } catch {
          // ignore text extraction failure
        }
      }

      return payload;
    }));
  }, [uploadLargeAttachment]);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => {
      const removed = prev.find(a => a.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  /* 组件卸载时 revoke 所有未清理的 ObjectURL，防止内存泄漏 */
  const pendingAttachmentsRef = useRef(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;
  useEffect(() => {
    return () => {
      pendingAttachmentsRef.current.forEach(a => URL.revokeObjectURL(a.url));
    };
  }, []);

  const handleFilePick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => addAttachment(file));
    e.target.value = '';
  }, [addAttachment]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverInput(false);
    const files = e.dataTransfer.files;
    Array.from(files).forEach((file) => addAttachment(file));
  }, [addAttachment]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setDragOverInput(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const related = e.relatedTarget as Node | null;
    if (related && el.contains(related)) return;
    setDragOverInput(false);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const files = collectClipboardFiles(e.nativeEvent);
    if (files.length === 0) return;
    e.preventDefault();
    files.forEach((f) => addAttachment(f));
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const input = e.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const next = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    setCmd(next);
    window.requestAnimationFrame(() => {
      const caret = start + text.length;
      input.setSelectionRange(caret, caret);
    });
  }, [addAttachment, setCmd]);

  const VOICE_MAX_SECONDS = 60;

  useEffect(() => {
    if (!isRecording) {
      setRecordingElapsed(0);
      return;
    }
    const t0 = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - t0) / 1000);
      setRecordingElapsed(elapsed);
      if (elapsed >= VOICE_MAX_SECONDS) {
        isRecordingRef.current = false;
        const rec = speechRecognitionRef.current;
        speechRecognitionRef.current = null;
        rec?.stop();
        mediaRecorderRef.current?.stop();
        setIsRecording(false);
      }
    }, 500);
    return () => window.clearInterval(tick);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        try { speechRecognitionRef.current?.stop(); } catch { /* ignore */ }
        speechRecognitionRef.current = null;
        try { mediaRecorderRef.current?.stop(); } catch { /* ignore */ }
      }
    };
  }, []);

  const toggleVoiceRecord = useCallback(async () => {
    if (!STUDIO_ENABLE_VOICE_TO_TEXT) return;
    if (isRecording) {
      /* 必须先清会话标记再 stop，否则 recognition.onend 会误以为仍要录音并误触逻辑 */
      isRecordingRef.current = false;
      const rec = speechRecognitionRef.current;
      speechRecognitionRef.current = null;
      rec?.stop();
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    if (voiceSttLoading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      voiceTranscriptRef.current = '';
      setRecordingTranscript('');

      const speechWindow = window as Window & {
        SpeechRecognition?: BrowserSpeechRecognitionCtor;
        webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
      };
      const SpeechRecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
      if (!RDK_DISABLE_BROWSER_SPEECH && SpeechRecognitionCtor) {
        try {
          const recognition = new SpeechRecognitionCtor();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = language === 'en' ? 'en-US' : 'zh-CN';
          recognition.onresult = (event) => {
            let finalPart = '';
            let interimPart = '';
            const { results } = event;
            for (let i = 0; i < results.length; i += 1) {
              const row = results[i];
              const alt = row?.[0];
              const piece = alt?.transcript ? String(alt.transcript) : '';
              if (!piece) continue;
              if (row.isFinal) finalPart += piece;
              else interimPart += piece;
            }
            const merged = `${finalPart}${interimPart}`.trim();
            voiceTranscriptRef.current = merged;
            setRecordingTranscript(merged);
          };
          recognition.onerror = (ev) => {
            const code = ev.error || '';
            if (code === 'aborted' || code === 'no-speech') return;
            if (code === 'network') {
              const now = Date.now();
              if (now - speechNetworkToastAtRef.current < 45_000) return;
              speechNetworkToastAtRef.current = now;
              addToast(
                t(
                  'dock.voice.err.networkHint',
                  '浏览器语音识别需联网（多为 Google）。纯离线请设置环境变量 VITE_DISABLE_BROWSER_SPEECH=true 并配置本机 RDK_STUDIO_WHISPER_CPP。',
                ),
                'warning',
              );
              return;
            }
            const reason =
              code === 'not-allowed'
                ? t('dock.voice.err.notAllowed', '麦克风或语音识别权限被拒绝')
                : code === 'audio-capture'
                    ? t('dock.voice.err.audioCapture', '无法捕获音频，请检查麦克风')
                    : code === 'service-not-allowed'
                      ? t('dock.voice.err.serviceBlocked', '浏览器阻止了语音服务')
                      : fillTemplate(t('dock.voice.err.withCode', '语音识别异常（{{code}}）'), { code: code || 'unknown' });
            addToast(reason, 'warning');
          };
          /* Chrome 等在停顿后会结束一轮识别并触发 onend；仍在录音时应自动 start 下一轮，否则会一直没有转写 */
          recognition.onend = () => {
            if (!isRecordingRef.current) return;
            if (speechRecognitionRef.current !== recognition) return;
            window.setTimeout(() => {
              if (!isRecordingRef.current || speechRecognitionRef.current !== recognition) return;
              try {
                recognition.start();
              } catch {
                /* InvalidStateError：忽略 */
              }
            }, 0);
          };
          speechRecognitionRef.current = recognition;
          recognition.start();
        } catch {
          speechRecognitionRef.current = null;
        }
      } else if (RDK_DISABLE_BROWSER_SPEECH) {
        /* 避免 Chrome Web Speech 连 Google；依赖停录后 POST /api/agent/transcribe-audio */
      } else {
        addToast(
          t(
            'dock.voice.noSttApi',
            '当前环境不支持网页语音转写，将只保存录音。可改用 Chrome / Edge 或在停止录音后使用附件转写。',
          ),
          'info',
        );
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        speechRecognitionRef.current?.stop();
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        const browserTx = voiceTranscriptRef.current.trim();
        setRecordingTranscript('');
        voiceTranscriptRef.current = '';

        void (async () => {
          setVoiceSttLoading(true);
          try {
            let text = '';
            if (file.size > 0) {
              const serverTx = await transcribeVoiceBlobToText(file);
              if (serverTx) text = serverTx;
            }
            if (!text && browserTx) text = browserTx;
            if (text) {
              const cur = cmdRef.current.trim();
              setCmd(cur ? `${cur} ${text}` : text);
              window.requestAnimationFrame(() => chatInputRef.current?.focus());
            } else if (file.size > 0 && !browserTx) {
              addToast(
                t(
                  'dock.voice.sttEmpty',
                  '未得到文字：请配置本机 whisper（RDK_STUDIO_WHISPER_CPP）或 Studio 语音识别，并安装 ffmpeg；也可启用浏览器语音识别。',
                ),
                'warning',
              );
            }
          } finally {
            setVoiceSttLoading(false);
          }
        })();
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      isRecordingRef.current = true;
    } catch {
      addToast(t('dock.mic.denied', '无法访问麦克风，请检查浏览器或桌面端权限'), 'warning');
    }
  }, [isRecording, addToast, setCmd, language, t, transcribeVoiceBlobToText, voiceSttLoading]);

  const maxVisibleMessages = 40;
  const visibleMessages = showAllMessages ? chatMessages : chatMessages.slice(-maxVisibleMessages);
  const hiddenCount = Math.max(0, chatMessages.length - visibleMessages.length);
  const dockTurnEntries = useMemo(() => buildDockTurns(visibleMessages), [visibleMessages]);
  /** 流式一轮会先追加一条 ai 占位消息，此时不再单独画底部「第二行头像」打字条 */
  const lastVisibleMsg = visibleMessages[visibleMessages.length - 1];
  const streamMergedIntoLastAiBubble =
    aiTyping && lastVisibleMsg?.role === 'ai';
  /* Escape exits workspace mode */
  useEffect(() => {
    if (!workspaceMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWorkspaceMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspaceMode]);

  /* Exit workspace mode when switching tabs or closing chat */
  useEffect(() => {
    if (!chatExpanded) setWorkspaceMode(false);
  }, [chatExpanded]);

  useEffect(() => {
    setWorkspaceMode(false);
  }, [activeTab]);

  useEffect(() => {
    try {
      localStorage.removeItem('rdk:dock:compact-flow');
    } catch {
      // ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('rdk:dock:hide-subpage', hideDockInSubpage ? '1' : '0');
    } catch {
      // ignore localStorage errors
    }
  }, [hideDockInSubpage]);

  const streamScrollNearBottom = useCallback((el: HTMLElement, thresholdPx = 72) => {
    const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
    return gap <= thresholdPx;
  }, []);

  const handleStreamScroll = useCallback(() => {
    const el = streamScrollRef.current;
    if (!el) return;
    streamPinnedToBottomRef.current = streamScrollNearBottom(el);
  }, [streamScrollNearBottom]);

  /* 新一轮生成开始：恢复「跟随底部」 */
  useEffect(() => {
    if (aiTyping && !prevAiTypingRef.current) {
      streamPinnedToBottomRef.current = true;
    }
    prevAiTypingRef.current = aiTyping;
  }, [aiTyping]);

  /* 展开 Dock、新消息、流式更新：仅在贴底时滚到底；单次赋值，避免每条 token 上双 rAF+多定时器抢主线程 */
  useLayoutEffect(() => {
    const prevTab = prevTabForWorkbenchScrollRef.current;
    prevTabForWorkbenchScrollRef.current = activeTab;
    const returnedToDashboard =
      chatExpanded
      && activeTab === 'dashboard'
      && prevTab !== null
      && prevTab !== 'dashboard';

    const justOpened = chatExpanded && !prevChatExpandedRef.current;
    prevChatExpandedRef.current = chatExpanded;

    if (!chatExpanded) return;

    if (justOpened || returnedToDashboard) {
      streamPinnedToBottomRef.current = true;
    }

    const len = chatMessages.length;
    if (len > prevChatLenRef.current) {
      streamPinnedToBottomRef.current = true;
    }
    prevChatLenRef.current = len;

    if (!streamPinnedToBottomRef.current) return;

    const el = streamScrollRef.current;
    if (!el) return;

    el.scrollTop = el.scrollHeight;
  }, [activeTab, chatExpanded, chatMessages, aiTyping, showAllMessages]);

  /* 图片等异步撑高时，若仍在贴底则跟随到底部 */
  useEffect(() => {
    if (!chatExpanded || typeof ResizeObserver === 'undefined') return;
    const el = streamScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!streamPinnedToBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [chatExpanded]);

  /* OpenClaw Socket.IO connection */
  useEffect(() => {
    const shouldConnectOpenclawSocket = Boolean(currentDevice && (chatExpanded || (activeTab === 'openclaw' && dockOcMode)));
    if (!shouldConnectOpenclawSocket) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setOpenclawConnected(false);
      }
      return;
    }
    const connectedDeviceId = currentDevice?.id;
    if (!connectedDeviceId) return;

    const socket = io(resolveSocketUrl(), socketIoClientOptions);
    socketRef.current = socket;

    socket.on('connect', () => {
      setOpenclawConnected(false);
      socket.emit('openclaw:start', { deviceId: connectedDeviceId });
    });

    socket.on('openclaw:ready', () => {
      setOpenclawConnected(true);
    });

    // 板端 OpenClaw 状态仅用于能力可用性展示，不直接写入聊天消息
    socket.on('openclaw:data', () => {});
    socket.on('openclaw:complete', () => {});
    socket.on('openclaw:error', (data: { error: string }) => {
      if (/not connected/i.test(data.error || '')) {
        socket.emit('openclaw:start', { deviceId: connectedDeviceId });
      }
    });

    socket.on('openclaw:disconnected', () => {
      setOpenclawConnected(false);
      setAiTyping(false);
    });

    socket.on('rdkclaw:notify', (data: Record<string, unknown>) => {
      window.dispatchEvent(new CustomEvent('rdkclaw-notify', { detail: data }));
    });

    socket.on('disconnect', () => {
      setOpenclawConnected(false);
    });

    socket.on('connect_error', () => {
      setOpenclawConnected(false);
      setAiTyping(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setOpenclawConnected(false);
    };
  }, [activeTab, chatExpanded, currentDevice, dockOcMode, setOpenclawConnected]);

  type QuickPrompt = { id: string; icon: string; label: string; text: string; placeholder?: string; forceRdkclaw?: boolean };
  const promptsByTab = useMemo((): Record<string, QuickPrompt[]> => {
    return {
    /** 工作台快捷条在组件内单独渲染（主操作 +「更多」+ 未连接时的引导） */
    dashboard: [],
    terminal: [
      { id: 'cmd', icon: '⌨️', label: t('dock.quick.term.cmd.label', '帮我写命令'), text: t('dock.quick.term.cmd.text', '我想做什么操作，帮我生成终端命令') },
      { id: 'err', icon: '🔍', label: t('dock.quick.term.err.label', '分析输出'), text: t('dock.quick.term.err.text', '帮我分析终端最近的输出，定位问题并给修复建议') },
      { id: 'nl', icon: '💬', label: t('dock.quick.term.nl.label', '自然语言执行'), text: t('dock.quick.term.nl.text', '查看当前设备温度和BPU负载') },
    ],
    flasher: [
      { id: 'pick', icon: '💿', label: t('dock.quick.flash.pick.label', '选镜像'), text: t('dock.quick.flash.pick.text', '帮我推荐适合当前开发板的系统镜像版本') },
      { id: 'check', icon: '✅', label: t('dock.quick.flash.check.label', '烧录前检查'), text: t('dock.quick.flash.check.text', '帮我确认烧录前的准备工作是否就绪') },
    ],
    files: [
      { id: 'sync', icon: '📁', label: t('dock.quick.files.sync.label', '同步文件'), text: t('dock.quick.files.sync.text', '帮我把本地模型文件同步到设备 /userdata/models') },
      { id: 'log', icon: '📋', label: t('dock.quick.files.log.label', '拉取日志'), text: t('dock.quick.files.log.text', '从设备下载最新的系统日志到本地') },
    ],
    ide: [
      { id: 'edit', icon: '✏️', label: t('dock.quick.ide.edit.label', '代码补全'), text: t('dock.quick.ide.edit.text', '帮我分析当前打开的文件，给出优化建议') },
      { id: 'run', icon: '▶️', label: t('dock.quick.ide.run.label', '运行脚本'), text: t('dock.quick.ide.run.text', '在终端中运行当前编辑的脚本文件') },
      { id: 'fmt', icon: '🧹', label: t('dock.quick.ide.fmt.label', '格式化'), text: t('dock.quick.ide.fmt.text', '帮我格式化当前文件并检查语法错误') },
    ],
    vnc: [
      { id: 'opt', icon: '🖥️', label: t('dock.quick.vnc.opt.label', '优化画质'), text: t('dock.quick.vnc.opt.text', '根据当前网络状况帮我调整VNC画质参数') },
      { id: 'vnc-start', icon: '🔌', label: t('dock.quick.vnc.start.label', '启动VNC'), text: t('dock.quick.vnc.start.text', '帮我在设备上启动VNC服务并连接') },
    ],
    hardware: [
      { id: 'hot', icon: '🌡️', label: t('dock.quick.hw.hot.label', '散热建议'), text: t('dock.quick.hw.hot.text', '芯片温度偏高，帮我分析原因并给出降温方案') },
      { id: 'perf', icon: '⚡', label: t('dock.quick.hw.perf.label', '性能优化'), text: t('dock.quick.hw.perf.text', '帮我分析当前 BPU/CPU 使用情况，给出优化建议') },
    ],
    openclaw: [
      {
        id: 'oc-vs-rdk',
        icon: '🧭',
        label: t('dock.quick.oc.vs.label', '双引擎能力'),
        text: t('dock.quick.oc.vs.text', '请分别汇报 RDKClaw 与 OpenClaw 各自适合做什么，并给我一个建议：当前任务更该用哪一个，为什么。'),
        forceRdkclaw: true,
      },
      { id: 'oc-health', icon: '🩺', label: t('dock.quick.oc.health.label', '网关健康检查'), text: t('dock.quick.oc.health.text', '请先检查当前网关状态并给出一条结论') },
      { id: 'oc-cap', icon: '🧩', label: t('dock.quick.oc.cap.label', '能力总览'), text: t('dock.quick.oc.cap.text', '帮我总结当前设备可用的 OpenClaw 能力') },
      { id: 'oc-diag', icon: '🔧', label: t('dock.quick.oc.diag.label', '诊断修复'), text: t('dock.quick.oc.diag.text', '帮我诊断为什么会连接失败，并给修复命令') },
    ],
    };
  }, [t]);
  const defaultPrompts = useMemo<QuickPrompt[]>(() => [
    { id: 'diag', icon: '🔍', label: t('dock.quick.def.diag.label', '分析异常日志'), text: t('dock.quick.def.diag.text', '请结合终端最近输出，帮我定位异常并给出修复步骤') },
    { id: 'hw', icon: '🌡️', label: t('dock.quick.def.hw.label', '硬件状态'), text: t('dock.quick.def.hw.text', '检查当前设备的 BPU 负载和芯片温度') },
    { id: 'plan', icon: '📋', label: t('dock.quick.def.plan.label', '执行计划'), text: t('dock.quick.def.plan.text', '把当前需求拆成 3 步并立即开始执行第一步') },
  ], [t]);
  /** 工作台底栏：全部快捷指令平铺，横向滚动（不再使用「更多」下拉） */
  const dashboardDockChips = useMemo((): QuickPrompt[] => {
    return [
      { id: 'intro', icon: '🧭', label: t('dock.quick.dash.intro.label', '介绍 RDK Studio'), text: t('dock.quick.dash.intro.text', '介绍一下 RDK Studio 和 RDKClaw 能做什么，先给我一个快速上手路径。'), forceRdkclaw: true },
      { id: 'diag', icon: '🩺', label: t('dock.quick.dash.diag.label', '设备体检'), text: t('dock.quick.dash.diag.text', '帮我做一次设备体检：温度、CPU/BPU、内存、磁盘、网络和关键服务状态。') },
      {
        id: 'yolo',
        icon: '🎯',
        label: t('dock.quick.dash.yolo.label', '运行 YOLO 示例'),
        text: t('dock.quick.dash.yolo.text', '在当前设备上跑一个 YOLO 示例，给出步骤、命令和预期输出。'),
        forceRdkclaw: true,
      },
    ];
  }, [t]);
  const effectiveTab = embedDockCtxTab
    ? (embedDockCtxTab === 'openclaw' && !dockOcMode ? '_rdkclaw_fallback' : embedDockCtxTab)
    : ((activeTab === 'openclaw' && !dockOcMode) ? '_rdkclaw_fallback' : activeTab);
  const quickPrompts = useMemo(() => {
    if (effectiveTab === 'dashboard') return [];
    return promptsByTab[effectiveTab] ?? defaultPrompts;
  }, [effectiveTab, promptsByTab, defaultPrompts]);
  const deviceOnline = Boolean(currentDevice && isDeviceShownOnline(currentDevice));

  const isFlasherTab = activeTab === 'flasher';
  const isSubpageTab = activeTab !== 'dashboard';
  /** 「子页隐藏 Dock」不应用于 AI 对话 Hub：右侧主区仅靠 portal 挂载对话，隐藏后只剩空锚点，用户会误以为会话丢失 */
  const shouldHideDock = isSubpageTab && hideDockInSubpage && activeTab !== 'ai-chat-hub';
  const hubDockEmbedded =
    !rdkEmbedPanel
    && activeTab === 'ai-chat-hub'
    && chatExpanded
    && !workspaceMode
    && hubAnchorEl != null;
  const useAgentColumnFlow = agentTurnLayout && !hubDockEmbedded;
  const useSubpageCompact = chatExpanded && isSubpageTab && !workspaceMode && !hubDockEmbedded;

  const submitQuickPrompt = (text: string, placeholder?: string, forceRdkclaw?: boolean) => {
    if (!text && placeholder) {
      setCmd('');
      requestAnimationFrame(() => {
        const input = document.querySelector('.dock-input input, .dock-input textarea') as HTMLInputElement | null;
        if (input) {
          input.placeholder = placeholder;
          input.focus();
        }
      });
      return;
    }
    if (!forceRdkclaw && activeTab === 'openclaw' && dockOcMode && openclawSendMessage) {
      openclawSendMessage(text);
      return;
    }
    const commandText = forceRdkclaw ? `/ai ${text}` : text;
    setCmd(commandText);
    requestAnimationFrame(() => {
      const form = document.querySelector('.dock-form') as HTMLFormElement;
      form?.requestSubmit();
    });
  };

  // 说明：用户输入统一走 RDK Studio Claw 主链路（/api/agent/chat）
  // 板端 OpenClaw 仅作为 RDK Studio Claw 在服务端可调用的能力，不在前端直连对话

  const handleUnifiedCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawText = cmd.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if (!rawText && !hasAttachments) return;

    if (!hasAttachments && rawText) {
      const langNext = parseUiLanguageCommand(rawText);
      if (langNext) {
        setLanguage(langNext);
        addToast(t('chat.lang.switched', '已切换界面语言'), 'success');
        setCmd('');
        return;
      }
    }

    if (activeTab === 'openclaw' && dockOcMode && openclawSendMessage && rawText && !rawText.startsWith('/ai ')) {
      openclawSendMessage(rawText);
      setCmd('');
      return;
    }

    const aiForced = rawText.match(/^\/ai\s+([\s\S]+)/i);
    if (aiForced) {
      const next = aiForced[1].trim();
      if (!next && !hasAttachments) return;
    }

    try {
      const requestText = aiForced ? aiForced[1].trim() : rawText;
      const attachmentPayloads = hasAttachments
        ? await materializeAgentAttachments(pendingAttachments)
        : [];
      const displayAttachments = hasAttachments
        ? await buildDisplayAttachmentsFromPending(pendingAttachments)
        : [];
      handleCommand(e, {
        messageOverride: requestText,
        attachments: attachmentPayloads,
        displayAttachments,
      });
      setPendingAttachments([]);
      setRecordingTranscript('');
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('dock.attach.processFail', '附件处理失败，请重试'), 'error');
    }
  };

  const closeDock = () => {
    if (rdkEmbedPanel) {
      window.close();
      return;
    }
    setChatExpanded(false);
    setWorkspaceMode(false);
    setShowAllMessages(false);
  };

  const toggleSubpageDockVisibility = () => {
    if (!isSubpageTab) return;
    setHideDockInSubpage((prev) => {
      const next = !prev;
      if (next) {
        setChatExpanded(false);
        setWorkspaceMode(false);
        setShowSuggestions(false);
      }
      return next;
    });
  };

  const renderDockStreamMessageBubble = (
    msg: ChatMessage,
    msgIndex: number,
    variant: 'classic' | 'agent-user' | 'agent-ai',
  ) => {
    const channelClass = msg.channelMeta?.channel ? ` ch-${msg.channelMeta.channel}` : '';
    const directionClass = msg.channelMeta?.direction ? ` dir-${msg.channelMeta.direction}` : '';
    const isStreamingBubble =
      aiTyping
      && msg.role === 'ai'
      && msgIndex === visibleMessages.length - 1;
    const useSlotLayout = Boolean(msg.contentSlots?.length && msg.blocks?.length);
    const stripProcessForMinimal = minimalResultMode && !isStreamingBubble;
    const slotsToRender =
      useSlotLayout && msg.blocks && stripProcessForMinimal
        ? filterContentSlotsMinimal(msg.contentSlots!, msg.blocks)
        : msg.contentSlots;
    const variantClass =
      variant === 'agent-user' ? ' dock-msg--agent-query' :
      variant === 'agent-ai' ? ' dock-msg--agent-ai' : '';
    const blockPresentation: 'default' | 'agent-footprint' =
      variant === 'agent-ai' ? 'agent-footprint' : 'default';
    return (
    <div className={`dock-msg ${msg.role}${channelClass}${directionClass}${variantClass}`}>
      <div className={`dock-avatar ${msg.role}`}>
        {msg.role === 'ai'
          ? <img src={rdkclawAvatarUrl} alt="" className="dock-avatar-img" />
          : msg.channelMeta?.channel === 'feishu'
            ? t('dock.channel.short.feishu', '飞')
            : msg.channelMeta?.channel === 'weixin'
              ? t('dock.channel.short.weixin', '微')
              : <img src={userAvatarUrl} alt="" className="dock-avatar-img" />}
      </div>
      <div
        className={`dock-bubble ${msg.role}`}
        lang={msg.role === 'ai' ? (isEn ? 'en' : 'zh-CN') : undefined}
      >
        {msg.channelMeta && (
          <div className="dock-channel-badge">
            {msg.channelMeta.channel === 'feishu'
              ? t('dock.channel.feishu', '飞书')
              : msg.channelMeta.channel === 'weixin'
                ? t('dock.channel.weixin', '微信')
                : msg.channelMeta.channel}
            {msg.channelMeta.direction === 'inbound'
              ? t('dock.channel.inbound', ' · 来信')
              : msg.channelMeta.direction === 'outbound'
                ? t('dock.channel.outbound', ' · 回复')
                : ''}
          </div>
        )}
        {(() => {
          const plain = chatMessageToPlainText(msg, t);
          if (!plain) return null;
          return (
            <div className="dock-bubble-toolbar">
              <button
                type="button"
                className="dock-bubble-copy"
                title={t('dock.tt.copyMessage', '复制文字')}
                aria-label={t('dock.tt.copyMessage', '复制文字')}
                onClick={() => {
                  void copyDockPlainText(plain).then((ok) => {
                    addToast(
                      ok ? t('dock.bubble.copyToastOk', '已复制到剪贴板') : t('dock.bubble.copyToastFail', '复制失败，可尝试用鼠标拖选文字'),
                      ok ? 'success' : 'warning',
                    );
                  });
                }}
              >
                <Copy size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
          );
        })()}
        {msg.attachments && msg.attachments.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {msg.attachments.map(att => (
              <AttachmentRenderer key={att.id} attachment={att} />
            ))}
          </div>
        )}
        {msg.role === 'user' && msg.text && (
          <p className="msg-text">{msg.text}</p>
        )}
        {msg.role === 'ai' && (
          <>
            {slotsToRender && slotsToRender.length > 0 && msg.blocks
              ? (
                <>
                  {slotsToRender.map((slot, i) => {
                    const lastSlot = i === slotsToRender.length - 1;
                    const blockProps = {
                      onConfirm: executeConfirm,
                      onDismiss: dismissConfirm,
                      onCancelTask: cancelRunningTask,
                      onApprovalAction: handleApprovalAction,
                      onRecommendationChoice: handleRecommendationChoice,
                      onSoulUpdateDecision: handleSoulUpdateDecision,
                      onContinueAgent: handleContinueAfterTurnLimit,
                      presentation: blockPresentation,
                    };
                    if (slot.kind === 'markdown') {
                      const { cleanText, mediaBlocks } = extractMediaFromText(slot.text || '');
                      const streamHere = Boolean(isStreamingBubble && lastSlot);
                      if (!cleanText && !streamHere && mediaBlocks.length === 0) return null;
                      return (
                        <Fragment key={`slot-md-${msg.id}-${i}`}>
                          {(streamHere || cleanText) && (
                            <div className={`msg-text${streamHere ? ' msg-text--streaming' : ''}`}>
                              {streamHere ? (
                                <DockStreamingPlainBody key={msg.id} text={cleanText} />
                              ) : cleanText ? (
                                renderMarkdown(cleanText, t('markdown.copy', '复制'))
                              ) : null}
                            </div>
                          )}
                          {mediaBlocks.map((mb, j) => (
                            <BlockRenderer key={`slot-md-${msg.id}-${i}-m-${j}`} block={mb} {...blockProps} />
                          ))}
                        </Fragment>
                      );
                    }
                    const block = (msg.blocks ?? [])[slot.index];
                    if (!block) return null;
                    return (
                      <BlockRenderer
                        key={`slot-b-${msg.id}-${i}-${slot.index}`}
                        block={block}
                        {...blockProps}
                      />
                    );
                  })}
                  {isStreamingBubble && (
                    <div
                      className={`dock-typing dock-typing--in-bubble${
                        msg.text?.trim() ? ' dock-typing--after-stream-text' : ''
                      }`}
                    >
                      {msg.text?.trim() ? (
                        <div className="typing-dots" aria-hidden>
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                        </div>
                      ) : null}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={stopCurrentRun}>
                        {t('dock.typing.stopCurrent', '结束当前')}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost btn-danger-ghost" onClick={stopAllRuns}>
                        {t('dock.typing.stopAll', '全部停止')}
                      </button>
                    </div>
                  )}
                </>
              )
              : (
                <>
                  {(stripProcessForMinimal
                    ? (msg.blocks ?? []).filter(isResultLikeDockBlock)
                    : (msg.blocks ?? [])
                  ).map((block, i) => (
                    <BlockRenderer
                      key={i}
                      block={block}
                      onConfirm={executeConfirm}
                      onDismiss={dismissConfirm}
                      onCancelTask={cancelRunningTask}
                      onApprovalAction={handleApprovalAction}
                      onRecommendationChoice={handleRecommendationChoice}
                      onSoulUpdateDecision={handleSoulUpdateDecision}
                      onContinueAgent={handleContinueAfterTurnLimit}
                      presentation={blockPresentation}
                    />
                  ))}
                  {(msg.text || isStreamingBubble) && (() => {
                    const { cleanText, mediaBlocks } = extractMediaFromText(msg.text || '');
                    return (
                      <>
                        {(isStreamingBubble || cleanText) && (
                          <div className={`msg-text${isStreamingBubble ? ' msg-text--streaming' : ''}`}>
                            {isStreamingBubble ? (
                              <DockStreamingPlainBody key={msg.id} text={cleanText} />
                            ) : cleanText ? (
                              renderMarkdown(cleanText, t('markdown.copy', '复制'))
                            ) : null}
                          </div>
                        )}
                        {mediaBlocks.map((mb, j) => (
                          <BlockRenderer
                            key={`extracted-media-${j}`}
                            block={mb}
                            onConfirm={executeConfirm}
                            onDismiss={dismissConfirm}
                            onCancelTask={cancelRunningTask}
                            onApprovalAction={handleApprovalAction}
                            onRecommendationChoice={handleRecommendationChoice}
                            onSoulUpdateDecision={handleSoulUpdateDecision}
                            onContinueAgent={handleContinueAfterTurnLimit}
                            presentation={blockPresentation}
                          />
                        ))}
                      </>
                    );
                  })()}
                  {isStreamingBubble && (
                    <div
                      className={`dock-typing dock-typing--in-bubble${
                        msg.text?.trim() ? ' dock-typing--after-stream-text' : ''
                      }`}
                    >
                      {msg.text?.trim() ? (
                        <div className="typing-dots" aria-hidden>
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                        </div>
                      ) : null}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={stopCurrentRun}>
                        {t('dock.typing.stopCurrent', '结束当前')}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost btn-danger-ghost" onClick={stopAllRuns}>
                        {t('dock.typing.stopAll', '全部停止')}
                      </button>
                    </div>
                  )}
                </>
              )}
          </>
        )}
        {msg.action && (
          <button className="chat-action-btn" onClick={() => setActiveTab(msg.action!.tab)}>
            {msg.action.label} →
          </button>
        )}
        {msg.role === 'ai' && (
          <div className="dock-msg-footer">
            {(!minimalResultMode || isStreamingBubble) && (
            <span className="dock-msg-time">
              {isStreamingBubble
                ? t('dock.msg.replying', '回复中…')
                : msg.durationMs != null
                  ? `${t('dock.msg.took', '用时')} ${formatDockDurationMs(msg.durationMs)}`
                  : t('dock.msg.durationUnknown', '—')}
            </span>
            )}
            {(() => {
              if (isStreamingBubble || msg.channelMeta) return null;
              const prevUserForRetry = findPreviousStudioUserMessage(chatMessages, msg.id);
              if (!prevUserForRetry) return null;
              return (
                <div className="dock-msg-footer-actions">
                  {prevUserForRetry && (
                    <button
                      type="button"
                      className="dock-bubble-retry dock-bubble-retry--primary"
                      disabled={aiTyping}
                      title={
                        aiTyping
                          ? t('dock.tt.waitReply', '请等待当前回复结束')
                          : t(
                              'dock.tt.regenerate',
                              '用同一条用户消息重试：移除本则助手回复及之后的对话气泡，并同步服务端会话（类似 Gemini 重新生成）',
                            )
                      }
                      onClick={() => void runRegenerate(msg.id)}
                    >
                      {t('dock.msg.retry', '重试')}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
    );
  };

  if (shouldHideDock) {
    return (
      <button
        type="button"
        className="dock-restore-btn"
        title={t('dock.tt.restoreDock', '显示对话栏')}
        onClick={() => setHideDockInSubpage(false)}
      >
        {t('dock.restore', '显示 AI Dock')}
      </button>
    );
  }

  const dockInner = (
    <div
      className={`dock ${chatExpanded ? 'expanded' : ''} ${workspaceMode ? 'workspace' : ''} ${useSubpageCompact ? 'subpage-compact' : ''} ${hubDockEmbedded ? 'dock--hub-embedded' : ''}`}
    >
      {/* ── Chat panel (expanded) ── */}
      {chatExpanded && (
        <div className="dock-chat">
          <div className="dock-header">
            <div className="dock-header-left">
              <div className="dock-header-title-wrap">
                <span className="dock-header-title">RDKClaw</span>
                {dockThreadTitleLine ? (
                  <span className="dock-header-threadline" title={dockThreadTitleLine}>
                    {dockThreadTitleLine}
                  </span>
                ) : null}
                <span className="dock-header-subtitle" title={activeRdkclawDeviceLabel}>
                  {t('dock.device.current', '当前设备')}: {activeRdkclawDeviceLabel}
                </span>
              </div>
              <div className="dock-header-badges">
                <span className={`badge ${agentExecution.lastError ? 'badge-danger' : 'badge-accent'}`}>
                  {agentExecution.lastError ? 'Error' : 'ON'}
                </span>
                <span className={`badge ${openclawConnected ? 'badge-ok' : 'badge-muted'}`}>
                  {openclawConnected ? 'OpenClaw' : 'Offline'}
                </span>
              </div>
            </div>
            <div className="dock-header-right">
              <div
                className="dock-header-toolbar dock-header-toolbar--chatlike"
                role="toolbar"
                aria-label={t('dock.header.toolbarAria', '对话与运行工具')}
              >
                <div className="dock-header-tool-cluster">
                  {taskHistory.length > 0 && (
                    <button
                      type="button"
                      className={`dock-header-toolbtn${showTaskPanel ? ' is-active' : ''}`}
                      onClick={() => setShowTaskPanel(!showTaskPanel)}
                      title={t('dock.tt.tasks', '后台任务')}
                      aria-label={t('dock.header.tasks', '任务')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                      </svg>
                      <span className="dock-header-toolbtn-label">{t('dock.header.tasks', '任务')}</span>
                    </button>
                  )}
                </div>

                <div className="dock-header-tool-cluster dock-header-tool-cluster--utility">
                  {!rdkEmbedPanel && activeTab === 'openclaw' && (
                    <button
                      type="button"
                      className="dock-header-toolbtn"
                      onClick={() => openOpenClawPopout()}
                      title={t('dock.tt.popoutOc', '新窗口打开 OpenClaw')}
                      aria-label={t('dock.header.popoutOpenclaw', '新窗口打开 OpenClaw')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M9 9h6v6H9z" />
                      </svg>
                      <span className="dock-header-toolbtn-label">{t('dock.header.popoutShort', '弹窗')}</span>
                    </button>
                  )}
                  {isSubpageTab && !hubDockEmbedded && (
                    <button
                      type="button"
                      className="dock-header-toolbtn"
                      onClick={toggleSubpageDockVisibility}
                      title={t('dock.tt.hideDock', '隐藏对话栏')}
                      aria-label={t('dock.header.hideDock', '隐藏 AI Dock')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M17.94 17.94A10.94 10.94 0 0112 20C7 20 2.73 16.11 1 12c.67-1.6 1.76-3.07 3.06-4.32" />
                        <path d="M9.9 4.24A10.94 10.94 0 0112 4c5 0 9.27 3.89 11 8a11.8 11.8 0 01-4.17 5.94" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                      <span className="dock-header-toolbtn-label">{t('dock.header.hideShort', '隐藏')}</span>
                    </button>
                  )}
                </div>

                {!hubDockEmbedded && (
                  <button
                    type="button"
                    className="dock-header-newchat"
                    onClick={() => void beginNewChat()}
                    title={t('dock.tt.newChat', '新对话')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span>{t('dock.header.newChat', '新对话')}</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                className="dock-header-close btn-icon"
                onClick={closeDock}
                title={t('dock.tt.closePanel', '关闭')}
                aria-label={t('dock.task.closeTitle', '关闭')}
              >
                {Icon.close}
              </button>
            </div>
          </div>

          {/* Task panel */}
          {showTaskPanel && (
            <div className="dock-tasks">
              {taskHistory.map(task => (
                <div key={task.id} className="dock-task-item">
                  <span className={`dock-task-dot ${task.status}`} />
                  <span className="dock-task-label">{getCapabilityDisplayLabel(task.capabilityId, isEn)}</span>
                  <span className="dock-task-status">
                    {task.status === 'running'
                      ? t('dock.task.status.running', '执行中')
                      : task.status === 'done'
                        ? t('dock.task.status.done', '完成')
                        : task.status === 'failed'
                          ? t('dock.task.status.failed', '失败')
                          : t('dock.task.status.pending', '等待')}
                  </span>
                  {task.status === 'running' && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancelRunningTask(task.id)}>{t('dock.task.cancel', '取消')}</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Chat stream */}
          <div
            className={`dock-stream dock-stream--stream-flow${useAgentColumnFlow ? ' dock-stream--agent-flow' : ''}`}
            ref={streamScrollRef}
            onScroll={handleStreamScroll}
          >
            {chatMessages.length === 0 && !aiTyping && (
              <div className="dock-empty-hint">{t('dock.empty.cleared', '聊天已清空，输入新消息即可继续。')}</div>
            )}
            {!showAllMessages && hiddenCount > 0 && (
              <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'center' }} onClick={() => setShowAllMessages(true)}>
                {fillTemplate(t('dock.moreHistory', '查看更早 {{n}} 条'), { n: hiddenCount })}
              </button>
            )}

            {useAgentColumnFlow
              ? dockTurnEntries.map((turn) => {
                if (turn.kind === 'pair') {
                  const userIdx = visibleMessages.indexOf(turn.user);
                  const aiIdx = visibleMessages.indexOf(turn.ai);
                  return (
                    <div key={`turn-${turn.user.id}`} className="dock-turn dock-turn--agent">
                      <div className="dock-turn-query dock-turn-query--sticky">
                        {renderDockStreamMessageBubble(turn.user, userIdx, 'agent-user')}
                      </div>
                      <div className="dock-turn-answer">
                        {renderDockStreamMessageBubble(turn.ai, aiIdx, 'agent-ai')}
                      </div>
                    </div>
                  );
                }
                if (turn.kind === 'user-only') {
                  const userIdx = visibleMessages.indexOf(turn.user);
                  return (
                    <div key={`turn-${turn.user.id}`} className="dock-turn dock-turn--agent">
                      <div className="dock-turn-query dock-turn-query--sticky">
                        {renderDockStreamMessageBubble(turn.user, userIdx, 'agent-user')}
                      </div>
                      <div className="dock-turn-answer dock-turn-answer--pending" aria-hidden />
                    </div>
                  );
                }
                const aiIdx = visibleMessages.indexOf(turn.ai);
                return (
                  <div key={`orphan-ai-${turn.ai.id}`} className="dock-turn dock-turn--agent">
                    {renderDockStreamMessageBubble(turn.ai, aiIdx, 'agent-ai')}
                  </div>
                );
              })
              : visibleMessages.map((msg, msgIndex) => (
                <Fragment key={msg.id}>
                  {renderDockStreamMessageBubble(msg, msgIndex, 'classic')}
                </Fragment>
              ))}

            {aiTyping && !streamMergedIntoLastAiBubble && (
              <div className={`dock-msg ai${useAgentColumnFlow ? ' dock-msg--agent-ai' : ''}`}>
                <div className="dock-avatar ai">
                  <img src={rdkclawAvatarUrl} alt="" className="dock-avatar-img" />
                </div>
                <div className="dock-bubble ai">
                  <div className="dock-typing">
                    <div className="typing-dots"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={stopCurrentRun}>{t('dock.typing.stopCurrent', '结束当前')}</button>
                    <button type="button" className="btn btn-sm btn-ghost btn-danger-ghost" onClick={stopAllRuns}>{t('dock.typing.stopAll', '全部停止')}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Suggestions (idle) */}
      {showSuggestions && !chatExpanded && !mentionMenuActive && filteredSuggestions.length > 0 && (
        <div className="dock-suggestions" style={{ position: 'relative' }}>
          {filteredSuggestions.slice(0, 3).map((s, i) => (
            <div key={i} className="dock-suggestion-item" onMouseDown={() => { setCmd(s.text); setShowSuggestions(false); }}>
              {s.text}
            </div>
          ))}
        </div>
      )}

      {/* ── Input area ── */}
      <div
        className={`dock-input-area${dragOverInput ? ' dock-input-drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
      >
        {mentionMenuActive && (
          <div className="dock-mention-menu" role="listbox" aria-label={t('dock.mention.aria', '调用能力')}>
            {filteredMentionCaps.length === 0 ? (
              <div className="dock-mention-empty">{t('dock.mention.empty', '无匹配能力')}</div>
            ) : (
              filteredMentionCaps.map((cap, i) => (
                <div
                  key={cap.id}
                  role="option"
                  aria-selected={i === mentionHighlightIdx}
                  className={`dock-mention-item ${i === mentionHighlightIdx ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMentionCapability(cap.id);
                  }}
                  onMouseEnter={() => setMentionHighlightIdx(i)}
                >
                  <span className="dock-mention-icon">{cap.id === 'flash' ? Icon.flash : Icon.spark}</span>
                  <span className="dock-mention-label">{isEn ? cap.labelEn : cap.labelZh}</span>
                </div>
              ))
            )}
          </div>
        )}

        {pendingAttachments.length > 0 && (
          <div className="dock-attachments">
            {pendingAttachments.map(att => (
              <div key={att.id} className={`dock-att-item${att.type === 'audio' && (att.sttPending || att.sttError || att.transcript) ? ' dock-att-item-col' : ''}`}>
                <div className="dock-att-item-row">
                  {att.type === 'image' && att.url && <img src={att.url} alt="" />}
                  {att.type === 'video' && att.url && <video src={att.url} muted preload="metadata" style={{ maxHeight: 48, maxWidth: 80, borderRadius: 4 }} />}
                  {att.type === 'audio' && <span className="dock-att-icon">🎙️</span>}
                  {att.type === 'file' && <span className="dock-att-icon">{getAttachmentIcon(att.name, att.mimeType)}</span>}
                  <span className="truncate">{att.name}</span>
                  {att.size !== undefined && <span className="dock-att-size">{att.size < 1024 ? `${att.size}B` : att.size < 1048576 ? `${(att.size / 1024).toFixed(0)}KB` : `${(att.size / 1048576).toFixed(1)}MB`}</span>}
                  <button type="button" className="dock-att-remove" onClick={() => removeAttachment(att.id)}>{Icon.close}</button>
                </div>
                {att.type === 'audio' && att.sttPending && (
                  <div className="dock-att-stt dock-att-stt-muted">{t('dock.voice.sttWorking', '正在转写…')}</div>
                )}
                {att.type === 'audio' && !att.sttPending && att.sttError && (
                  <div className="dock-att-stt dock-att-stt-warn" title={att.sttError}>{att.sttError}</div>
                )}
                {att.type === 'audio' && !att.sttPending && !att.sttError && att.transcript && (
                  <div className="dock-att-stt">{t('dock.attach.transcriptPrefix', '转写：')}{att.transcript}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {STUDIO_ENABLE_VOICE_TO_TEXT && isRecording && recordingTranscript && (
          <div className="dock-attachments">
            <div className="dock-att-item">
              <span className="truncate">{t('dock.voice.recognizing', '识别中：')}{recordingTranscript}</span>
            </div>
          </div>
        )}

        <form className="dock-form dock-input" onSubmit={handleUnifiedCommand}>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple title={t('dock.tt.addFiles', '添加文件')} className="sr-only" />

          <div className="dock-form-actions">
            <button type="button" className="dock-action-btn" onClick={handleFilePick} title={t('dock.tt.attach', '添加附件')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            {STUDIO_ENABLE_VOICE_TO_TEXT && (
              <button
                type="button"
                className={`dock-action-btn ${isRecording ? 'recording' : ''}`}
                disabled={voiceSttLoading}
                onClick={toggleVoiceRecord}
                title={
                  (isRecording
                    ? `${t('dock.tt.stopVoice', '停止录音')} ${recordingElapsed}s / ${VOICE_MAX_SECONDS}s`
                    : t('dock.tt.voice', '语音输入'))
                  + (isRecording ? '' : `${voiceMicTitleSuffix}${RDK_DISABLE_BROWSER_SPEECH ? ` · ${t('dock.voice.noBrowserSr', '未使用浏览器联网识别')}` : ''}`)
                  + (voiceSttLoading ? ` · ${t('dock.voice.sttPlaceholder', '语音转文字中…')}` : '')
                }
              >
                {isRecording ? (
                  <span className="dock-mic-recording-indicator">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
                    </svg>
                    <span className="dock-mic-timer">{recordingElapsed}s</span>
                  </span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
                  </svg>
                )}
              </button>
            )}
          </div>

          <input
            type="text"
            className="dock-cmd-input"
            placeholder={
              STUDIO_ENABLE_VOICE_TO_TEXT && voiceSttLoading
                ? t('dock.voice.sttPlaceholder', '语音转文字中…')
                : activeTab === 'openclaw' && dockOcMode && openclawSendMessage
                  ? t('dock.input.openclaw', '向 OpenClaw Agent 发送消息...')
                  : t('dock.input.default', '消息、指令或拖拽文件...')
            }
            disabled={STUDIO_ENABLE_VOICE_TO_TEXT && voiceSttLoading}
            ref={chatInputRef}
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onPaste={handlePaste}
            onContextMenu={(e) => {
              e.preventDefault();
              setInputContextMenu({ x: e.clientX, y: e.clientY });
            }}
            onFocus={() => {
              setInputFocused(true);
              if (!chatExpanded && !parseTrailingAtMention(cmd)) setShowSuggestions(true);
            }}
            onBlur={() => { setInputFocused(false); window.setTimeout(() => setShowSuggestions(false), 200); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && chatExpanded) {
                closeDock();
                e.preventDefault();
                return;
              }
              if (mentionMenuActive && filteredMentionCaps.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionHighlightIdx((h) => (h + 1) % filteredMentionCaps.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionHighlightIdx((h) => (h - 1 + filteredMentionCaps.length) % filteredMentionCaps.length);
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const cap = filteredMentionCaps[mentionHighlightIdx];
                  if (cap) pickMentionCapability(cap.id);
                  return;
                }
              }
              if (mentionMenuActive && e.key === 'Escape') {
                e.preventDefault();
                if (mentionParse) setCmd(cmd.slice(0, mentionParse.atIndex));
              }
            }}
          />

          {(cmd.trim() || aiTyping) && (
            <div className="dock-form-actions" role="group" aria-label={t('dock.input.inputBarActions', '输入栏：停止任务与清空')}>
              <button
                type="button"
                className="dock-action-btn dock-action-btn--stop-all"
                onClick={() => { void stopAllRuns(); }}
                title={t('dock.tt.stopAll', '停止进行中的任务')}
                aria-label={t('dock.typing.stopAll', '全部停止')}
              >
                {Icon.stopAll}
              </button>
              {cmd.trim() ? (
                <button type="button" className="dock-action-btn" onClick={() => setCmd('')} title={t('dock.tt.clearInput', '清空输入')}>
                  {Icon.close}
                </button>
              ) : null}
            </div>
          )}
          {!chatExpanded && (
            <button
              type="button"
              className="dock-action-btn"
              onClick={() => setChatExpanded(true)}
              title={t('dock.tt.expandChat', '展开对话')}
            >
              {Icon.expand}
            </button>
          )}
          {isSubpageTab && (
            <button
              type="button"
              className="dock-action-btn"
              onClick={toggleSubpageDockVisibility}
              title={t('dock.tt.hideDock', '隐藏对话栏')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.94 10.94 0 0112 20C7 20 2.73 16.11 1 12c.67-1.6 1.76-3.07 3.06-4.32"/>
                <path d="M9.9 4.24A10.94 10.94 0 0112 4c5 0 9.27 3.89 11 8a11.8 11.8 0 01-4.17 5.94"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          )}
          <button type="submit" className={`dock-send-btn ${cmd.trim() || pendingAttachments.length > 0 ? 'ready' : ''}`} disabled={!cmd.trim() && pendingAttachments.length === 0 && !aiTyping} title={t('dock.tt.send', '发送')}>
            {Icon.send}
          </button>
        </form>

        {inputContextMenu && (
          <div
            className="dock-input-context-menu"
            style={{ left: inputContextMenu.x, top: inputContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={() => { void executeInputCommand('cut'); setInputContextMenu(null); }}>{t('dock.ctx.cut', '剪切')}</button>
            <button type="button" onClick={() => { void executeInputCommand('copy'); setInputContextMenu(null); }}>{t('dock.ctx.copy', '复制')}</button>
            <button type="button" onClick={() => { void executeInputCommand('paste'); setInputContextMenu(null); }}>{t('dock.ctx.paste', '粘贴')}</button>
            <button type="button" onClick={() => { void executeInputCommand('selectAll'); setInputContextMenu(null); }}>{t('dock.ctx.selectAll', '全选')}</button>
          </div>
        )}

        {(devices.length > 1 || channelStats.feishuTotal > 0 || channelStats.weixinTotal > 0) && (
          <div className="dock-status-strip">
            {devices.length > 1 && (
              <div className="dock-device-strip" role="tablist" aria-label={t('dock.strip.aria.devices', 'AI 设备窗口')}>
                {devices.map((device) => (
                  <button
                    key={device.id}
                    type="button"
                    role="tab"
                    aria-selected={activeDevice === device.id}
                    className={`dock-device-chip ${activeDevice === device.id ? 'active' : ''}`}
                    onClick={() => setActiveDevice(device.id)}
                    title={`${device.name} · ${device.ip}`}
                  >
                    {device.name}
                  </button>
                ))}
              </div>
            )}
            {(channelStats.feishuTotal > 0 || channelStats.weixinTotal > 0) && (
              <div className="dock-channel-strip" aria-label={t('dock.strip.aria.channels', '渠道消息概览')}>
                {channelStats.feishuTotal > 0 && (
                  <span className="dock-channel-chip" title={t('dock.tt.feishuInbox', '飞书收件')}>
                    {channelStats.feishuInbound > 0
                      ? tfDock('dock.strip.feishuInbound', '飞书 来信 {{n}}', { n: channelStats.feishuInbound })
                      : tfDock('dock.strip.feishuTotal', '飞书 消息 {{n}}', { n: channelStats.feishuTotal })}
                  </span>
                )}
                {channelStats.weixinTotal > 0 && (
                  <span className="dock-channel-chip" title={t('dock.tt.weixinInbox', '微信收件')}>
                    {channelStats.weixinInbound > 0
                      ? tfDock('dock.strip.weixinInbound', '微信 来信 {{n}}', { n: channelStats.weixinInbound })
                      : tfDock('dock.strip.weixinTotal', '微信 消息 {{n}}', { n: channelStats.weixinTotal })}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Context strip (AI Native) */}
        <div className="dock-context-strip">
          <div className="dock-context-strip-lead">
            <div className="dock-response-mode-wrap" ref={responseModeMenuRef}>
              <button
                type="button"
                className={`dock-response-mode-trigger ${responseModeMenuOpen ? 'is-open' : ''} ${studioResponseMode === 'thinking' ? 'is-thinking' : 'is-quick'}`}
                aria-expanded={responseModeMenuOpen}
                aria-haspopup="listbox"
                title={t('dock.tt.responseMode', '切换快速 / 思考（两套模型通道）')}
                aria-label={t('dock.responseMode.triggerAria', '回复模式菜单')}
                onClick={() => setResponseModeMenuOpen((o) => !o)}
              >
                <span className="dock-response-mode-trigger-copy">
                  <span className="dock-response-mode-title">
                    {studioResponseMode === 'quick'
                      ? t('dock.responseMode.quick', '快速')
                      : t('dock.responseMode.thinking', '思考')}
                  </span>
                  <span className="dock-response-mode-desc">
                    {studioResponseMode === 'quick'
                      ? t('dock.responseMode.quickSub', '首包更快 · 日常问答')
                      : t('dock.responseMode.thinkingSub', '深度通道 · 复杂任务')}
                  </span>
                </span>
                <span className="dock-response-mode-chevron" aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>
              {responseModeMenuOpen && (
                <div
                  className="dock-response-mode-panel"
                  role="listbox"
                  aria-label={t('dock.responseMode.panelTitle', '回复模式')}
                >
                  <div className="dock-response-mode-panel-hd">
                    {t('dock.responseMode.panelTitle', '回复模式')}
                  </div>
                  <p className="dock-response-mode-panel-hint">
                    {t(
                      'dock.responseMode.hint',
                      '「快速」与「思考」对应后台两套模型通道，可在 AI 设置里分别为两路指定模型与参数。快速侧重更短等待、适合日常追问；思考侧重深度与复杂编排。',
                    )}
                  </p>
                  {RESPONSE_MODE_ORDER.map((id) => {
                    const selected = studioResponseMode === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`dock-response-mode-option${selected ? ' is-selected' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setStudioResponseMode(id);
                          setResponseModeMenuOpen(false);
                        }}
                      >
                        <span className="dock-response-mode-option-copy">
                          <span className="dock-response-mode-option-title">
                            {id === 'quick'
                              ? t('dock.responseMode.quick', '快速')
                              : t('dock.responseMode.thinking', '思考')}
                          </span>
                          <span className="dock-response-mode-option-desc">
                            {id === 'quick'
                              ? t('dock.responseMode.quickSub', '首包更快 · 日常问答')
                              : t('dock.responseMode.thinkingSub', '深度通道 · 复杂任务')}
                          </span>
                        </span>
                        {selected && (
                          <span className="dock-response-mode-check" aria-hidden>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                              <circle className="dock-response-mode-check-disc" cx="12" cy="12" r="10" fill="currentColor" />
                              <path
                                d="M8 12l2.5 2.5L16 9"
                                stroke="var(--dock-response-mode-check-mark, #fff)"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {activeTab === 'openclaw' && (
              <button
                className="dock-ctx-chip active"
                onClick={() => setDockOcMode((prev) => !prev)}
                title={dockOcMode ? t('dock.tt.useRdkDock', '切到 RDKClaw 对话') : t('dock.tt.useOpenclaw', '切到 OpenClaw 直连')}
                style={{ fontWeight: 600 }}
              >
                {dockOcMode ? '🤖 OpenClaw ↔' : '🔧 RDKClaw ↔'}
              </button>
            )}
          </div>
          <div className="dock-context-strip-scroll">
            {effectiveTab === 'dashboard' && !deviceOnline && (
              <>
                <button
                  type="button"
                  className="dock-ctx-chip dock-ctx-chip--accent"
                  onClick={() => setShowAddDevice(true)}
                >
                  {t('dashboard.addDevice', '添加设备')}
                </button>
                <button
                  type="button"
                  className="dock-ctx-chip"
                  onClick={() => setObStep('board')}
                >
                  {t('dock.quick.dash.onboarding', '新手引导')}
                </button>
                <button
                  type="button"
                  className="dock-ctx-chip"
                  onClick={() => submitQuickPrompt(isEn ? DASHBOARD_CHAT_INTRO_PROMPT_EN : DASHBOARD_CHAT_INTRO_PROMPT_ZH)}
                >
                  {t('dock.quick.dash.capIntro', '了解能力')}
                </button>
              </>
            )}
            {effectiveTab === 'dashboard' && deviceOnline && (
              <>
                {dashboardDockChips.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="dock-ctx-chip"
                    onClick={() => submitQuickPrompt(p.text, p.placeholder, p.forceRdkclaw)}
                  >
                    {p.label}
                  </button>
                ))}
              </>
            )}
            {effectiveTab !== 'dashboard' &&
              quickPrompts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="dock-ctx-chip"
                  onClick={() => submitQuickPrompt(p.text, p.placeholder, p.forceRdkclaw)}
                >
                  {p.label}
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
  const portalHost = hubDockEmbedded ? hubAnchorEl : defaultHostNode;
  return (
    <>
    {portalHost ? createPortal(dockInner, portalHost) : dockInner}
    {unsatisfiedModal ? (
      <div
        className="dock-retry-modal-backdrop"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setUnsatisfiedModal(null);
            setUnsatisfiedNote('');
          }
        }}
      >
        <div
          className="dock-retry-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dock-retry-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="dock-retry-modal-title">{t('dock.msg.unsatisfiedTitle', '重新回答')}</h3>
          <p className="dock-retry-modal-hint">
            {t(
              'dock.msg.unsatisfiedHint',
              '可填写：哪里不满意、或希望怎样改进（留空则请助手先简短确认需求再答）。',
            )}
          </p>
          <textarea
            className="dock-retry-modal-input"
            value={unsatisfiedNote}
            onChange={(e) => setUnsatisfiedNote(e.target.value)}
            placeholder={t('dock.msg.unsatisfiedPlaceholder', '例如：太笼统 / 和 ROS2 不符 / 需要分步骤…')}
            autoComplete="off"
          />
          <div className="dock-retry-modal-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setUnsatisfiedModal(null);
                setUnsatisfiedNote('');
              }}
            >
              {t('dock.msg.unsatisfiedCancel', '取消')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={submitUnsatisfiedRetry}>
              {t('dock.msg.unsatisfiedSubmit', '发送')}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    <DockFlashMentionWizard
      open={dockFlashWizardOpen}
      onClose={() => setDockFlashWizardOpen(false)}
      setActiveTab={setActiveTab}
      addToast={addToast}
      t={t}
      isEn={isEn}
    />
    </>
  );
}
