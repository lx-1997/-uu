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
  const [policy, setPolicy] = useState<RDKClawPolicy | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

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
    const md = await fetchSkillMd(skill.name);
    setSkillMd(md);
  };

  const savePolicy = async () => {
    if (!policy) return;
    setSavingPolicy(true);
    try {
      const res = await saveRDKClawPolicy(policy);
      setPolicy(res.policy);
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

  return (
    <div className="skill-browser">
      {policy && (
        <div className="skill-section">
          <h3 className="skill-section-title">RDKClaw 策略面板</h3>
          <div className="skill-detail-content">
            <div className="skill-apis">
              <h4>人格/记忆边界</h4>
              <div className="skill-api-item">
                <span className="skill-api-name">主会话读取 MEMORY</span>
                <input
                  type="checkbox"
                  title="主会话读取 MEMORY"
                  aria-label="主会话读取 MEMORY"
                  checked={policy.memory.mainSessionReadsMemory}
                  onChange={(e) => setPolicy({ ...policy, memory: { ...policy.memory, mainSessionReadsMemory: e.target.checked } })}
                />
              </div>
              <div className="skill-api-item">
                <span className="skill-api-name">共享会话屏蔽 MEMORY</span>
                <input
                  type="checkbox"
                  title="共享会话屏蔽 MEMORY"
                  aria-label="共享会话屏蔽 MEMORY"
                  checked={policy.memory.sharedSessionBlocksMemory}
                  onChange={(e) => setPolicy({ ...policy, memory: { ...policy.memory, sharedSessionBlocksMemory: e.target.checked } })}
                />
              </div>
            </div>
            <div className="skill-apis">
              <h4>委派策略</h4>
              <select
                title="委派策略"
                aria-label="委派策略"
                value={policy.delegation.strategy}
                onChange={(e) => setPolicy({ ...policy, delegation: { ...policy.delegation, strategy: e.target.value as RDKClawPolicy['delegation']['strategy'] } })}
              >
                <option value="local-first">local-first</option>
                <option value="board-first">board-first</option>
                <option value="hybrid">hybrid</option>
              </select>
            </div>
            <div className="skill-apis">
              <h4>审批策略</h4>
              <select
                title="审批模式"
                aria-label="审批模式"
                value={policy.approval.mode}
                onChange={(e) => setPolicy({ ...policy, approval: { ...policy.approval, mode: e.target.value as RDKClawPolicy['approval']['mode'] } })}
              >
                <option value="always">always</option>
                <option value="risk-based">risk-based</option>
                <option value="auto">auto</option>
              </select>
              <select
                title="风险阈值"
                aria-label="风险阈值"
                value={policy.approval.riskThreshold}
                onChange={(e) => setPolicy({ ...policy, approval: { ...policy.approval, riskThreshold: e.target.value as RDKClawPolicy['approval']['riskThreshold'] } })}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div className="skill-apis">
              <h4>定时模板/推送渠道</h4>
              <select
                title="默认推送渠道"
                aria-label="默认推送渠道"
                value={policy.scheduler.defaultChannel}
                onChange={(e) => setPolicy({ ...policy, scheduler: { ...policy.scheduler, defaultChannel: e.target.value as RDKClawPolicy['scheduler']['defaultChannel'] } })}
              >
                <option value="chat">chat</option>
                <option value="feishu">feishu</option>
              </select>
            </div>
            <button className="skill-reload-btn" onClick={savePolicy} disabled={savingPolicy}>
              {savingPolicy ? '保存中...' : '保存策略'}
            </button>
          </div>
        </div>
      )}
      <div className="skill-browser-header">
        <h2>Skills</h2>
        <div className="skill-browser-controls">
          <input
            className="skill-search"
            type="text"
            placeholder="搜索技能..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="skill-filter"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            title="按分类筛选"
          >
            <option value="all">全部分类</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>
                {CATEGORY_ICONS[cat] || '📦'} {CATEGORY_LABELS[cat] || cat}
              </option>
            ))}
          </select>
          <button className="skill-reload-btn" onClick={handleReload} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
      </div>

      <div className="skill-browser-body">
        <div className="skill-list">
          {builtinSkills.length > 0 && (
            <div className="skill-section">
              <h3 className="skill-section-title">内置技能 ({builtinSkills.length})</h3>
              {builtinSkills.map(skill => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  selected={selectedSkill?.name === skill.name}
                  onClick={() => handleSelectSkill(skill)}
                />
              ))}
            </div>
          )}

          {ecoSkills.length > 0 && (
            <div className="skill-section">
              <h3 className="skill-section-title">生态技能 ({ecoSkills.length})</h3>
              {ecoSkills.map(skill => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  selected={selectedSkill?.name === skill.name}
                  onClick={() => handleSelectSkill(skill)}
                />
              ))}
            </div>
          )}

          {filtered.length === 0 && !loading && (
            <div className="skill-empty">无匹配技能</div>
          )}
        </div>

        <div className="skill-detail">
          {selectedSkill ? (
            <div className="skill-detail-content">
              <h3>{selectedSkill.name}</h3>
              <p className="skill-desc">{selectedSkill.description}</p>

              <div className="skill-meta-badges">
                <span className="skill-badge">{selectedSkill.version}</span>
                <span className="skill-badge">
                  {CATEGORY_ICONS[selectedSkill.metadata?.rdkstudio?.category || ''] || '📦'}{' '}
                  {CATEGORY_LABELS[selectedSkill.metadata?.rdkstudio?.category || ''] || 'general'}
                </span>
                {selectedSkill.metadata?.rdkstudio?.tab && (
                  <span className="skill-badge">Tab: {selectedSkill.metadata.rdkstudio.tab}</span>
                )}
                {selectedSkill.metadata?.rdkstudio?.requires?.device && (
                  <span className="skill-badge caution">需要设备</span>
                )}
              </div>

              {selectedSkill.apis.length > 0 && (
                <div className="skill-apis">
                  <h4>APIs ({selectedSkill.apis.length})</h4>
                  {selectedSkill.apis.map((api, i) => (
                    <div key={i} className="skill-api-item">
                      <span className={`skill-api-method ${api.method.toLowerCase()}`}>{api.method}</span>
                      <span className="skill-api-path">{api.path}</span>
                      <span className="skill-api-name">{api.name}</span>
                      {api.caution && <span className="skill-api-caution">⚠️</span>}
                    </div>
                  ))}
                </div>
              )}

              {selectedSkill.clientActions.length > 0 && (
                <div className="skill-actions-list">
                  <h4>Client Actions</h4>
                  {selectedSkill.clientActions.map((a, i) => (
                    <code key={i} className="skill-action-code">{a}</code>
                  ))}
                </div>
              )}

              {skillMd && (
                <details className="skill-md-raw">
                  <summary>SKILL.md 原文</summary>
                  <pre>{skillMd}</pre>
                </details>
              )}
            </div>
          ) : (
            <div className="skill-detail-empty">
              <p>选择一个技能查看详情</p>
              <p className="skill-detail-hint">
                共 {skills.length} 个技能 ({skills.filter(s => !s.name.startsWith('eco-')).length} 内置 + {skills.filter(s => s.name.startsWith('eco-')).length} 生态)
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillCard({
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
    <div className={`skill-card ${selected ? 'selected' : ''} ${isEco ? 'eco' : ''}`} onClick={onClick}>
      <div className="skill-card-icon">{icon}</div>
      <div className="skill-card-info">
        <div className="skill-card-name">{skill.name}</div>
        <div className="skill-card-desc">{skill.description.slice(0, 80)}{skill.description.length > 80 ? '...' : ''}</div>
      </div>
      <div className="skill-card-meta">
        <span className="skill-card-apis">{skill.apis.length} APIs</span>
      </div>
    </div>
  );
}
