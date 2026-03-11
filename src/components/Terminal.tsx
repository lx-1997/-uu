import { useAppState } from '../hooks/useAppState';
import { TERMINAL_PROFILES, COMMAND_SUGGESTIONS } from '../constants';

export default function Terminal() {
  const {
    terminalProfile, setTerminalProfile, terminalDraft, setTerminalDraft,
    terminalSessions, activeSessionId, setActiveSessionId, currentSession,
    createSession, runTerminalCommand, runTerminalAIAnalysis, addToast,
  } = useAppState();

  const lineCount = currentSession.lines.length;
  const errorLines = currentSession.lines.filter(l => /error|fail|denied|not found/i.test(l)).length;
  const hasRecentOutput = lineCount > 3;

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget terminal-shell">
        <div className="widget-header">💻 AI 终端</div>
        <div className="desc-text">AI 增强的远程终端 — 智能补全、错误诊断、自然语言执行。</div>

        {/* AI 上下文感知条 */}
        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 上下文</span>
          <span className="ai-recommend-text">
            当前会话 <strong>{currentSession.name}</strong> · {lineCount} 行输出 ·
            {errorLines > 0
              ? <span style={{ color: '#ef4444' }}> 检测到 {errorLines} 处异常，建议运行 AI 分析</span>
              : <span style={{ color: '#22c55e' }}> 输出无异常</span>
            }
            {terminalProfile === 'ros' && ' · ROS2 环境已加载'}
            {terminalProfile === 'diag' && ' · 诊断模式，BPU/温度命令优先推荐'}
          </span>
        </div>

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
              placeholder="输入命令 · Tab 触发 AI 补全 · 或直接用中文描述 (如 '查看温度')"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runTerminalCommand(terminalDraft); } }}
            />
            <button className="clean-btn" onClick={() => runTerminalCommand(terminalDraft)}>执行</button>
          </div>
        </div>

        <div className="ai-suggest-strip">
          <span className="ai-suggest-label">✨ AI 智能建议</span>
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

        {/* AI 快捷场景 - 根据 profile 智能推荐工作流 */}
        <div className="ai-recommend-strip" style={{ background: '#f0fdf4', borderColor: '#bbf7d0', marginTop: 10 }}>
          <span className="ai-suggest-label">🎯 场景速达</span>
          {terminalProfile === 'ros' && (
            <div className="chip-cloud" style={{ margin: 0 }}>
              <button className="chip-btn" onClick={() => { runTerminalCommand('ros2 topic list'); setTimeout(() => runTerminalCommand('ros2 node list'), 600); }}>🔄 全面巡检 ROS 环境</button>
              <button className="chip-btn" onClick={() => runTerminalCommand('ros2 topic echo /hobot_dnn/bbox')}>👁️ 实时查看 AI 推理结果</button>
              <button className="chip-btn" onClick={() => runTerminalCommand('ros2 bag record -a')}>⏺️ 一键开始录包</button>
            </div>
          )}
          {terminalProfile === 'diag' && (
            <div className="chip-cloud" style={{ margin: 0 }}>
              <button className="chip-btn" onClick={() => { runTerminalCommand('hrut_smi'); setTimeout(() => runTerminalCommand('cat /sys/class/thermal/thermal_zone0/temp'), 600); }}>🩺 BPU + 温度全检</button>
              <button className="chip-btn" onClick={() => runTerminalCommand('free -h')}>💾 内存使用概览</button>
              <button className="chip-btn" onClick={() => runTerminalCommand('dmesg | tail')}>📋 查看最新系统日志</button>
            </div>
          )}
          {terminalProfile === 'shell' && (
            <div className="chip-cloud" style={{ margin: 0 }}>
              <button className="chip-btn" onClick={() => runTerminalCommand('查看温度')}>🌡️ 用中文查温度</button>
              <button className="chip-btn" onClick={() => runTerminalCommand('查看进程')}>📊 用中文查进程</button>
              <button className="chip-btn" onClick={() => runTerminalCommand('ip addr show')}>🌐 网络状态</button>
            </div>
          )}
        </div>

        <div className="terminal-actions-bar">
          <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('终端输出已清空', 'info')}>🗑 清屏</button>
          <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('输出已复制到剪贴板', 'success')}>📋 复制</button>
          <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('日志已导出', 'info')}>💾 导出</button>
          <div style={{ flex: 1 }}></div>
          {hasRecentOutput && errorLines > 0 && (
            <button className="clean-btn sm-btn" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }} onClick={runTerminalAIAnalysis}>
              ⚠️ AI 诊断 {errorLines} 处异常
            </button>
          )}
          <button className="clean-btn outline-btn sm-btn ai-action-btn" onClick={runTerminalAIAnalysis}>🤖 AI 分析输出</button>
          <button className="clean-btn outline-btn sm-btn ai-action-btn" onClick={() => addToast('自然语言模式已激活 — 直接输入中文描述即可，AI 会翻译为命令', 'info')}>💬 自然语言模式</button>
        </div>
      </div>
    </div>
  );
}
