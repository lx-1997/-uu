import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { EXAMPLE_PRESETS, EXAMPLE_DETAILS } from '../constants';

export default function Examples() {
  const { examplePreset, setExamplePreset, addToast, setActiveTab } = useAppState();
  const [activeCategory, setActiveCategory] = useState('全部');

  const detail = EXAMPLE_DETAILS[examplePreset] || EXAMPLE_DETAILS['visual-follow'];
  const currentPreset = EXAMPLE_PRESETS.find(p => p.id === examplePreset) || EXAMPLE_PRESETS[0];

  const categoryMap: Record<string, string[]> = {
    '全部': EXAMPLE_PRESETS.map(p => p.id),
    '视觉感知': ['visual-follow', 'stereo-depth'],
    '运动控制': ['gesture-ctrl'],
    '传感器': ['stereo-depth'],
    '社区贡献': ['stereo-depth'],
  };

  const filteredPresets = EXAMPLE_PRESETS.filter(p => categoryMap[activeCategory]?.includes(p.id));

  const depOk = detail.deps.filter(d => d.includes('✅')).length;
  const depWarn = detail.deps.filter(d => d.includes('⚠️')).length;

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📦 示例应用</div>
        <div className="desc-text">官方与社区示例应用，含 AI 依赖检查与智能推荐。</div>

        {/* AI 场景推荐 - 新增 */}
        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 推荐</span>
          <span className="ai-recommend-text">
            基于当前设备配置，推荐从 <strong>视觉跟随</strong> 示例入手 (难度: 入门，依赖已全部满足)。
            如需更高阶体验，可尝试 <strong>双摄测距</strong>。
          </span>
        </div>

        {/* Category filter - 修复为可交互 */}
        <div className="chip-cloud" style={{ marginBottom: 18 }}>
          {['全部', '视觉感知', '运动控制', '传感器', '社区贡献'].map(cat => (
            <button key={cat} className={`chip-btn ${activeCategory === cat ? 'active' : ''}`} onClick={() => setActiveCategory(cat)}>
              {cat} {cat !== '全部' && <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>({categoryMap[cat]?.length || 0})</span>}
            </button>
          ))}
        </div>

        <div className="workspace-grid" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
          <div className="panel-card">
            <div className="panel-title">示例目录 ({filteredPresets.length})</div>
            <div className="option-list">
              {filteredPresets.map((preset) => {
                const exDetail = EXAMPLE_DETAILS[preset.id];
                const hasWarn = exDetail?.deps.some(d => d.includes('⚠️'));
                return (
                  <button key={preset.id} className={`select-card ${examplePreset === preset.id ? 'active' : ''}`} onClick={() => setExamplePreset(preset.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{preset.name}</strong>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{EXAMPLE_DETAILS[preset.id]?.difficulty}</span>
                    </div>
                    <span>{preset.tag}</span>
                    {/* AI 就绪指示 - 新增 */}
                    <div style={{ marginTop: 4, fontSize: '0.72rem', color: hasWarn ? '#d97706' : '#16a34a' }}>
                      {hasWarn ? '⚠️ 需安装缺失依赖' : '✅ 环境就绪，可直接运行'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-title">{currentPreset.name}</div>
            <div className="desc-text" style={{ marginBottom: 14 }}>{detail.desc}</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>来源: {detail.source}</span>
              <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>难度: {detail.difficulty}</span>
              {/* AI 就绪度评估 - 新增 */}
              <span className={`card-status-badge ${depWarn > 0 ? 'warn' : 'ok'}`} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                <span className="card-status-dot"></span>
                就绪度: {depOk}/{detail.deps.length}
              </span>
            </div>
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: 8 }}>依赖检查</strong>
              <div className="usage-list">
                {detail.deps.map(dep => (
                  <div key={dep} className="usage-item" style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'Consolas, monospace', fontSize: '0.85rem' }}>{dep}</span>
                    {/* AI 自动修复建议 - 新增 */}
                    {dep.includes('⚠️') && (
                      <button className="clean-btn outline-btn sm-btn" style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                        onClick={() => addToast(`AI 正在安装缺失依赖: ${dep.replace('⚠️', '').trim()}...`, 'info')}>
                        🔧 AI 修复
                      </button>
                    )}
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
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('terminal'); addToast('已在终端中打开', 'info'); }}>在终端中运行</button>
              {depWarn > 0 && (
                <button className="clean-btn outline-btn" style={{ color: '#d97706', borderColor: '#fcd34d' }}
                  onClick={() => addToast('AI 正在自动安装所有缺失依赖...', 'info')}>
                  🔧 一键修复全部依赖
                </button>
              )}
            </div>

            {/* AI 学习路径建议 - 新增 */}
            <div style={{ marginTop: 16, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>🎓 AI 学习路径建议</div>
              <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6 }}>
                {examplePreset === 'visual-follow' && '完成视觉跟随后，建议进阶到手势控制示例，学习 BPU 模型与运动控制的联动。之后可用流程编排将整套流水线自动化。'}
                {examplePreset === 'gesture-ctrl' && '手势控制掌握后，可以尝试自定义手势映射或接入飞书通知，实现更复杂的人机交互场景。'}
                {examplePreset === 'stereo-depth' && '双摄测距完成后，建议结合 SLAM 算法做环境建图，或将深度数据接入避障逻辑。'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
