import { useAppState } from '../hooks/useAppState';
import { TERMINAL_PROFILES, COMMAND_SUGGESTIONS } from '../constants';

export default function Terminal() {
  const {
    terminalProfile, setTerminalProfile, terminalDraft, setTerminalDraft,
    terminalSessions, activeSessionId, setActiveSessionId, currentSession,
    createSession, runTerminalCommand, runTerminalAIAnalysis, addToast,
  } = useAppState();

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget terminal-shell">
        <div className="widget-header">💻 AI 终端</div>
        <div className="desc-text">AI 增强的远程终端 — 智能补全、错误诊断、自然语言执行。</div>

        <div className="terminal-topbar">
          <div className="session-tabs">
            {terminalSessions.map((session) => (
              <button key={session.id} className={`session-tab ${activeSessionId === session.id ? 'active' : ''}`} onClick={() => setActiveSessionId(session.id)}>
                {session.name}
              </button>
            ))}
            <button className="session-tab add-tab" onClick={createSession}>+</button>
          </div>
          <select className="clean-input compact-input" value={terminalProfile} onChange={(e) => setTerminalProfile(e.target.value)}>
            {TERMINAL_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.label}</option>
            ))}
          </select>
        </div>

        <div className="panel-card terminal-screen-card">
          <div className="terminal-screen" style={{ minHeight: 260 }}>
            {currentSession.lines.map((line, index) => (
              <div key={`${line}-${index}`} className="terminal-line">{line}</div>
            ))}
          </div>
          <div className="terminal-input-row">
            <span className="terminal-prompt">$</span>
            <input
              className="clean-input terminal-input"
              value={terminalDraft}
              onChange={(e) => setTerminalDraft(e.target.value)}
              placeholder="输入命令 · Tab 触发 AI 补全 · 自然语言也行"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runTerminalCommand(terminalDraft); } }}
            />
            <button className="clean-btn" onClick={() => runTerminalCommand(terminalDraft)}>执行</button>
          </div>
        </div>

        <div className="ai-suggest-strip">
          <span className="ai-suggest-label">✨ AI 建议</span>
          <div className="chip-cloud" style={{ margin: 0 }}>
            {(terminalProfile === 'ros'
              ? ['ros2 topic list', 'ros2 node list', 'ros2 topic echo /hobot_dnn/bbox', 'ros2 bag record -a']
              : terminalProfile === 'diag'
              ? ['hrut_smi', 'cat /sys/class/thermal/thermal_zone0/temp', 'bputop', 'dmesg | tail']
              : COMMAND_SUGGESTIONS
            ).map((suggestion) => (
              <button key={suggestion} className="chip-btn" onClick={() => runTerminalCommand(suggestion)}>{suggestion}</button>
            ))}
          </div>
        </div>

        <div className="terminal-actions-bar">
          <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('终端输出已清空', 'info')}>🗑 清屏</button>
          <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('输出已复制到剪贴板', 'success')}>📋 复制</button>
          <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('日志已导出', 'info')}>💾 导出</button>
          <div style={{ flex: 1 }}></div>
          <button className="clean-btn outline-btn sm-btn ai-action-btn" onClick={runTerminalAIAnalysis}>🤖 AI 分析输出</button>
          <button className="clean-btn outline-btn sm-btn ai-action-btn" onClick={() => addToast('自然语言模式已激活 — 直接输入中文描述即可，AI 会翻译为命令', 'info')}>💬 自然语言模式</button>
        </div>
      </div>
    </div>
  );
}
