import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import type { ChatBlock, ChatAttachment } from '../app-types';
import { getCapability } from '../ai';
import { resolveSocketUrl } from '../utils/socket';
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

function BlockRenderer({
  block,
  onConfirm,
  onDismiss,
  onCancelTask,
  onApprovalAction,
}: {
  block: ChatBlock;
  onConfirm?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onCancelTask?: (taskId: string) => void;
  onApprovalAction?: (approvalId: string, action: 'allow_once' | 'allow_session_auto' | 'allow_global_auto' | 'deny' | 'cancel_run', runId?: string) => void;
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
        </div>
        <pre className="code-block-body"><code>{block.content}</code></pre>
      </div>
    );
  }

  if (block.type === 'status') {
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

  if (block.type === 'confirm') {
    return (
      <div className="msg-block confirm-block">
        <p className="confirm-block-text">{block.text}</p>
        <div className="confirm-block-actions">
          <button className="confirm-btn yes" onClick={() => onConfirm?.(block.confirmId)}>确认执行</button>
          <button className="confirm-btn no" onClick={() => onDismiss?.(block.confirmId)}>取消</button>
        </div>
      </div>
    );
  }

  if (block.type === 'approval') {
    return (
      <div className="msg-block confirm-block">
        <p className="confirm-block-text">{block.text}</p>
        <div className="confirm-block-actions">
          <button className="confirm-btn yes" onClick={() => onApprovalAction?.(block.approvalId, 'allow_once', block.runId)}>本次允许</button>
          <button className="confirm-btn yes" onClick={() => onApprovalAction?.(block.approvalId, 'allow_session_auto', block.runId)}>本会话自动</button>
          <button className="confirm-btn yes" onClick={() => onApprovalAction?.(block.approvalId, 'allow_global_auto', block.runId)}>全局自动</button>
          <button className="confirm-btn no" onClick={() => onApprovalAction?.(block.approvalId, 'deny', block.runId)}>拒绝</button>
          <button className="confirm-btn no" onClick={() => onApprovalAction?.(block.approvalId, 'cancel_run', block.runId)}>取消当前任务</button>
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
        <img src={attachment.url} alt={attachment.name} loading="lazy" onClick={() => window.open(attachment.url, '_blank')} />
      </div>
    );
  }
  if (attachment.type === 'video') {
    return (
      <div className="chat-attachment chat-attachment-video">
        <video src={attachment.url} controls preload="metadata" />
      </div>
    );
  }
  if (attachment.type === 'audio') {
    return (
      <div className="chat-attachment chat-attachment-audio">
        <div className="audio-msg-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
        </div>
        <audio src={attachment.url} controls preload="metadata" />
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

export default function AIDock() {
  const {
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, setChatMessages, chatExpanded, setChatExpanded, aiTyping, setAiTyping,
    handleCommand, setActiveTab, activeTab,
    executeConfirm, dismissConfirm, clearChatHistory,
    agentExecution,
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask,
    handleApprovalAction,
    openclawConnected, setOpenclawConnected,
    currentDevice,
  } = useAppState();

  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<SocketIOClient.Socket | null>(null);
  const forceLocalAssistantRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const addAttachment = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    const att: ChatAttachment = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'file',
      name: file.name,
      url,
      mimeType: file.type,
      size: file.size,
    };
    setPendingAttachments(prev => [...prev, att]);
  }, []);

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
    Array.from(files).forEach(addAttachment);
    e.target.value = '';
  }, [addAttachment]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    Array.from(files).forEach(addAttachment);
  }, [addAttachment]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const toggleVoiceRecord = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        addAttachment(file);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      // Microphone not available
    }
  }, [isRecording, addAttachment]);

  const maxVisibleMessages = 40;
  const visibleMessages = showAllMessages ? chatMessages : chatMessages.slice(-maxVisibleMessages);
  const hiddenCount = Math.max(0, chatMessages.length - visibleMessages.length);

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

  const promptsByTab: Record<string, typeof defaultPrompts> = {
    dashboard: [
      { id: 'diag', icon: '🩺', label: '一键体检', text: '帮我全面检查设备健康状态，包括温度、负载和网络' },
      { id: 'stat', icon: '📊', label: '能力盘点', text: '同步 NodeHub 和 ModelZoo 板端状态，汇总当前可编排能力' },
      { id: 'appgen', icon: '✨', label: '生成应用', text: '基于当前设备能力，生成一个可部署机器人应用并立即执行第一步' },
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
  };
  const defaultPrompts = [
    { id: 'diag', icon: '🔍', label: '分析异常日志', text: '请结合终端最近输出，帮我定位异常并给出修复步骤' },
    { id: 'hw', icon: '🌡️', label: '硬件状态', text: '检查当前设备的 BPU 负载和芯片温度' },
    { id: 'plan', icon: '📋', label: '执行计划', text: '把当前需求拆成 3 步并立即开始执行第一步' },
  ];
  const quickPrompts = promptsByTab[activeTab] ?? defaultPrompts;
  const isFlasherTab = activeTab === 'flasher';

  /* 直接提交快捷提示 */
  const submitQuickPrompt = (text: string) => {
    setCmd(text);
    // 下一帧自动提交
    requestAnimationFrame(() => {
      const form = document.querySelector('.input-box') as HTMLFormElement;
      form?.requestSubmit();
    });
  };

  // 说明：用户输入统一走 RDK Studio Claw 主链路（/api/agent/chat）
  // 板端 OpenClaw 仅作为 RDK Studio Claw 在服务端可调用的能力，不在前端直连对话

  const handleUnifiedCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const text = cmd.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if (!text && !hasAttachments) return;

    // Attach files to the message
    if (hasAttachments) {
      const msgId = Date.now();
      const attachmentText = pendingAttachments
        .map(a => a.type === 'image' ? `[图片: ${a.name}]` : a.type === 'audio' ? '[语音消息]' : `[文件: ${a.name}]`)
        .join(' ');
      const fullText = text ? `${text}\n${attachmentText}` : attachmentText;

      setChatMessages(prev => [...prev, {
        id: msgId,
        role: 'user' as const,
        text: fullText,
        attachments: [...pendingAttachments],
      }]);
      setChatExpanded(true);
      setPendingAttachments([]);
      setCmd('');

      if (text) {
        setTimeout(() => handleCommand(e), 50);
      }
      return;
    }

    const aiForced = text.match(/^\/ai\s+([\s\S]+)/i);
    if (aiForced) {
      const next = aiForced[1].trim();
      if (!next) return;
      forceLocalAssistantRef.current = true;
      setCmd(next);
      requestAnimationFrame(() => {
        const form = document.querySelector('.input-box') as HTMLFormElement;
        form?.requestSubmit();
      });
      return;
    }

    if (forceLocalAssistantRef.current) {
      forceLocalAssistantRef.current = false;
      handleCommand(e);
      return;
    }

    handleCommand(e);
  };

  const closeDock = () => {
    setChatExpanded(false);
    setWorkspaceMode(false);
    setShowAllMessages(false);
  };

  return (
    <div className={`floating-dock ${chatExpanded ? 'chat-open' : ''} ${workspaceMode ? 'workspace-mode' : ''} ${isFlasherTab ? 'flasher-passive' : ''}`}>
      <div className="dock-wrapper">
        {chatExpanded && chatMessages.length > 0 && (
          <div className={`chat-panel ${workspaceMode ? 'workspace' : ''}`}>
            {/* ── Header ── */}
            <div className="chat-panel-header">
              <div className="chat-panel-title-wrap">
                <span style={{ display: 'flex', alignItems: 'center', color: '#ff6b00' }}>{Icon.spark}</span>
                <span className="chat-panel-title">AI 工作台</span>

                <span className={`agent-badge on ${agentExecution.lastError ? 'error' : ''}`}>
                  {agentExecution.lastError ? 'RDK Studio Claw ERROR' : 'RDK Studio Claw ON'}
                </span>
                <span className={`agent-badge ${openclawConnected ? 'on' : 'off'}`}>
                  {openclawConnected ? 'OpenClaw READY' : 'OpenClaw OFFLINE'}
                </span>
              </div>
              <div className="chat-panel-controls">
                {taskHistory.length > 0 && (
                  <button
                    className={`chat-panel-action ${showTaskPanel ? 'active' : ''}`}
                    onClick={() => setShowTaskPanel(!showTaskPanel)}
                    title="任务面板"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                    </svg>
                    <span style={{ marginLeft: 4 }}>
                      任务{taskHistory.filter(t => t.status === 'running').length > 0
                        ? ` (${taskHistory.filter(t => t.status === 'running').length})`
                        : ''}
                    </span>
                  </button>
                )}
                {chatMessages.length > 0 && (
                  <button
                    className="chat-panel-action"
                    onClick={clearChatHistory}
                    title="清空对话"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                    <span style={{ marginLeft: 4 }}>清空</span>
                  </button>
                )}
                <button
                  className="chat-panel-action"
                  onClick={() => setWorkspaceMode(!workspaceMode)}
                  title={workspaceMode ? '还原窗口' : '全屏模式'}
                >
                  {workspaceMode ? Icon.collapse : Icon.expand}
                  <span style={{ marginLeft: 4 }}>{workspaceMode ? '还原' : '放大'}</span>
                </button>
                <button className="chat-panel-close" onClick={closeDock} title="关闭">
                  {Icon.close}
                </button>
              </div>
            </div>

            {/* ── Task Panel (overlay) ── */}
            {showTaskPanel && (
              <div className="task-panel">
                <div className="task-panel-title">任务列表</div>
                {taskHistory.length === 0 ? (
                  <div className="task-panel-empty">暂无任务记录</div>
                ) : (
                  <div className="task-panel-list">
                    {taskHistory.map(task => (
                      <div key={task.id} className={`task-item task-${task.status}`}>
                        <div className="task-item-header">
                          <span className={`task-dot task-dot-${task.status}`} />
                          <span className="task-item-label">{getCapability(task.capabilityId)?.label ?? task.capabilityId}</span>
                          <span className="task-item-status">
                            {task.status === 'running' ? '执行中' : task.status === 'done' ? '已完成' : task.status === 'failed' ? '失败' : task.status === 'cancelled' ? '已取消' : '等待中'}
                          </span>
                        </div>
                        {task.steps.length > 0 && (
                          <div className="task-item-steps">
                            {task.steps.map((s, i) => (
                              <div key={i} className={`task-step-mini task-step-${s.status}`}>
                                <span className="task-step-icon">
                                  {s.status === 'done' ? '✓' : s.status === 'running' ? '◉' : '○'}
                                </span>
                                <span>{s.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {task.result && (
                          <div className={`task-item-result ${task.result.success ? 'success' : 'fail'}`}>
                            {task.result.title} — {task.result.detail}
                          </div>
                        )}
                        {task.status === 'running' && (
                          <button className="task-cancel-btn-panel" onClick={() => cancelRunningTask(task.id)}>
                            取消
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Chat stream ── */}
            <div className="chat-stream">
              {/* Active tasks banner */}
              {(() => {
                const running = taskHistory.filter(t => t.status === 'running');
                if (running.length < 2) return null;
                return (
                  <div className="active-tasks-banner">
                    <span className="active-tasks-icon">⚡</span>
                    <span>{running.length} 个任务并行中：</span>
                    {running.map(t => (
                      <span key={t.id} className="active-task-tag">
                        {getCapability(t.capabilityId)?.label ?? t.capabilityId}
                      </span>
                    ))}
                  </div>
                );
              })()}
              {!showAllMessages && hiddenCount > 0 && (
                <button className="history-truncate" onClick={() => setShowAllMessages(true)}>
                  查看更早的 {hiddenCount} 条消息
                </button>
              )}

              {visibleMessages.map((msg) => (
                <div key={msg.id} className={`chat-message ${msg.role}`}>
                  {/* Avatar */}
                  <div className={`chat-avatar ${msg.role}`}>
                    {msg.role === 'ai' ? Icon.robot : Icon.user}
                  </div>
                  {/* Bubble */}
                  <div className={`chat-bubble ${msg.role}`}>
                    {/* Attachments (images/files/audio/video) */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className={`chat-attachments ${msg.attachments.length > 1 ? 'grid' : ''}`}>
                        {msg.attachments.map(att => (
                          <AttachmentRenderer key={att.id} attachment={att} />
                        ))}
                      </div>
                    )}
                    {/* Text content */}
                    {msg.text && (
                      msg.role === 'ai'
                        ? <div className="msg-text">{renderMarkdown(msg.text)}</div>
                        : <p className="msg-text">{msg.text}</p>
                    )}
                    {msg.blocks?.map((block, i) => (
                      <BlockRenderer
                        key={i}
                        block={block}
                        onConfirm={executeConfirm}
                        onDismiss={dismissConfirm}
                        onCancelTask={cancelRunningTask}
                        onApprovalAction={handleApprovalAction}
                      />
                    ))}
                    {msg.action && (
                      <button className="chat-action-btn" onClick={() => setActiveTab(msg.action!.tab)}>
                        {msg.action.label} →
                      </button>
                    )}
                    <span className="chat-msg-time">
                      {new Date(msg.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}

              {aiTyping && (
                <div className="chat-message ai">
                  <div className="chat-avatar ai">{Icon.robot}</div>
                  <div className="chat-bubble ai typing">
                    <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Suggestions overlay (idle state) */}
        {showSuggestions && !chatExpanded && filteredSuggestions.length > 0 && (
          <div className="suggestions-dropdown">
            {filteredSuggestions.slice(0, 6).map((s, i) => (
              <div key={i} className="suggestion-item" onMouseDown={() => { setCmd(s.text); setShowSuggestions(false); }}>
                <span className="suggestion-icon">{s.icon}</span>
                {s.text}
              </div>
            ))}
          </div>
        )}

        {/* ── Input bar (multimodal) ── */}
        <div
          className={`input-area ${pendingAttachments.length > 0 ? 'has-attachments' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {/* Attachment preview strip */}
          {pendingAttachments.length > 0 && (
            <div className="attachment-preview-strip">
              {pendingAttachments.map(att => (
                <div key={att.id} className={`attachment-preview-item ${att.type}`}>
                  {att.type === 'image' && <img src={att.url} alt={att.name} className="attachment-thumb" />}
                  {att.type === 'video' && (
                    <div className="attachment-icon-wrap video">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                  )}
                  {att.type === 'audio' && (
                    <div className="attachment-icon-wrap audio">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
                    </div>
                  )}
                  {att.type === 'file' && (
                    <div className="attachment-icon-wrap file">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                  )}
                  <span className="attachment-name">{att.name}</span>
                  <button type="button" className="attachment-remove" onClick={() => removeAttachment(att.id)}>
                    {Icon.close}
                  </button>
                </div>
              ))}
            </div>
          )}

          <form className="input-box" onSubmit={handleUnifiedCommand}>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*,video/*,audio/*,.pdf,.zip,.tar,.gz,.py,.js,.ts,.json,.txt,.md,.csv" title="选择文件" className="sr-only" />

            {/* Left action buttons */}
            <div className="input-actions-left">
              <button type="button" className="input-action-btn" onClick={handleFilePick} title="上传图片/文件">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
              <button
                type="button"
                className={`input-action-btn ${isRecording ? 'recording' : ''}`}
                onClick={toggleVoiceRecord}
                title={isRecording ? '停止录音' : '语音输入'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>
            </div>

            {/* Text input */}
            <input
              type="text"
              className="cmd-input"
              placeholder={openclawConnected
                ? '输入消息，或上传图片/文件/语音...'
                : '和 RDK Studio Claw 聊聊，或拖拽文件到这里...'}
              ref={chatInputRef}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onFocus={() => { setInputFocused(true); if (!chatExpanded) setShowSuggestions(true); }}
              onBlur={() => { setInputFocused(false); window.setTimeout(() => setShowSuggestions(false), 200); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && chatExpanded) { closeDock(); e.preventDefault(); }
              }}
            />

            {/* Right actions */}
            {cmd.trim() && (
              <button type="button" className="input-clear-btn" onClick={() => setCmd('')} title="清空">
                {Icon.close}
              </button>
            )}
            <button
              type="submit"
              className={`send-btn ${cmd.trim() || pendingAttachments.length > 0 ? 'ready' : ''}`}
              disabled={!cmd.trim() && pendingAttachments.length === 0 && !aiTyping}
              title="发送"
            >
              {Icon.send}
            </button>
          </form>
        </div>

        {/* ── Quick prompt chips (contextual per tab) ── */}
        <div className="quick-prompt-strip">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt.id}
                className="quick-prompt-chip"
                onClick={() => submitQuickPrompt(prompt.text)}
              >
                <span className="qp-icon">{prompt.icon}</span>
                <span className="qp-label">{prompt.label}</span>
              </button>
            ))}
          </div>
      </div>
    </div>
  );
}
