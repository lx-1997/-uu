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

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (screenRef.current) {
      screenRef.current.scrollTop = screenRef.current.scrollHeight;
    }
  }, [currentSession.lines]);

  // Focus input when session changes
  useEffect(() => { inputRef.current?.focus(); }, [activeSessionId]);

  const lineCount = currentSession.lines.length;
  const errorLines = currentSession.lines.filter(l => /error|fail|denied|not found/i.test(l)).length;

  const quickCmds = terminalProfile === 'openclaw'
    ? ['你好，帮我检查设备状态', '列出 ROS 话题', '查看 BPU 使用率', '打开摄像头']
    : COMMAND_SUGGESTIONS;

  return (
    <div className="term-container">
      {/* Title bar */}
      <div className="term-titlebar">
        <div className="term-titlebar-left">
          <div className="term-traffic">
            <span className="term-dot red" />
            <span className="term-dot yellow" />
            <span className="term-dot green" />
          </div>
          <div className="term-session-tabs">
            {terminalSessions.map((session) => (
              <button
                key={session.id}
                className={`term-tab ${activeSessionId === session.id ? 'active' : ''}`}
                onClick={() => setActiveSessionId(session.id)}
              >
                {session.name}
              </button>
            ))}
            <button className="term-tab term-tab-add" onClick={createSession} title="新建会话">+</button>
          </div>
        </div>
        <div className="term-titlebar-right">
          <select
            className="term-profile-select"
            value={terminalProfile}
            onChange={e => setTerminalProfile(e.target.value)}
          >
            {TERMINAL_PROFILES.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {errorLines > 0 && (
            <button className="term-err-btn" onClick={runTerminalAIAnalysis}>
              ⚠ {errorLines} 异常
            </button>
          )}
          <button className="term-icon-btn" title="AI 分析" onClick={runTerminalAIAnalysis}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </button>
          <button className="term-icon-btn" title="清屏" onClick={() => addToast('终端已清屏', 'info')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>

      {/* Terminal screen */}
      <div className="term-screen" ref={screenRef} onClick={() => inputRef.current?.focus()}>
        {currentSession.lines.map((line, i) => (
          <div
            key={`${i}-${line}`}
            className={`term-line ${
              line.startsWith('root@') ? 'prompt' :
              line.startsWith('🤖') || line.startsWith('✨') ? 'ai' :
              /error|fail|denied/i.test(line) ? 'err' :
              line.startsWith('────') ? 'sep' : ''
            }`}
          >{line}</div>
        ))}
        {/* Live input line */}
        <div className="term-live-line">
          <span className="term-ps1">root@rdk:~$</span>
          <input
            ref={inputRef}
            className="term-live-input"
            value={terminalDraft}
            onChange={e => setTerminalDraft(e.target.value)}
            placeholder="输入命令..."
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); runTerminalCommand(terminalDraft); }
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>

      {/* Bottom bar: quick commands + status */}
      <div className="term-bottombar">
        <div className="term-quick-cmds">
          {quickCmds.slice(0, 6).map(cmd => (
            <button key={cmd} className="term-quick-btn" onClick={() => runTerminalCommand(cmd)}>{cmd}</button>
          ))}
        </div>
        <div className="term-status">
          <span className="term-status-item">{lineCount} 行</span>
          <span className="term-status-item">{currentSession.name}</span>
          <span className="term-status-item">{terminalProfile === 'ros' ? 'ROS2' : terminalProfile === 'diag' ? 'DIAG' : 'SHELL'}</span>
          <span className={`term-status-item ${errorLines > 0 ? 'err' : 'ok'}`}>
            {errorLines > 0 ? `${errorLines} err` : '✓'}
          </span>
        </div>
      </div>
    </div>
  );
}
