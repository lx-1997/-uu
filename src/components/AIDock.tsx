import { useAppState } from '../hooks/useAppState';

export default function AIDock() {
  const {
    cmd, setCmd, showSuggestions, setShowSuggestions, filteredSuggestions,
    chatMessages, chatExpanded, setChatExpanded, aiTyping,
    handleCommand, setActiveTab,
  } = useAppState();

  return (
    <div className={`floating-dock ${chatExpanded ? 'chat-open' : ''}`}>
      <div className="dock-wrapper">
        {chatExpanded && chatMessages.length > 0 && (
          <div className="chat-panel">
            <div className="chat-panel-header">
              <span className="chat-panel-title">✨ AI 助手</span>
              <button className="chat-panel-close" onClick={() => setChatExpanded(false)} title="收起">✕</button>
            </div>
            <div className="chat-messages">
              {chatMessages.map(msg => (
                <div key={msg.id} className={`chat-message ${msg.role}`}>
                  <div className={`chat-bubble ${msg.role}`}>
                    <p>{msg.text}</p>
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
            value={cmd}
            onChange={e => setCmd(e.target.value)}
            onFocus={() => { if (!chatExpanded) setShowSuggestions(true); }}
            onBlur={() => window.setTimeout(() => setShowSuggestions(false), 200)}
          />
          <button type="submit" className="send-btn" title="发送">↑</button>
        </form>
      </div>
    </div>
  );
}
