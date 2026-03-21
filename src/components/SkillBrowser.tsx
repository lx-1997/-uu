import React, { useEffect, useState, useCallback } from 'react';
import type { SkillManifest } from '../skills/types';
import { fetchSkills, reloadSkills, fetchSkillMd } from '../skills/loader';
import { fetchRDKClawPolicy, saveRDKClawPolicy, type RDKClawPolicy } from '../api';

const CATEGORY_LABELS: Record<string, string> = {
  system: '系统',
  development: '开发',
  ai: 'AI',
  robotics: '机器人',
  monitoring: '监控',
  remote: '远程',
  general: '通用',
};

const CATEGORY_ICONS: Record<string, string> = {
  system: '⚙️',
  development: '💻',
  ai: '🤖',
  robotics: '🦾',
  monitoring: '📊',
  remote: '🖥️',
  general: '📦',
};

export default function SkillBrowser() {
  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<SkillManifest | null>(null);
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [detailTab, setDetailTab] = useState<'overview' | 'apis' | 'raw' | 'policy'>('overview');
  const [policy, setPolicy] = useState<RDKClawPolicy | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policySavedAt, setPolicySavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchSkills();
    setSkills(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchRDKClawPolicy().then((res) => setPolicy(res.policy)).catch(() => null);
  }, []);

  const handleReload = async () => {
    setLoading(true);
    const data = await reloadSkills();
    setSkills(data);
    setLoading(false);
  };

  const handleSelectSkill = async (skill: SkillManifest) => {
    setSelectedSkill(skill);
    setDetailTab('overview');
    const md = await fetchSkillMd(skill.name);
    setSkillMd(md);
  };

  const savePolicy = async () => {
    if (!policy) return;
    setSavingPolicy(true);
    try {
      const res = await saveRDKClawPolicy(policy);
      setPolicy(res.policy);
      setPolicySavedAt(Date.now());
    } finally {
      setSavingPolicy(false);
    }
  };

  const categories = [...new Set(skills.map(s => s.metadata?.rdkstudio?.category || 'general'))];

  const filtered = skills.filter(s => {
    const cat = s.metadata?.rdkstudio?.category || 'general';
    if (filter !== 'all' && cat !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    }
    return true;
  });

  const builtinSkills = filtered.filter(s => !s.name.startsWith('eco-'));
  const ecoSkills = filtered.filter(s => s.name.startsWith('eco-'));
  const selectedCategory = selectedSkill?.metadata?.rdkstudio?.category || 'general';
  const selectedCategoryLabel = CATEGORY_LABELS[selectedCategory] || selectedCategory;
  const selectedCategoryIcon = CATEGORY_ICONS[selectedCategory] || '📦';

  return (
    <div className="skill-browser-v2">
      <header className="skill-v2-toolbar">
        <div>
          <h2 className="skill-v2-title">技能管理</h2>
          <p className="skill-v2-subtitle">统一查看技能能力、调用 API 与 RDKClaw 策略</p>
        </div>
        <div className="skill-v2-toolbar-actions">
          <input
            className="skill-v2-search"
            type="text"
            placeholder="搜索技能名称或描述..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="skill-v2-filter"
            value={filter}
            title="按分类筛选"
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部分类</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_ICONS[cat] || '📦'} {CATEGORY_LABELS[cat] || cat}
              </option>
            ))}
          </select>
          <button className="skill-v2-btn" onClick={handleReload} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </button>
          <button className="skill-v2-btn primary" onClick={savePolicy} disabled={savingPolicy || !policy}>
            {savingPolicy ? '保存中...' : '保存策略'}
          </button>
        </div>
      </header>

      <div className="skill-v2-layout">
        <aside className="skill-v2-nav">
          <div className="skill-v2-nav-head">
            <span>技能总数</span>
            <strong>{filtered.length}</strong>
          </div>
          {builtinSkills.length > 0 && (
            <section className="skill-v2-group">
              <h3>内置技能 · {builtinSkills.length}</h3>
              {builtinSkills.map((skill) => (
                <SkillNavItem
                  key={skill.name}
                  skill={skill}
                  selected={selectedSkill?.name === skill.name}
                  onClick={() => handleSelectSkill(skill)}
                />
              ))}
            </section>
          )}
          {ecoSkills.length > 0 && (
            <section className="skill-v2-group">
              <h3>生态技能 · {ecoSkills.length}</h3>
              {ecoSkills.map((skill) => (
                <SkillNavItem
                  key={skill.name}
                  skill={skill}
                  selected={selectedSkill?.name === skill.name}
                  onClick={() => handleSelectSkill(skill)}
                />
              ))}
            </section>
          )}
          {filtered.length === 0 && !loading && <div className="skill-v2-empty">无匹配技能</div>}
        </aside>

        <main className="skill-v2-main">
          <div className="skill-v2-tabs">
            <button className={`segment-btn ${detailTab === 'overview' ? 'active' : ''}`} onClick={() => setDetailTab('overview')}>技能详情</button>
            <button className={`segment-btn ${detailTab === 'apis' ? 'active' : ''}`} onClick={() => setDetailTab('apis')}>API 列表</button>
            <button className={`segment-btn ${detailTab === 'raw' ? 'active' : ''}`} onClick={() => setDetailTab('raw')}>SKILL.md</button>
            <button className={`segment-btn ${detailTab === 'policy' ? 'active' : ''}`} onClick={() => setDetailTab('policy')}>RDKClaw 策略</button>
          </div>

          {detailTab !== 'policy' && !selectedSkill && (
            <div className="skill-v2-placeholder">
              <p>选择左侧一个技能查看详情</p>
              <p>当前共 {skills.length} 个技能（内置 {skills.filter((s) => !s.name.startsWith('eco-')).length} / 生态 {skills.filter((s) => s.name.startsWith('eco-')).length}）</p>
            </div>
          )}

          {detailTab === 'overview' && selectedSkill && (
            <section className="skill-v2-card">
              <h3>{selectedSkill.name}</h3>
              <p className="skill-v2-desc">{selectedSkill.description}</p>
              <div className="skill-v2-badges">
                <span className="skill-v2-badge">{selectedSkill.version}</span>
                <span className="skill-v2-badge">{selectedCategoryIcon} {selectedCategoryLabel}</span>
                <span className="skill-v2-badge">APIs: {selectedSkill.apis.length}</span>
                {selectedSkill.metadata?.rdkstudio?.tab && <span className="skill-v2-badge">Tab: {selectedSkill.metadata.rdkstudio.tab}</span>}
                {selectedSkill.metadata?.rdkstudio?.requires?.device && <span className="skill-v2-badge warning">需要设备</span>}
              </div>
              {selectedSkill.clientActions.length > 0 && (
                <div className="skill-v2-chip-list">
                  {selectedSkill.clientActions.map((action, index) => (
                    <code className="skill-v2-chip" key={`${action}-${index}`}>{action}</code>
                  ))}
                </div>
              )}
            </section>
          )}

          {detailTab === 'apis' && selectedSkill && (
            <section className="skill-v2-card">
              <h3>API 列表</h3>
              {selectedSkill.apis.length === 0 ? (
                <p className="skill-v2-desc">该技能暂未声明 API。</p>
              ) : (
                <div className="skill-v2-api-list">
                  {selectedSkill.apis.map((api, i) => (
                    <div key={`${api.path}-${i}`} className="skill-v2-api-row">
                      <span className={`skill-api-method ${api.method.toLowerCase()}`}>{api.method}</span>
                      <span className="skill-api-path">{api.path}</span>
                      <span className="skill-api-name">{api.name}</span>
                      {api.caution && <span className="skill-api-caution">⚠️</span>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {detailTab === 'raw' && (
            <section className="skill-v2-card">
              <h3>SKILL.md 原文</h3>
              <pre className="skill-v2-raw">{skillMd || '请先在左侧选择技能'}</pre>
            </section>
          )}

          {detailTab === 'policy' && policy && (
            <section className="skill-v2-policy-grid">
              <div className="skill-v2-card">
                <h3>人格 / 记忆边界</h3>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={policy.memory.mainSessionReadsMemory}
                    onChange={(e) => setPolicy({ ...policy, memory: { ...policy.memory, mainSessionReadsMemory: e.target.checked } })}
                  />
                  主会话读取 MEMORY
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={policy.memory.sharedSessionBlocksMemory}
                    onChange={(e) => setPolicy({ ...policy, memory: { ...policy.memory, sharedSessionBlocksMemory: e.target.checked } })}
                  />
                  共享会话屏蔽 MEMORY
                </label>
              </div>

              <div className="skill-v2-card">
                <h3>委派 / 审批</h3>
                <div className="skill-v2-field">
                  <span>委派策略</span>
                  <select title="委派策略" aria-label="委派策略" value={policy.delegation.strategy} onChange={(e) => setPolicy({ ...policy, delegation: { ...policy.delegation, strategy: e.target.value as RDKClawPolicy['delegation']['strategy'] } })}>
                    <option value="local-first">local-first</option>
                    <option value="board-first">board-first</option>
                    <option value="hybrid">hybrid</option>
                  </select>
                </div>
                <div className="skill-v2-field">
                  <span>审批模式</span>
                  <select title="审批模式" aria-label="审批模式" value={policy.approval.mode} onChange={(e) => setPolicy({ ...policy, approval: { ...policy.approval, mode: e.target.value as RDKClawPolicy['approval']['mode'] } })}>
                    <option value="always">always</option>
                    <option value="risk-based">risk-based</option>
                    <option value="auto">auto</option>
                  </select>
                </div>
                <div className="skill-v2-field">
                  <span>风险阈值</span>
                  <select title="风险阈值" aria-label="风险阈值" value={policy.approval.riskThreshold} onChange={(e) => setPolicy({ ...policy, approval: { ...policy.approval, riskThreshold: e.target.value as RDKClawPolicy['approval']['riskThreshold'] } })}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </div>
              </div>

              <div className="skill-v2-card">
                <h3>定时 / 推送</h3>
                <div className="skill-v2-field">
                  <span>默认推送渠道</span>
                  <select title="默认推送渠道" aria-label="默认推送渠道" value={policy.scheduler.defaultChannel} onChange={(e) => setPolicy({ ...policy, scheduler: { ...policy.scheduler, defaultChannel: e.target.value as RDKClawPolicy['scheduler']['defaultChannel'] } })}>
                    <option value="chat">chat</option>
                    <option value="feishu">feishu</option>
                  </select>
                </div>
              </div>

              <div className="skill-v2-card">
                <h3>联网能力</h3>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={policy.network.enabled}
                    onChange={(e) => setPolicy({ ...policy, network: { ...policy.network, enabled: e.target.checked } })}
                  />
                  启用联网工具
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={policy.network.requireApproval}
                    onChange={(e) => setPolicy({ ...policy, network: { ...policy.network, requireApproval: e.target.checked } })}
                  />
                  联网工具默认走审批
                </label>
                <div className="skill-v2-field">
                  <span>单次抓取最大字符</span>
                  <input
                    type="number"
                    title="单次抓取最大字符"
                    aria-label="单次抓取最大字符"
                    min={2000}
                    max={120000}
                    step={500}
                    value={policy.network.maxFetchChars}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0);
                      setPolicy({ ...policy, network: { ...policy.network, maxFetchChars: Math.max(2000, Math.min(120000, next || 16000)) } });
                    }}
                  />
                </div>
              </div>

              <div className="skill-v2-policy-footer">
                <button className="skill-v2-btn primary" onClick={savePolicy} disabled={savingPolicy}>
                  {savingPolicy ? '保存中...' : '保存策略'}
                </button>
                <span className="skill-v2-save-info">
                  {policySavedAt ? `上次保存：${new Date(policySavedAt).toLocaleTimeString()}` : '尚未保存本次修改'}
                </span>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function SkillNavItem({
  skill,
  selected,
  onClick,
}: {
  skill: SkillManifest;
  selected: boolean;
  onClick: () => void;
}) {
  const cat = skill.metadata?.rdkstudio?.category || 'general';
  const icon = CATEGORY_ICONS[cat] || '📦';
  const isEco = skill.name.startsWith('eco-');

  return (
    <button type="button" className={`skill-v2-item ${selected ? 'selected' : ''} ${isEco ? 'eco' : ''}`} onClick={onClick}>
      <div className="skill-v2-item-icon">{icon}</div>
      <div className="skill-v2-item-content">
        <div className="skill-v2-item-name">{skill.name}</div>
        <div className="skill-v2-item-desc">{skill.description.slice(0, 72)}{skill.description.length > 72 ? '...' : ''}</div>
      </div>
      <div className="skill-v2-item-meta">
        <span>{skill.apis.length} APIs</span>
      </div>
    </button>
  );
}
