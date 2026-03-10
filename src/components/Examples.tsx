import { useAppState } from '../hooks/useAppState';
import { EXAMPLE_PRESETS, EXAMPLE_DETAILS } from '../constants';

export default function Examples() {
  const { examplePreset, setExamplePreset, addToast } = useAppState();

  const detail = EXAMPLE_DETAILS[examplePreset] || EXAMPLE_DETAILS['visual-follow'];
  const currentPreset = EXAMPLE_PRESETS.find(p => p.id === examplePreset) || EXAMPLE_PRESETS[0];

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📦 示例应用</div>
        <div className="desc-text">官方与社区示例应用，含依赖检查与一键启动。</div>

        <div className="chip-cloud" style={{ marginBottom: 18 }}>
          {['全部', '视觉感知', '运动控制', '传感器', '社区贡献'].map(cat => (
            <button key={cat} className={`chip-btn ${cat === '全部' ? 'active' : ''}`}>{cat}</button>
          ))}
        </div>

        <div className="workspace-grid" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
          <div className="panel-card">
            <div className="panel-title">示例目录</div>
            <div className="option-list">
              {EXAMPLE_PRESETS.map((preset) => (
                <button key={preset.id} className={`select-card ${examplePreset === preset.id ? 'active' : ''}`} onClick={() => setExamplePreset(preset.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{preset.name}</strong>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{EXAMPLE_DETAILS[preset.id]?.difficulty}</span>
                  </div>
                  <span>{preset.tag}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">{currentPreset.name}</div>
            <div className="desc-text" style={{ marginBottom: 14 }}>{detail.desc}</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>来源: {detail.source}</span>
              <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>难度: {detail.difficulty}</span>
            </div>
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: 8 }}>依赖检查</strong>
              <div className="usage-list">
                {detail.deps.map(dep => (
                  <div key={dep} className="usage-item" style={{ padding: '8px 14px' }}>
                    <span style={{ fontFamily: 'Consolas, monospace', fontSize: '0.85rem' }}>{dep}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: 8 }}>启动命令</strong>
              <div className="terminal-screen" style={{ minHeight: 'auto', padding: '12px 16px', fontSize: '0.82rem', marginBottom: 0 }}>
                <div className="terminal-line">$ {detail.cmd}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="clean-btn" onClick={() => addToast(`${currentPreset.name} 启动中...`, 'info')}>▶ 一键启动</button>
              <button className="clean-btn outline-btn" onClick={() => addToast('已在终端中打开', 'info')}>在终端中运行</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
