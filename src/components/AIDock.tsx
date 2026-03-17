import { useEffect, useRef, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import type { ChatBlock } from '../app-types';
import { getCapability } from '../ai';

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

function BlockRenderer({ block, onConfirm, onDismiss, onCancelTask }: { block: ChatBlock; onConfirm?: (id: string) => void; onDismiss?: (id: string) => void; onCancelTask?: (taskId: string) => void }) {
  const [rosFrame, setRosFrame] = useState(0);

  useEffect(() => {
    if (block.type !== 'image') return;
    const timer = window.setInterval(() => setRosFrame((p) => (p + 1) % 3), 1200);
    return () => window.clearInterval(timer);
  }, [block.type]);

  if (block.type === 'terminal') {
    return (
      <div className="msg-block terminal-block">
        <div className="terminal-block-header">
          <span className="terminal-block-dots">
            <span className="td red" /><span className="td yellow" /><span className="td green" />
          </span>
          <span className="terminal-block-label">Terminal</span>
        </div>
        <div className="terminal-block-body">
          {block.lines.map((line, i) => (
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

export default function AIDock() {
  const {
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, chatExpanded, setChatExpanded, aiTyping,
    handleCommand, setActiveTab, activeTab,
    executeConfirm, dismissConfirm, clearChatHistory,
    agentMode, agentPlan, agentExecution,
    taskHistory, showTaskPanel, setShowTaskPanel, cancelRunningTask,
  } = useAppState();

  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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

  /* Sync workspace mode with chat state — only auto-expand on dashboard, not sub-pages */
  useEffect(() => {
    if (chatExpanded) {
      if (chatMessages.length > 0 && activeTab === 'dashboard') setWorkspaceMode(true);
      return;
    }
    setWorkspaceMode(false);
  }, [chatExpanded, chatMessages.length, activeTab]);

  /* Auto-scroll to newest message */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, aiTyping]);

  const promptsByTab: Record<string, typeof defaultPrompts> = {
    dashboard: [
      { id: 'diag', icon: '🩺', label: '一键体检', text: '帮我全面检查设备健康状态，包括温度、负载和网络' },
      { id: 'stat', icon: '📊', label: '性能总结', text: '总结当前设备各项指标，判断是否适合跑多路推理' },
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
      { id: 'topic', icon: '📡', label: '话题巡检', text: '检查所有 ROS2 话题频率是否正常' },
      { id: 'bbox', icon: '👁️', label: '查看推理', text: '查看 AI 推理结果 bbox 输出' },
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

  /* 直接提交快捷提示 */
  const submitQuickPrompt = (text: string) => {
    setCmd(text);
    // 下一帧自动提交
    requestAnimationFrame(() => {
      const form = document.querySelector('.input-box') as HTMLFormElement;
      form?.requestSubmit();
    });
  };

  const closeDock = () => {
    setChatExpanded(false);
    setWorkspaceMode(false);
    setShowAllMessages(false);
  };

  /* Markdown 渲染：**粗体**、`代码`、换行、- 列表、### 标题、```代码块``` */
  const renderMarkdown = (text: string) => {
    if (!text) return null;

    // 先按代码块分割
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
            <button className="md-code-copy" onClick={() => { navigator.clipboard.writeText(code); }}>复制</button>
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
  };

  const renderInlineMarkdown = (text: string, keyOffset: number): React.ReactNode[] => {
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
      // 列表项
      if (/^[-*•]\s+/.test(trimmed)) {
        listItems.push(trimmed.replace(/^[-*•]\s+/, ''));
        return;
      }
      // 有序列表
      if (/^\d+\.\s+/.test(trimmed)) {
        listItems.push(trimmed.replace(/^\d+\.\s+/, ''));
        return;
      }
      flushList();
      // 标题
      if (trimmed.startsWith('### ')) {
        result.push(<h4 key={`h-${keyOffset}-${i}`} className="md-h4">{renderInline(trimmed.slice(4))}</h4>);
        return;
      }
      if (trimmed.startsWith('## ')) {
        result.push(<h3 key={`h-${keyOffset}-${i}`} className="md-h3">{renderInline(trimmed.slice(3))}</h3>);
        return;
      }
      // 空行
      if (!trimmed) {
        result.push(<br key={`br-${keyOffset}-${i}`} />);
        return;
      }
      // 普通行
      result.push(<span key={`l-${keyOffset}-${i}`}>{renderInline(trimmed)}{i < lines.length - 1 ? <br /> : null}</span>);
    });
    flushList();
    return result;
  };

  const renderInline = (text: string): React.ReactNode => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={i} className="md-inline-code">{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className={`floating-dock ${chatExpanded ? 'chat-open' : ''} ${workspaceMode ? 'workspace-mode' : ''}`}>
      <div className="dock-wrapper">
        {chatExpanded && chatMessages.length > 0 && (
          <div className={`chat-panel ${workspaceMode ? 'workspace' : ''}`}>
            {/* ── Header ── */}
            <div className="chat-panel-header">
              <div className="chat-panel-title-wrap">
                <span style={{ display: 'flex', alignItems: 'center', color: '#ff6b00' }}>{Icon.spark}</span>
                <span className="chat-panel-title">AI 工作台</span>
                <span className={`agent-badge ${agentMode ? 'on' : 'off'} ${agentExecution.lastError ? 'error' : ''}`}>
                  {agentMode
                    ? agentExecution.running
                      ? `Agent RUN ${agentExecution.currentStep}/${agentExecution.totalSteps}`
                      : agentExecution.lastError
                        ? 'Agent ERROR'
                        : `Agent ON${agentPlan ? ` · ${agentPlan.steps.length}步` : ''}`
                    : 'Agent OFF'}
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
                    <p>{msg.role === 'ai' ? renderMarkdown(msg.text) : msg.text}</p>
                    {msg.blocks?.map((block, i) => (
                      <BlockRenderer key={i} block={block} onConfirm={executeConfirm} onDismiss={dismissConfirm} onCancelTask={cancelRunningTask} />
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

        {/* ── Input bar ── */}
        <form className="input-box" onSubmit={handleCommand}>
          <span style={{ display: 'flex', alignItems: 'center', marginRight: 10, color: '#ff6b00', flexShrink: 0 }}>{Icon.spark}</span>
          <input
            type="text"
            className="cmd-input"
            placeholder={activeTab === 'dashboard' ? '输入你想做的事，我来帮你推荐方案...' : '描述你的需求，AI 助手帮你操作...'}
            ref={chatInputRef}
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onFocus={() => { setInputFocused(true); if (!chatExpanded) setShowSuggestions(true); }}
            onBlur={() => { setInputFocused(false); window.setTimeout(() => setShowSuggestions(false), 200); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && chatExpanded) { closeDock(); e.preventDefault(); }
            }}
          />
          {cmd.trim() && (
            <button type="button" className="input-clear-btn" onClick={() => setCmd('')} title="清空">
              {Icon.close}
            </button>
          )}
          <button type="submit" className={`send-btn ${cmd.trim() ? 'ready' : ''}`} disabled={!cmd.trim() && !aiTyping} title="发送">{Icon.send}</button>
        </form>

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
