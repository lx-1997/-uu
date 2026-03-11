import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../hooks/useAppState';

export default function AIDock() {
  const {
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, chatExpanded, setChatExpanded, aiTyping,
    handleCommand, setActiveTab, currentSession, rosTopic,
  } = useAppState();

  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextView, setContextView] = useState<'assistant' | 'logs' | 'ros'>('assistant');
  const [autoFollowLogs, setAutoFollowLogs] = useState(true);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [compactMode, setCompactMode] = useState(true);
  const [rosFrame, setRosFrame] = useState(0);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

  const maxVisibleMessages = workspaceMode ? 24 : 40;
  const visibleMessages = showAllMessages ? chatMessages : chatMessages.slice(-maxVisibleMessages);
  const hiddenCount = Math.max(0, chatMessages.length - visibleMessages.length);

  const terminalLines = useMemo(() => currentSession.lines.slice(-80), [currentSession.lines]);
  const rosFrameHints = useMemo(
    () => [
      { id: 0, title: '实时目标框', subtitle: 'BBox overlay', value: '目标 3 个 · 29 FPS' },
      { id: 1, title: '深度对齐层', subtitle: 'Depth alignment', value: '深度偏差 2.3%' },
      { id: 2, title: '路径热力图', subtitle: 'Trajectory map', value: '跟踪稳定度 94%' },
    ],
    [],
  );

  useEffect(() => {
    if (!workspaceMode || !autoFollowLogs || contextView !== 'logs') return;
    const el = logViewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [workspaceMode, autoFollowLogs, contextView, terminalLines]);

  useEffect(() => {
    if (!workspaceMode || contextView !== 'ros') return;
    const timer = window.setInterval(() => {
      setRosFrame((prev) => (prev + 1) % 3);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [workspaceMode, contextView]);

  useEffect(() => {
    if (!workspaceMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWorkspaceMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspaceMode]);

  useEffect(() => {
    if (chatExpanded) return;
    setWorkspaceMode(false);
    setContextOpen(false);
    setContextView('assistant');
  }, [chatExpanded]);

  useEffect(() => {
    if (showAllMessages) return;
    if (hiddenCount > 0 && chatMessages.length > maxVisibleMessages) {
      setShowAllMessages(false);
    }
  }, [chatMessages.length, hiddenCount, maxVisibleMessages, showAllMessages]);

  const quickPrompts = [
    { id: 'diag', label: '分析最新异常日志', text: '请结合终端最近输出，帮我定位异常并给出修复步骤' },
    { id: 'ros', label: '查看 ROS 视觉流', text: '切到 ROS 图像视角，并总结当前画面中的目标情况' },
    { id: 'openclaw', label: '调用 OpenClaw 工作流', text: '使用 OpenClaw 执行一个自动化巡检流程' },
    { id: 'plan', label: '给我任务执行计划', text: '把当前需求拆成 3 步并立即开始执行第一步' },
  ];

  const closeDock = () => {
    setChatExpanded(false);
    setWorkspaceMode(false);
    setContextOpen(false);
    setContextView('assistant');
    setShowAllMessages(false);
  };

  const openContext = (view: 'assistant' | 'logs' | 'ros') => {
    setWorkspaceMode(true);
    setContextView(view);
    setContextOpen(true);
  };

  return (
    <div className={`floating-dock ${chatExpanded ? 'chat-open' : ''} ${workspaceMode ? 'workspace-mode' : ''}`}>
      <div className="dock-wrapper">
        {chatExpanded && chatMessages.length > 0 && (
          <div className={`chat-panel ${workspaceMode ? 'workspace' : ''}`}>
            <div className="chat-panel-header">
              <div className="chat-panel-title-wrap">
                <span className="chat-panel-title">AI 协同工作台</span>
                <span className="chat-panel-subtitle">对话 + 终端反馈 + ROS 可视流</span>
              </div>
              <div className="chat-panel-controls">
                <button
                  className="chat-panel-action"
                  onClick={() => {
                    setWorkspaceMode((prev) => !prev);
                    if (!workspaceMode) {
                      setContextOpen(false);
                      setContextView('assistant');
                    }
                  }}
                  title={workspaceMode ? '退出工作台' : '放大到工作台'}
                >
                  {workspaceMode ? '还原' : '放大'}
                </button>
                {workspaceMode && (
                  <>
                    <button className="chat-panel-action" onClick={() => openContext('logs')}>日志</button>
                    <button className="chat-panel-action" onClick={() => openContext('ros')}>ROS</button>
                    <button
                      className="chat-panel-action"
                      onClick={() => {
                        if (contextOpen && contextView === 'assistant') setContextOpen(false);
                        else openContext('assistant');
                      }}
                    >
                      助手侧栏
                    </button>
                  </>
                )}
                <button className="chat-panel-close" onClick={closeDock} title="关闭">✕</button>
              </div>
            </div>

            <div className={`chat-body ${workspaceMode ? 'workspace' : ''} ${contextOpen ? 'with-context' : 'no-context'}`}>
              <div className="chat-main-column">
                {workspaceMode && (
                  <div className="conversation-toolbar">
                    <div className="conversation-meta">消息 {chatMessages.length} 条</div>
                    <button className="conversation-toggle" onClick={() => setCompactMode((prev) => !prev)}>
                      {compactMode ? '宽松排版' : '紧凑排版'}
                    </button>
                  </div>
                )}

                <div className={`chat-messages ${compactMode ? 'compact' : ''}`}>
                  {!showAllMessages && hiddenCount > 0 && (
                    <button className="history-truncate" onClick={() => setShowAllMessages(true)}>
                      查看更早的 {hiddenCount} 条消息
                    </button>
                  )}

                  {visibleMessages.map((msg) => (
                    <div key={msg.id} className={`chat-message ${msg.role}`}>
                      <div className={`chat-bubble ${msg.role}`}>
                        <p>{msg.text}</p>
                        <span className="chat-msg-time">{new Date(msg.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {msg.action && (
                          <button className="chat-action-btn" onClick={() => setActiveTab(msg.action!.tab)}>
                            {msg.action.label} →
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {aiTyping && (
                    <div className="chat-message ai">
                      <div className="chat-bubble ai typing">
                        <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                      </div>
                    </div>
                  )}

                  {showAllMessages && hiddenCount > 0 && (
                    <button className="history-truncate" onClick={() => setShowAllMessages(false)}>
                      收起历史，仅看最近 {maxVisibleMessages} 条
                    </button>
                  )}
                </div>
              </div>

              {workspaceMode && contextOpen && (
                <aside className="chat-context-column">
                  <div className="chat-context-tabs">
                    <button className={`context-tab ${contextView === 'assistant' ? 'active' : ''}`} onClick={() => setContextView('assistant')}>助手</button>
                    <button className={`context-tab ${contextView === 'logs' ? 'active' : ''}`} onClick={() => setContextView('logs')}>终端日志</button>
                    <button className={`context-tab ${contextView === 'ros' ? 'active' : ''}`} onClick={() => setContextView('ros')}>ROS 图像</button>
                  </div>

                  {contextView === 'assistant' && (
                    <div className="context-panel">
                      <div className="context-title">统一交互入口</div>
                      <p className="context-copy">在这里提问会自动路由到终端、OpenClaw 或 ROS 工具链，适合纯对话驱动任务执行。</p>
                      <div className="context-actions">
                        <button className="context-chip" onClick={() => setActiveTab('openclaw')}>打开 OpenClaw</button>
                        <button className="context-chip" onClick={() => setActiveTab('terminal')}>查看终端面板</button>
                        <button className="context-chip" onClick={() => setActiveTab('ros')}>进入 ROS 可视化</button>
                      </div>
                    </div>
                  )}

                  {contextView === 'logs' && (
                    <div className="context-panel">
                      <div className="context-top-row">
                        <div className="context-title">设备反馈日志</div>
                        <label className="context-toggle">
                          <input type="checkbox" checked={autoFollowLogs} onChange={(e) => setAutoFollowLogs(e.target.checked)} />
                          自动跟随
                        </label>
                      </div>
                      <div className="context-log-view" ref={logViewportRef}>
                        {terminalLines.map((line, index) => (
                          <div key={`${line}-${index}`} className="context-log-line">{line}</div>
                        ))}
                      </div>
                      <button className="context-link" onClick={() => setActiveTab('terminal')}>在终端中查看完整日志 →</button>
                    </div>
                  )}

                  {contextView === 'ros' && (
                    <div className="context-panel">
                      <div className="context-title">ROS 实时图像流</div>
                      <div className="ros-live-frame">
                        <div className={`ros-vision-overlay frame-${rosFrame}`}>
                          <span className="ros-bbox first" />
                          <span className="ros-bbox second" />
                        </div>
                        <div className="ros-frame-meta">Topic: {rosTopic}</div>
                      </div>
                      <div className="ros-frame-list">
                        {rosFrameHints.map((item) => (
                          <button
                            key={item.id}
                            className={`ros-frame-item ${rosFrame === item.id ? 'active' : ''}`}
                            onClick={() => setRosFrame(item.id)}
                          >
                            <strong>{item.title}</strong>
                            <span>{item.subtitle}</span>
                            <em>{item.value}</em>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </aside>
              )}
            </div>
          </div>
        )}

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

        <form className="input-box" onSubmit={handleCommand}>
          <span style={{ marginRight: '12px', fontSize: '1.2rem', color: '#ff6b00' }}>✨</span>
          <input
            type="text"
            className="cmd-input"
            placeholder="向 AI 助手提问... (按 / 聚焦)"
            ref={chatInputRef}
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onFocus={() => { if (!chatExpanded) setShowSuggestions(true); }}
            onBlur={() => window.setTimeout(() => setShowSuggestions(false), 200)}
          />
          <button type="submit" className="send-btn" title="发送">↑</button>
        </form>

        {workspaceMode && (
          <div className="quick-prompt-strip">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt.id}
                className="quick-prompt-chip"
                onClick={() => {
                  setCmd(prompt.text);
                  chatInputRef.current?.focus();
                }}
              >
                {prompt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
