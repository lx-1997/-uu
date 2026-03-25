import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import type { ChatBlock, ChatAttachment, ChatMessage } from '../app-types';
import type { AgentAttachmentPayload } from '../api';
import { getCapability } from '../ai';
import { resolveSocketUrl } from '../utils/socket';
import { resolveApiUrl } from '../utils/apiBase';
import { renderMarkdown } from './MarkdownRenderer';
import io from 'socket.io-client';

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
  robot: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/>
      <line x1="12" y1="7" x2="12" y2="11"/>
      <line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/>
    </svg>
  ),
  user: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
};

type PendingAttachment = ChatAttachment & {
  file: File;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: {
    results: ArrayLike<ArrayLike<{ transcript?: string }>>;
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

function StatusCollapsible({ block }: { block: Extract<ChatBlock, { type: 'status' }> }) {
  const [open, setOpen] = useState(!block.defaultCollapsed);
  return (
    <div className={`msg-block status-collapsible ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="status-collapsible-trigger"
        onClick={() => setOpen((p) => !p)}
      >
        <svg className="status-collapsible-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="status-collapsible-summary">{block.summary || block.items[0]?.label || '详情'}</span>
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

function BlockRenderer({
  block,
  onConfirm,
  onDismiss,
  onCancelTask,
  onApprovalAction,
  onRecommendationChoice,
  onSoulUpdateDecision,
}: {
  block: ChatBlock;
  onConfirm?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onCancelTask?: (taskId: string) => void;
  onApprovalAction?: (approvalId: string, action: 'allow_once' | 'allow_session_auto' | 'allow_global_auto' | 'deny' | 'cancel_run', runId?: string) => void;
  onRecommendationChoice?: (recommendationId: string, choiceId: string, autoExecute: boolean) => void;
  onSoulUpdateDecision?: (proposalId: string, accepted: boolean) => void;
}) {
  const [rosFrame, setRosFrame] = useState(0);
  const [expandedTerminal, setExpandedTerminal] = useState(false);

  useEffect(() => {
    if (block.type !== 'image') return;
    const timer = window.setInterval(() => setRosFrame((p) => (p + 1) % 3), 1200);
    return () => window.clearInterval(timer);
  }, [block.type]);

  if (block.type === 'terminal') {
    const previewLines = Math.max(3, block.previewLines ?? 10);
    const collapsible = !!block.collapsible && block.lines.length > previewLines;
    const visibleLines = collapsible && !expandedTerminal
      ? block.lines.slice(-previewLines)
      : block.lines;
    return (
      <div className="msg-block terminal-block">
        <div className="terminal-block-header">
          <span className="terminal-block-dots">
            <span className="td red" /><span className="td yellow" /><span className="td green" />
          </span>
          <span className="terminal-block-label">{block.label || 'Terminal'}</span>
          <button
            type="button"
            className="chat-panel-action"
            title="复制全部输出"
            onClick={() => {
              void copyDockPlainText(block.lines.join('\n')).then(() => {});
            }}
          >
            复制输出
          </button>
          {collapsible && (
            <button
              type="button"
              className="chat-panel-action"
              onClick={() => setExpandedTerminal((prev) => !prev)}
              title={expandedTerminal ? '收起输出' : '展开输出'}
            >
              {expandedTerminal ? '收起' : `展开 (${block.lines.length} 行)`}
            </button>
          )}
        </div>
        <div className="terminal-block-body">
          {visibleLines.map((line, i) => (
            <div key={i} className="terminal-block-line">{line}</div>
          ))}
        </div>
      </div>
    );
  }

  if (block.type === 'code') {
    return (
      <div className="msg-block code-block">
        <div className="code-block-header">
          <span className="code-block-lang">{block.lang}</span>
          <button
            type="button"
            className="chat-panel-action"
            onClick={() => { void copyDockPlainText(block.content); }}
          >
            复制
          </button>
        </div>
        <pre className="code-block-body"><code>{block.content}</code></pre>
      </div>
    );
  }

  if (block.type === 'status') {
    if (block.collapsible) {
      return (
        <StatusCollapsible
          block={block}
        />
      );
    }
    return (
      <div className="msg-block status-block">
        {block.items.map((item) => (
          <div key={item.label} className="status-block-item">
            <span className={`status-block-dot ${item.ok ? 'ok' : 'warn'}`} />
            <span className="status-block-label">{item.label}</span>
            <span className="status-block-value">{item.value}</span>
          </div>
        ))}
      </div>
    );
  }

  if (block.type === 'image') {
    if (block.src) {
      const imgUrl = resolveApiUrl(block.src);
      return (
        <div className="msg-block image-block">
          <img
            className="image-block-real"
            src={imgUrl}
            alt={block.caption || '设备图片'}
            loading="lazy"
            onClick={() => window.open(imgUrl, '_blank')}
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
    const videoSrc = resolveApiUrl(block.src || '');
    const ext = videoSrc.split('.').pop()?.split('?')[0]?.toLowerCase() || 'mp4';
    const mimeMap: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska' };
    const mimeType = mimeMap[ext] || 'video/mp4';
    return (
      <div className="msg-block video-block">
        <video
          className="video-block-player"
          controls
          playsInline
          preload="auto"
        >
          <source src={videoSrc} type={mimeType} />
        </video>
        {block.caption && <div className="video-block-caption">{block.caption}</div>}
        <a className="video-block-download" href={videoSrc} download target="_blank" rel="noopener noreferrer">
          下载视频
        </a>
      </div>
    );
  }

  if (block.type === 'file') {
    return (
      <div className="msg-block file-block">
        <a
          className="file-block-link"
          href={resolveApiUrl(block.src)}
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
          <span className="confirm-block-title">需要你的确认</span>
        </div>
        <p className="confirm-block-text">{block.text}</p>
        <div className="confirm-block-actions">
          <button className="confirm-btn yes" onClick={() => onConfirm?.(block.confirmId)}>继续执行</button>
          <button className="confirm-btn no" onClick={() => onDismiss?.(block.confirmId)}>暂不执行</button>
        </div>
      </div>
    );
  }

  if (block.type === 'recommendation') {
    return (
      <div className="msg-block confirm-block recommendation-card">
        <div className="confirm-block-head">
          <span className="confirm-block-title">方案推荐</span>
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
                {opt.recommended && <span className="recommendation-badge">推荐</span>}
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
              自动执行推荐方案
            </button>
          </div>
        )}
        {block.chosen && (
          <div className="recommendation-chosen">已选择: {block.options.find(o => o.id === block.chosen)?.label || block.chosen}</div>
        )}
      </div>
    );
  }

  if (block.type === 'soul-update') {
    const actionLabel = block.action === 'add' ? '添加' : block.action === 'modify' ? '修改' : '删除';
    const decided = block.accepted !== null && block.accepted !== undefined;
    return (
      <div className="msg-block confirm-block soul-update-card">
        <div className="confirm-block-head">
          <span className="confirm-block-title">SOUL.md 更新提议</span>
          <span className="soul-update-action">{actionLabel} &lt;{block.section}&gt;</span>
        </div>
        <p className="confirm-block-text">{block.reason}</p>
        {block.currentSnippet && (
          <div className="soul-update-diff">
            <div className="soul-update-label">当前内容</div>
            <pre className="soul-update-pre soul-update-old">{block.currentSnippet}</pre>
          </div>
        )}
        <div className="soul-update-diff">
          <div className="soul-update-label">{block.action === 'remove' ? '将被删除' : '提议内容'}</div>
          <pre className="soul-update-pre soul-update-new">{block.content}</pre>
        </div>
        {!decided ? (
          <div className="confirm-block-actions">
            <button className="confirm-btn yes" onClick={() => onSoulUpdateDecision?.(block.proposalId, true)}>接受</button>
            <button className="confirm-btn no" onClick={() => onSoulUpdateDecision?.(block.proposalId, false)}>拒绝</button>
          </div>
        ) : (
          <div className="soul-update-result">{block.accepted ? '已更新 SOUL.md' : '已拒绝'}</div>
        )}
      </div>
    );
  }

  if (block.type === 'approval') {
    const risk = (block.risk || 'medium').toLowerCase();
    const riskLabel = risk === 'high' ? '高风险' : risk === 'low' ? '低风险' : '中风险';
    return (
      <div className={`msg-block confirm-block approval-card risk-${risk}`}>
        <div className="confirm-block-head">
          <span className="confirm-block-title">操作审批</span>
          <span className={`approval-risk ${risk}`}>{riskLabel}</span>
        </div>
        <p className="confirm-block-text">{block.text}</p>
        <div className="approval-hint">请选择一个操作（建议先用“仅这次允许”）</div>
        <div className="confirm-block-actions">
          <button className="confirm-btn yes primary" onClick={() => onApprovalAction?.(block.approvalId, 'allow_once', block.runId)}>仅这次允许</button>
          <button className="confirm-btn yes" onClick={() => onApprovalAction?.(block.approvalId, 'allow_session_auto', block.runId)}>本会话自动允许</button>
          <button className="confirm-btn yes" onClick={() => onApprovalAction?.(block.approvalId, 'allow_global_auto', block.runId)}>全局自动允许</button>
          <button className="confirm-btn no" onClick={() => onApprovalAction?.(block.approvalId, 'deny', block.runId)}>拒绝本次操作</button>
          <button className="confirm-btn no danger" onClick={() => onApprovalAction?.(block.approvalId, 'cancel_run', block.runId)}>结束当前任务</button>
        </div>
      </div>
    );
  }

  if (block.type === 'progress') {
    const hasRunning = block.steps.some(s => s.status === 'running');
    return (
      <div className="msg-block progress-block">
        {block.steps.map((step, i) => (
          <div key={i} className={`progress-step ${step.status}`}>
            <span className="progress-step-icon">
              {step.status === 'done' ? '✓' : step.status === 'running' ? '◉' : '○'}
            </span>
            <span className="progress-step-label">{step.label}</span>
          </div>
        ))}
        {hasRunning && block.taskId && onCancelTask && (
          <button className="task-cancel-btn" onClick={() => onCancelTask(block.taskId!)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            取消任务
          </button>
        )}
      </div>
    );
  }

  if (block.type === 'task-result') {
    return (
      <div className={`msg-block task-result-block ${block.success ? 'success' : 'fail'}`}>
        <div className="task-result-header">
          <span className="task-result-icon">{block.success ? '✓' : '✗'}</span>
          <span className="task-result-title">{block.title}</span>
        </div>
        {block.detail && <p className="task-result-detail">{block.detail}</p>}
      </div>
    );
  }

  return null;
}

function AttachmentRenderer({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.type === 'image') {
    return (
      <div className="chat-attachment chat-attachment-image">
        {attachment.url ? (
          <img src={attachment.url} alt={attachment.name} loading="lazy" onClick={() => window.open(attachment.url, '_blank')} />
        ) : (
          <div className="file-attachment-info">
            <span className="file-attachment-name">{attachment.name}</span>
            <span className="file-attachment-size">图片附件已上传，可在当前会话继续分析</span>
          </div>
        )}
      </div>
    );
  }
  if (attachment.type === 'video') {
    return (
      <div className="chat-attachment chat-attachment-video">
        {attachment.url ? (
          <video src={attachment.url} controls preload="metadata" />
        ) : (
          <div className="file-attachment-info">
            <span className="file-attachment-name">{attachment.name}</span>
            <span className="file-attachment-size">视频附件已上传</span>
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
        {attachment.url ? <audio src={attachment.url} controls preload="metadata" /> : <span className="file-attachment-size">语音附件已上传</span>}
        {attachment.transcript && (
          <div className="file-attachment-info">
            <span className="file-attachment-size">转写：{attachment.transcript}</span>
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

function chatMessageToPlainText(msg: ChatMessage): string {
  const parts: string[] = [];
  if (msg.text?.trim()) parts.push(msg.text.trim());
  if (msg.blocks?.length) {
    for (const b of msg.blocks) {
      if (b.type === 'terminal') {
        parts.push((b.label ? `${b.label}\n` : '') + b.lines.join('\n'));
      } else if (b.type === 'code') {
        parts.push(`\`\`\`${b.lang}\n${b.content}\n\`\`\``);
      } else if (b.type === 'status') {
        parts.push(b.items.map((i) => `${i.label}: ${i.value}`).join('\n'));
      } else if (b.type === 'confirm' || b.type === 'approval') {
        parts.push(b.text);
      } else if (b.type === 'progress') {
        parts.push(b.steps.map((s) => `${s.label} (${s.status})`).join('\n'));
      } else if (b.type === 'task-result') {
        parts.push([b.title, b.detail].filter(Boolean).join('\n'));
      } else if (b.type === 'image') {
        parts.push(b.caption || b.src || '[图片]');
      }
    }
  }
  return parts.join('\n\n').trim();
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
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, setChatMessages, chatExpanded, setChatExpanded, aiTyping, setAiTyping,
    handleCommand, setActiveTab, activeTab,
    executeConfirm, dismissConfirm, clearChatHistory,
    agentExecution,
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask,
    handleApprovalAction, handleRecommendationChoice, handleSoulUpdateDecision, stopCurrentRun, backgroundCurrentRun,
    backgroundRuns, stopBackgroundRun,
    openclawConnected, setOpenclawConnected,
    openclawSendMessage,
    currentDevice, addToast,
  } = useAppState();

  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [dockOcMode, setDockOcMode] = useState(true);
  const [compactFlowMode, setCompactFlowMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('rdk:dock:compact-flow') !== '0';
    } catch {
      return true;
    }
  });
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTranscript, setRecordingTranscript] = useState('');
  const activeDeviceName = currentDevice?.name?.trim() || '';
  const activeDeviceEndpoint = currentDevice ? `${currentDevice.ip || '-'}:${currentDevice.port ?? 22}` : '';
  const activeRdkclawDeviceLabel = currentDevice
    ? `${activeDeviceName || '未命名设备'} · ${activeDeviceEndpoint}`
    : '未绑定设备';
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<SocketIOClient.Socket | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceTranscriptRef = useRef('');

  const addAttachment = useCallback((file: File, extras?: { transcript?: string; textContent?: string }) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isImage = file.type.startsWith('image/') || /^(jpe?g|png|gif|bmp|webp|svg|ico|tiff?)$/.test(ext);
    const isVideo = file.type.startsWith('video/') || /^(mp4|webm|avi|mov|mkv|flv|wmv|m4v|3gp)$/.test(ext);
    const isAudio = file.type.startsWith('audio/') || /^(mp3|wav|ogg|flac|aac|wma|m4a)$/.test(ext);
    const sizeLimit = isVideo ? MAX_PENDING_VIDEO_BYTES : MAX_PENDING_ATTACHMENT_BYTES;
    if (file.size > sizeLimit) {
      addToast(`附件 ${file.name} 过大，请控制在 ${Math.floor(sizeLimit / (1024 * 1024))}MB 以内`, 'warning');
      return;
    }
    const url = URL.createObjectURL(file);
    const att: PendingAttachment = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
  }, [addToast]);

  const uploadSessionRef = useRef(`upload-${Date.now()}`);

  const uploadLargeAttachment = useCallback(async (file: File, type: string): Promise<{ id: string; storedPath: string }> => {
    const buffer = await file.arrayBuffer();
    const res = await fetch(resolveApiUrl('/api/agent/upload-attachment'), {
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
      const err = await res.json().catch(() => ({ error: '上传失败' }));
      throw new Error(String(err.error || '上传失败'));
    }
    const data = await res.json() as { attachment: { id: string; storedPath: string } };
    return { id: data.attachment.id, storedPath: data.attachment.storedPath };
  }, []);

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
    const files = e.dataTransfer.files;
    Array.from(files).forEach((file) => addAttachment(file));
  }, [addAttachment]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const toggleVoiceRecord = useCallback(async () => {
    if (isRecording) {
      speechRecognitionRef.current?.stop();
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
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
      if (SpeechRecognitionCtor) {
        try {
          const recognition = new SpeechRecognitionCtor();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'zh-CN';
          recognition.onresult = (event) => {
            const finalTranscript: string[] = [];
            for (let i = 0; i < event.results.length; i += 1) {
              const alt = event.results[i]?.[0];
              if (alt?.transcript) {
                finalTranscript.push(String(alt.transcript));
              }
            }
            const merged = finalTranscript.join('').trim();
            voiceTranscriptRef.current = merged;
            setRecordingTranscript(merged);
          };
          recognition.onerror = () => null;
          recognition.onend = () => {
            if (isRecording) {
              setIsRecording(false);
            }
          };
          recognition.start();
          speechRecognitionRef.current = recognition;
        } catch {
          speechRecognitionRef.current = null;
        }
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        speechRecognitionRef.current?.stop();
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        addAttachment(file, {
          transcript: voiceTranscriptRef.current || undefined,
        });
        if (voiceTranscriptRef.current && !cmd.trim()) {
          setCmd(voiceTranscriptRef.current);
        }
        setRecordingTranscript('');
        voiceTranscriptRef.current = '';
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      addToast('无法访问麦克风，请检查浏览器或桌面端权限', 'warning');
    }
  }, [isRecording, addAttachment, addToast, cmd, setCmd]);

  const maxVisibleMessages = 40;
  const visibleMessages = showAllMessages ? chatMessages : chatMessages.slice(-maxVisibleMessages);
  const hiddenCount = Math.max(0, chatMessages.length - visibleMessages.length);
  const shouldKeepStatusInCompact = useCallback((block: Extract<ChatBlock, { type: 'status' }>) => {
    if (block.summary === '本轮资源消耗') return true;
    return block.items.some((item) => /失败|错误|异常|提示|拒绝|超时/.test(`${item.label} ${item.value}`));
  }, []);
  const filterAiBlocksForCompact = useCallback((blocks: ChatBlock[]) => {
    if (!compactFlowMode) return blocks;
    return blocks.filter((block) => {
      if (block.type === 'approval' || block.type === 'confirm' || block.type === 'task-result' || block.type === 'recommendation' || block.type === 'soul-update') return true;
      if (block.type === 'image' || block.type === 'video' || block.type === 'file' || block.type === 'code') return true;
      if (block.type === 'status') return shouldKeepStatusInCompact(block);
      return false;
    });
  }, [compactFlowMode, shouldKeepStatusInCompact]);

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
      localStorage.setItem('rdk:dock:compact-flow', compactFlowMode ? '1' : '0');
    } catch {
      // ignore localStorage errors
    }
  }, [compactFlowMode]);

  /* Auto-scroll to newest message */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, aiTyping]);

  /* OpenClaw Socket.IO connection */
  useEffect(() => {
    if (!currentDevice) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setOpenclawConnected(false);
      }
      return;
    }

    const socket = io(resolveSocketUrl(), {
      transports: ['polling'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setOpenclawConnected(false);
      socket.emit('openclaw:start', { deviceId: currentDevice.id });
    });

    socket.on('openclaw:ready', () => {
      setOpenclawConnected(true);
    });

    // 板端 OpenClaw 状态仅用于能力可用性展示，不直接写入聊天消息
    socket.on('openclaw:data', () => {});
    socket.on('openclaw:complete', () => {});
    socket.on('openclaw:error', (data: { error: string }) => {
      if (/not connected/i.test(data.error || '')) {
        socket.emit('openclaw:start', { deviceId: currentDevice?.id });
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
  }, [currentDevice, setOpenclawConnected]);

  type QuickPrompt = { id: string; icon: string; label: string; text: string; placeholder?: string; forceRdkclaw?: boolean };
  const promptsByTab: Record<string, QuickPrompt[]> = {
    dashboard: [
      { id: 'diag', icon: '🩺', label: '一键体检', text: '帮我全面检查设备健康状态，包括温度、负载和网络' },
      { id: 'stat', icon: '📊', label: '能力盘点', text: '同步 NodeHub 和 ModelZoo 板端状态，汇总当前可编排能力' },
      {
        id: 'cap-report',
        icon: '🧭',
        label: '能力汇报',
        text: '请分别汇报 RDKClaw 和 OpenClaw 当前能做什么：各列 5 条能力，并给每条配一个可立即执行的一句话示例。',
        forceRdkclaw: true,
      },
      {
        id: 'appgen',
        icon: '✨',
        label: '快速部署应用',
        text: [
          '我要在板端部署一个应用，请按通用流程执行，并在执行前给我确认：',
          '1) 先判断当前设备硬件是否匹配（板卡型号、相机/传感器/麦克风等连接状态）；',
          '2) 不要只依据 data/ecosystem-registry.json，要做实时可用性核验；',
          '3) 联网检索官网文档/开源仓库，确认可行方案；',
          '4) 给出 skill/流程草案、依赖与风险；',
          '5) 明确征求我确认“是否执行”；',
          '6) 我确认后再部署或执行。',
        ].join('\n'),
        forceRdkclaw: true,
      },
      { id: 'new-device', icon: '🔌', label: '新设备接管', text: '把当前设备当成一台全新设备，检查连接、OpenClaw、模型/应用依赖和可开发环境是否就绪' },
    ],
    terminal: [
      { id: 'cmd', icon: '⌨️', label: '帮我写命令', text: '我想做什么操作，帮我生成终端命令' },
      { id: 'err', icon: '🔍', label: '分析输出', text: '帮我分析终端最近的输出，定位问题并给修复建议' },
      { id: 'nl', icon: '💬', label: '中文执行', text: '查看当前设备温度和BPU负载' },
    ],
    flasher: [
      { id: 'pick', icon: '💿', label: '选镜像', text: '帮我推荐适合当前开发板的系统镜像版本' },
      { id: 'check', icon: '✅', label: '烧录前检查', text: '帮我确认烧录前的准备工作是否就绪' },
    ],
    files: [
      { id: 'sync', icon: '📁', label: '同步文件', text: '帮我把本地模型文件同步到设备 /userdata/models' },
      { id: 'log', icon: '📋', label: '拉取日志', text: '从设备下载最新的系统日志到本地' },
    ],
    ide: [
      { id: 'edit', icon: '✏️', label: '代码补全', text: '帮我分析当前打开的文件，给出优化建议' },
      { id: 'run', icon: '▶️', label: '运行脚本', text: '在终端中运行当前编辑的脚本文件' },
      { id: 'fmt', icon: '🧹', label: '格式化', text: '帮我格式化当前文件并检查语法错误' },
    ],
    vnc: [
      { id: 'opt', icon: '🖥️', label: '优化画质', text: '根据当前网络状况帮我调整VNC画质参数' },
      { id: 'vnc-start', icon: '🔌', label: '启动VNC', text: '帮我在设备上启动VNC服务并连接' },
    ],
    hardware: [
      { id: 'hot', icon: '🌡️', label: '散热建议', text: '芯片温度偏高，帮我分析原因并给出降温方案' },
      { id: 'perf', icon: '⚡', label: '性能优化', text: '帮我分析当前 BPU/CPU 使用情况，给出优化建议' },
    ],
    ros: [
      { id: 'rosbridge', icon: '🌉', label: 'Rosbridge', text: '帮我检查 rosbridge_websocket 服务状态，如果未运行请启动它并确认端口 9090 可用' },
      { id: 'topic', icon: '📡', label: '话题巡检', text: '帮我检查所有 ROS2 话题的发布频率，找出异常的话题并给出修复建议' },
      { id: 'tf', icon: '🌳', label: 'TF 诊断', text: '检查 TF 坐标树是否完整，分析 frame 之间的变换关系是否正常' },
      { id: 'node', icon: '🔗', label: '节点健康', text: '列出所有 ROS2 节点，检查哪些节点异常退出或未启动，给出重启命令' },
      { id: 'nav', icon: '🗺️', label: '导航调试', text: '帮我检查导航栈状态，包括 costmap、planner、controller 是否正常工作' },
      { id: 'launch', icon: '🚀', label: '启动文件', text: '帮我生成一个 ROS2 launch 文件，启动摄像头和 AI 推理节点' },
    ],
    models: [
      { id: 'pick', icon: '🧠', label: '选模型', text: '帮我推荐适合行人车辆检测的模型' },
      { id: 'conv', icon: '🔄', label: '转换部署', text: '帮我把 ONNX 模型转成 BPU 可用格式' },
    ],
    lowcode: [
      { id: 'flow', icon: '🧩', label: '生成流程', text: '帮我生成一个摄像头→AI检测→推送的工作流' },
    ],
    openclaw: [
      {
        id: 'oc-vs-rdk',
        icon: '🧭',
        label: '双引擎能力',
        text: '请分别汇报 RDKClaw 与 OpenClaw 各自适合做什么，并给我一个建议：当前任务更该用哪一个，为什么。',
        forceRdkclaw: true,
      },
      { id: 'oc-health', icon: '🩺', label: '网关健康检查', text: '请先检查当前网关状态并给出一条结论' },
      { id: 'oc-cap', icon: '🧩', label: '能力总览', text: '帮我总结当前设备可用的 OpenClaw 能力' },
      { id: 'oc-diag', icon: '🔧', label: '诊断修复', text: '帮我诊断为什么会连接失败，并给修复命令' },
    ],
  };
  const defaultPrompts: QuickPrompt[] = [
    { id: 'diag', icon: '🔍', label: '分析异常日志', text: '请结合终端最近输出，帮我定位异常并给出修复步骤' },
    { id: 'hw', icon: '🌡️', label: '硬件状态', text: '检查当前设备的 BPU 负载和芯片温度' },
    { id: 'plan', icon: '📋', label: '执行计划', text: '把当前需求拆成 3 步并立即开始执行第一步' },
  ];
  const effectiveTab = (activeTab === 'openclaw' && !dockOcMode) ? '_rdkclaw_fallback' : activeTab;
  const quickPrompts = promptsByTab[effectiveTab] ?? defaultPrompts;
  const isFlasherTab = activeTab === 'flasher';

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
      const displayAttachments = pendingAttachments.map(({ file: _file, ...attachment }) => attachment);
      handleCommand(e, {
        messageOverride: requestText,
        attachments: attachmentPayloads,
        displayAttachments,
      });
      setPendingAttachments([]);
      setRecordingTranscript('');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '附件处理失败，请重试', 'error');
    }
  };

  const closeDock = () => {
    setChatExpanded(false);
    setWorkspaceMode(false);
    setShowAllMessages(false);
  };

  return (
    <div className={`dock ${chatExpanded ? 'expanded' : ''} ${workspaceMode ? 'workspace' : ''}`}>
      {/* ── Chat panel (expanded) ── */}
      {chatExpanded && (
        <div className="dock-chat">
          <div className="dock-header">
            <div className="dock-header-left">
              <div className="dock-header-title-wrap">
                <span className="dock-header-title">RDKClaw</span>
                <span className="dock-header-subtitle" title={activeRdkclawDeviceLabel}>
                  当前设备: {activeRdkclawDeviceLabel}
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
              <button
                className={`btn-icon dock-view-toggle ${compactFlowMode ? 'active' : ''}`}
                onClick={() => setCompactFlowMode((prev) => !prev)}
                title={compactFlowMode ? '已开启极简流程视图（点击查看完整过程）' : '已关闭极简流程视图（点击只看结论）'}
              >
                {compactFlowMode ? '极简' : '完整'}
              </button>
              {taskHistory.length > 0 && (
                <button className="btn-icon" onClick={() => setShowTaskPanel(!showTaskPanel)} title="任务">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                </button>
              )}
              <button className="btn-icon" onClick={clearChatHistory} title="清空">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
              <button className="btn-icon" onClick={closeDock} title="关闭">{Icon.close}</button>
            </div>
          </div>

          {/* Task panel */}
          {showTaskPanel && (
            <div className="dock-tasks">
              {backgroundRuns.length > 0 && backgroundRuns.map((run) => (
                <div key={run.runId} className="dock-task-item">
                  <span className={`dock-task-dot ${run.status === 'running' ? 'running' : 'cancelled'}`} />
                  <span className="dock-task-label">板端后台任务</span>
                  <span className="dock-task-status">
                    {run.status === 'running' ? '后台执行中' : '已结束'}
                  </span>
                  {run.status === 'running' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => stopBackgroundRun(run.runId)}>结束</button>
                  )}
                </div>
              ))}
              {taskHistory.map(task => (
                <div key={task.id} className="dock-task-item">
                  <span className={`dock-task-dot ${task.status}`} />
                  <span className="dock-task-label">{getCapability(task.capabilityId)?.label ?? task.capabilityId}</span>
                  <span className="dock-task-status">
                    {task.status === 'running' ? '执行中' : task.status === 'done' ? '完成' : task.status === 'failed' ? '失败' : '等待'}
                  </span>
                  {task.status === 'running' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => cancelRunningTask(task.id)}>取消</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Chat stream */}
          <div className="dock-stream">
            {chatMessages.length === 0 && !aiTyping && (
              <div className="dock-empty-hint">聊天已清空，输入新消息即可继续。</div>
            )}
            {!showAllMessages && hiddenCount > 0 && (
              <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'center' }} onClick={() => setShowAllMessages(true)}>
                查看更早 {hiddenCount} 条
              </button>
            )}

            {visibleMessages.map((msg) => (
              <div key={msg.id} className={`dock-msg ${msg.role}`}>
                <div className={`dock-avatar ${msg.role}`}>
                  {msg.role === 'ai' ? Icon.robot : Icon.user}
                </div>
                <div className={`dock-bubble ${msg.role}`}>
                  {(() => {
                    const plain = chatMessageToPlainText(msg);
                    if (!plain) return null;
                    return (
                      <div className="dock-bubble-toolbar">
                        <button
                          type="button"
                          className="dock-bubble-copy"
                          title="复制本条全文（纯文本）"
                          onClick={() => {
                            void copyDockPlainText(plain).then((ok) => {
                              addToast(ok ? '已复制到剪贴板' : '复制失败，可尝试用鼠标拖选文字', ok ? 'success' : 'warning');
                            });
                          }}
                        >
                          复制
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
                      {(() => {
                        const rawBlocks = msg.blocks ?? [];
                        const visibleBlocks = filterAiBlocksForCompact(rawBlocks);
                        const foldedCount = Math.max(0, rawBlocks.length - visibleBlocks.length);
                        return (
                          <>
                            {compactFlowMode && foldedCount > 0 && (
                              <div className="dock-hidden-hint">已折叠中间过程 {foldedCount} 项（切换到“完整”可查看）</div>
                            )}
                            {visibleBlocks.map((block, i) => (
                              <BlockRenderer key={i} block={block} onConfirm={executeConfirm} onDismiss={dismissConfirm} onCancelTask={cancelRunningTask} onApprovalAction={handleApprovalAction} onRecommendationChoice={handleRecommendationChoice} onSoulUpdateDecision={handleSoulUpdateDecision} />
                            ))}
                          </>
                        );
                      })()}
                      {msg.text && (() => {
                        const { cleanText, mediaBlocks } = extractMediaFromText(msg.text);
                        return (
                          <>
                            {cleanText && <div className="msg-text">{renderMarkdown(cleanText)}</div>}
                            {mediaBlocks.map((mb, i) => (
                              <BlockRenderer key={`extracted-media-${i}`} block={mb} />
                            ))}
                          </>
                        );
                      })()}
                    </>
                  )}
                  {msg.action && (
                    <button className="chat-action-btn" onClick={() => setActiveTab(msg.action!.tab)}>
                      {msg.action.label} →
                    </button>
                  )}
                  <span className="dock-msg-time">
                    {new Date(msg.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}

            {aiTyping && (
              <div className="dock-msg ai">
                <div className="dock-avatar ai">{Icon.robot}</div>
                <div className="dock-bubble ai">
                  <div className="dock-typing">
                    <div className="typing-dots"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
                    <button className="btn btn-sm btn-ghost" onClick={backgroundCurrentRun}>转后台</button>
                    <button className="btn btn-sm btn-ghost" onClick={stopCurrentRun}>结束任务</button>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Suggestions (idle) */}
      {showSuggestions && !chatExpanded && filteredSuggestions.length > 0 && (
        <div className="dock-suggestions" style={{ position: 'relative' }}>
          {filteredSuggestions.slice(0, 6).map((s, i) => (
            <div key={i} className="dock-suggestion-item" onMouseDown={() => { setCmd(s.text); setShowSuggestions(false); }}>
              {s.text}
            </div>
          ))}
        </div>
      )}

      {/* ── Input area ── */}
      <div className="dock-input-area" onDrop={handleDrop} onDragOver={handleDragOver}>
        {pendingAttachments.length > 0 && (
          <div className="dock-attachments">
            {pendingAttachments.map(att => (
              <div key={att.id} className="dock-att-item">
                {att.type === 'image' && att.url && <img src={att.url} alt="" />}
                {att.type === 'video' && att.url && <video src={att.url} muted preload="metadata" style={{ maxHeight: 48, maxWidth: 80, borderRadius: 4 }} />}
                {att.type === 'audio' && <span className="dock-att-icon">🎙️</span>}
                {att.type === 'file' && <span className="dock-att-icon">{getAttachmentIcon(att.name, att.mimeType)}</span>}
                <span className="truncate">{att.name}</span>
                {att.size !== undefined && <span className="dock-att-size">{att.size < 1024 ? `${att.size}B` : att.size < 1048576 ? `${(att.size / 1024).toFixed(0)}KB` : `${(att.size / 1048576).toFixed(1)}MB`}</span>}
                <button className="dock-att-remove" onClick={() => removeAttachment(att.id)}>{Icon.close}</button>
              </div>
            ))}
          </div>
        )}

        {isRecording && recordingTranscript && (
          <div className="dock-attachments">
            <div className="dock-att-item">
              <span className="truncate">识别中：{recordingTranscript}</span>
            </div>
          </div>
        )}

        <form className="dock-form dock-input" onSubmit={handleUnifiedCommand}>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple title="选择文件" className="sr-only" />

          <div className="dock-form-actions">
            <button type="button" className="dock-action-btn" onClick={handleFilePick} title="附件">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <button type="button" className={`dock-action-btn ${isRecording ? 'recording' : ''}`} onClick={toggleVoiceRecord} title={isRecording ? '停止' : '语音'}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
              </svg>
            </button>
          </div>

          <input
            type="text"
            className="dock-cmd-input"
            placeholder={activeTab === 'openclaw' && dockOcMode && openclawSendMessage ? '向 OpenClaw Agent 发送消息...' : '消息、指令或拖拽文件...'}
            ref={chatInputRef}
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onFocus={() => { setInputFocused(true); if (!chatExpanded) setShowSuggestions(true); }}
            onBlur={() => { setInputFocused(false); window.setTimeout(() => setShowSuggestions(false), 200); }}
            onKeyDown={(e) => { if (e.key === 'Escape' && chatExpanded) { closeDock(); e.preventDefault(); } }}
          />

          {cmd.trim() && (
            <button type="button" className="dock-action-btn" onClick={() => setCmd('')} title="清空">{Icon.close}</button>
          )}
          {!chatExpanded && (
            <button
              type="button"
              className="dock-action-btn"
              onClick={() => setChatExpanded(true)}
              title="打开聊天面板"
            >
              {Icon.expand}
            </button>
          )}
          <button type="submit" className={`dock-send-btn ${cmd.trim() || pendingAttachments.length > 0 ? 'ready' : ''}`} disabled={!cmd.trim() && pendingAttachments.length === 0 && !aiTyping} title="发送">
            {Icon.send}
          </button>
        </form>

        {/* Context strip (AI Native) */}
        <div className="dock-context-strip">
          {activeTab === 'openclaw' && (
            <button
              className="dock-ctx-chip active"
              onClick={() => setDockOcMode((prev) => !prev)}
              title={dockOcMode ? '当前：OpenClaw Agent 模式（点击切换到 RDKClaw）' : '当前：RDKClaw 模式（点击切换到 OpenClaw Agent）'}
              style={{ fontWeight: 600 }}
            >
              {dockOcMode ? '🤖 OpenClaw ↔' : '🔧 RDKClaw ↔'}
            </button>
          )}
          {quickPrompts.map((p) => (
            <button key={p.id} className="dock-ctx-chip" onClick={() => submitQuickPrompt(p.text, p.placeholder, p.forceRdkclaw)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
