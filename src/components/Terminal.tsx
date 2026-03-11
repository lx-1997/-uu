import { useRef, useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';
import { TERMINAL_PROFILES, COMMAND_SUGGESTIONS } from '../constants';

export default function Terminal() {
  const {
    terminalProfile, setTerminalProfile, terminalDraft, setTerminalDraft,
    terminalSessions, activeSessionId, setActiveSessionId, currentSession,
    createSession, runTerminalCommand, runTerminalAIAnalysis, addToast,
  } = useAppState();

  const screenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (screenRef.current) screenRef.current.scrollTop = screenRef.current.scrollHeight;
  }, [currentSession.lines]);

  useEffect(() => { inputRef.current?.focus(); }, [activeSessionId]);

  const errorLines = currentSession.lines.filter(l => /error|fail|denied|not found/i.test(l)).length;

  const quickCmds = terminalProfile === 'openclaw'
    ? ['你好，帮我检查设备状态', '列出 ROS 话题', '查看 BPU 使用率', '打开摄像头']
    : COMMAND_SUGGESTIONS;

  // Group lines into conversation blocks: prompt → outputs
  const blocks: { type: 'cmd' | 'output' | 'ai' | 'sep'; lines: string[] }[] = [];
  currentSession.lines.forEach(line => {
    if (line.startsWith('root@') || line.startsWith('$')) {
      blocks.push({ type: 'cmd', lines: [line] });
    } else if (line.startsWith('🤖') || line.startsWith('✨')) {
      blocks.push({ type: 'ai', lines: [line] });
    } else if (line.startsWith('────')) {
      blocks.push({ type: 'sep', lines: [line] });
    } else {
      // Append to previous output block or create new one
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'output') {
        last.lines.push(line);
      } else {
        blocks.push({ type: 'output', lines: [line] });
      }
    }
  });

  return (
    <div className="term-container chat-term">
      {/* Header */}
      <div className="term-header-bar">
        <div className="term-header-left">
          <div className="term-session-chips">
            {terminalSessions.map(session => (
              <button key={session.id}
                className={`term-session-chip ${activeSessionId === session.id ? 'active' : ''}`}
                onClick={() => setActiveSessionId(session.id)}>
                {session.name}
              </button>
            ))}
            <button className="term-session-chip add" onClick={createSession} title="新建会话">+</button>
          </div>
        </div>
        <div className="term-header-right">
          <select className="term-mode-select" value={terminalProfile}
            onChange={e => setTerminalProfile(e.target.value)}>
            {TERMINAL_PROFILES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {errorLines > 0 && (
            <button className="term-warn-pill" onClick={runTerminalAIAnalysis}>⚠ {errorLines} 异常</button>
          )}
          <button className="term-header-icon" title="AI 分析" onClick={runTerminalAIAnalysis}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </button>
          <button className="term-header-icon" title="清屏" onClick={() => addToast('终端已清屏', 'info')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>

      {/* Chat-style conversation area */}
      <div className="term-chat-area" ref={screenRef} onClick={() => inputRef.current?.focus()}>
        {blocks.length === 0 && (
          <div className="term-empty-hint">
            <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>💻</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>终端就绪</div>
            <div style={{ color: '#94a3b8' }}>输入命令或点击下方快捷按钮开始操作</div>
          </div>
        )}
        {blocks.map((block, i) => {
          if (block.type === 'sep') return <div key={i} className="term-chat-sep" />;
          if (block.type === 'cmd') return (
            <div key={i} className="term-bubble-row cmd">
              <div className="term-bubble cmd">
                <span className="term-bubble-label">命令</span>
                {block.lines.map((l, j) => <div key={j} className="term-bubble-line">{l}</div>)}
              </div>
            </div>
          );
          if (block.type === 'ai') return (
            <div key={i} className="term-bubble-row ai">
              <div className="term-bubble-avatar">🤖</div>
              <div className="term-bubble ai">
                {block.lines.map((l, j) => <div key={j} className="term-bubble-line">{l}</div>)}
              </div>
            </div>
          );
          // output
          return (
            <div key={i} className="term-bubble-row output">
              <div className="term-bubble output">
                {block.lines.map((l, j) => {
                  const isErr = /error|fail|denied|not found/i.test(l);
                  return <div key={j} className={`term-bubble-line ${isErr ? 'err' : ''}`}>{l}</div>;
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick commands strip */}
      <div className="term-quick-strip">
        {quickCmds.slice(0, 6).map(cmd => (
          <button key={cmd} className="term-quick-chip" onClick={() => runTerminalCommand(cmd)}>{cmd}</button>
        ))}
      </div>

      {/* Chat-style input bar */}
      <div className="term-input-bar">
        <span className="term-input-ps1">$</span>
        <input
          ref={inputRef}
          className="term-input-field"
          value={terminalDraft}
          onChange={e => setTerminalDraft(e.target.value)}
          placeholder={terminalProfile === 'openclaw' ? '用自然语言描述你想做的事...' : '输入命令...'}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runTerminalCommand(terminalDraft); } }}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="term-send-btn" onClick={() => runTerminalCommand(terminalDraft)}
          disabled={!terminalDraft.trim()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  );
}
