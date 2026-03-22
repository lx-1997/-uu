import React, { useEffect, useState, useCallback, useMemo } from 'react';
import type { SkillManifest } from '../skills/types';
import { fetchSkills, reloadSkills, fetchSkillMd } from '../skills/loader';
import { fetchRDKClawPolicy, saveRDKClawPolicy, type RDKClawPolicy } from '../api';
import { useAppState } from '../hooks/useAppState';

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
  const { setActiveTab, setShowSettings, setSettingsTab } = useAppState();
  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [workspaceTab, setWorkspaceTab] = useState<'catalog' | 'policy'>('catalog');
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

  const handleSelectSkill = (skill: SkillManifest) => {
    setSelectedSkillName(skill.name);
    setSkillMd(null);
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

  const categories = useMemo(
    () => [...new Set(skills.map((skill) => skill.metadata?.rdkstudio?.category || 'general'))],
    [skills],
  );

  const filtered = useMemo(() => skills.filter((skill) => {
    const cat = skill.metadata?.rdkstudio?.category || 'general';
    if (filter !== 'all' && cat !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q);
    }
    return true;
  }), [filter, search, skills]);

  const builtinSkills = useMemo(() => filtered.filter((skill) => !skill.name.startsWith('eco-')), [filtered]);
  const ecoSkills = useMemo(() => filtered.filter((skill) => skill.name.startsWith('eco-')), [filtered]);
  const deviceRequiredCount = useMemo(
    () => skills.filter((skill) => skill.metadata?.rdkstudio?.requires?.device).length,
    [skills],
  );
  const categorySummary = useMemo(
    () =>
      categories.map((cat) => ({
        key: cat,
        label: CATEGORY_LABELS[cat] || cat,
        icon: CATEGORY_ICONS[cat] || '📦',
        count: skills.filter((skill) => (skill.metadata?.rdkstudio?.category || 'general') === cat).length,
      })),
    [categories, skills],
  );

  const selectedSkill = useMemo(
    () => filtered.find((skill) => skill.name === selectedSkillName) ?? skills.find((skill) => skill.name === selectedSkillName) ?? filtered[0] ?? skills[0] ?? null,
    [filtered, selectedSkillName, skills],
  );

  useEffect(() => {
    if (selectedSkill && selectedSkill.name !== selectedSkillName) {
      setSelectedSkillName(selectedSkill.name);
    }
  }, [selectedSkill, selectedSkillName]);

  useEffect(() => {
    if (!selectedSkill) {
      setSkillMd(null);
      return;
    }
    fetchSkillMd(selectedSkill.name).then((md) => setSkillMd(md)).catch(() => setSkillMd(null));
  }, [selectedSkill]);

  const selectedCategory = selectedSkill?.metadata?.rdkstudio?.category || 'general';
  const selectedCategoryLabel = CATEGORY_LABELS[selectedCategory] || selectedCategory;
  const selectedCategoryIcon = CATEGORY_ICONS[selectedCategory] || '📦';
  const selectedRequires = selectedSkill?.metadata?.rdkstudio?.requires;
  const selectedServices = selectedRequires?.services || [];
  const summaryCards = [
    { label: '全部技能', value: String(skills.length), hint: '内置 + 生态能力总数' },
    { label: '设备相关', value: String(deviceRequiredCount), hint: '执行前需要设备在线' },
    { label: '生态技能', value: String(skills.filter((skill) => skill.name.startsWith('eco-')).length), hint: '来自生态目录的扩展能力' },
  ];

  const saveInfoText = policySavedAt
    ? `上次保存：${new Date(policySavedAt).toLocaleTimeString()}`
    : '尚未保存本次修改';

  const openFeishuSettings = () => {
    setSettingsTab('feishu');
    setShowSettings(true);
  };

  const openAiSettings = () => {
    setSettingsTab('ai');
    setShowSettings(true);
  };

  const policyOverview = policy ? [
    { title: '审批策略', value: policy.approval.mode, desc: `风险阈值 ${policy.approval.riskThreshold}` },
    { title: '委派策略', value: policy.delegation.strategy, desc: '决定优先本地还是板端能力' },
    { title: '联网能力', value: policy.network.enabled ? '已启用' : '未启用', desc: `抓取上限 ${policy.network.maxFetchChars} chars` },
    { title: '默认渠道', value: policy.scheduler.defaultChannel, desc: '定时任务与推送默认落点' },
  ] : [];

  const channelCards = [
    {
      title: 'Studio Chat',
      desc: '本地主会话，适合需要确认、文件与设备上下文的任务。',
      action: '回到工作台',
      onClick: () => setActiveTab('dashboard'),
    },
    {
      title: '飞书通道',
      desc: '适合外出时远程续接 Studio 会话，审批和镜像状态统一回流。',
      action: '打开飞书设置',
      onClick: openFeishuSettings,
    },
    {
      title: 'OpenClaw Runtime',
      desc: '统一查看模型、渠道、技能启用状态以及网关运行情况。',
      action: '打开 OpenClaw',
      onClick: () => setActiveTab('openclaw'),
    },
  ];

  return (
    <div className="skill-browser-v2 skill-hub-v3">
      <header className="skill-hub-hero">
        <div className="skill-hub-copy">
          <span className="skill-hub-kicker">AI Runtime Center</span>
          <h1 className="skill-hub-title">技能与策略中心</h1>
          <p className="skill-hub-subtitle">
            把技能目录、调用能力、审批边界、联网策略和渠道入口收束到一个界面里，
            让 RDKClaw 的“能做什么”和“应该怎么做”不再割裂。
          </p>
        </div>

        <div className="skill-hub-stat-grid">
          {summaryCards.map((card) => (
            <div key={card.label} className="skill-hub-stat-card">
              <span className="skill-hub-stat-label">{card.label}</span>
              <strong className="skill-hub-stat-value">{card.value}</strong>
              <span className="skill-hub-stat-hint">{card.hint}</span>
            </div>
          ))}
        </div>
      </header>

      <div className="skill-hub-toolbar">
        <div className="skill-hub-segments">
          <button
            type="button"
            className={`segment-btn ${workspaceTab === 'catalog' ? 'active' : ''}`}
            onClick={() => setWorkspaceTab('catalog')}
          >
            技能目录
          </button>
          <button
            type="button"
            className={`segment-btn ${workspaceTab === 'policy' ? 'active' : ''}`}
            onClick={() => setWorkspaceTab('policy')}
          >
            策略中心
          </button>
        </div>

        <div className="skill-v2-toolbar-actions">
          <input
            className="skill-v2-search"
            type="text"
            placeholder="搜索技能名称、说明或分类..."
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
          {workspaceTab === 'policy' && (
            <button className="skill-v2-btn primary" onClick={savePolicy} disabled={savingPolicy || !policy}>
              {savingPolicy ? '保存中...' : '保存策略'}
            </button>
          )}
        </div>
      </div>

      {workspaceTab === 'catalog' ? (
        <div className="skill-hub-layout">
          <aside className="skill-v2-nav skill-hub-sidebar">
            <div className="skill-v2-nav-head">
              <span>当前结果</span>
              <strong>{filtered.length}</strong>
            </div>

            <section className="skill-v2-group skill-hub-categories">
              <h3>分类视图</h3>
              <div className="skill-hub-category-pills">
                <button
                  type="button"
                  className={`skill-hub-category-pill ${filter === 'all' ? 'active' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  全部
                </button>
                {categorySummary.map((category) => (
                  <button
                    key={category.key}
                    type="button"
                    className={`skill-hub-category-pill ${filter === category.key ? 'active' : ''}`}
                    onClick={() => setFilter(category.key)}
                  >
                    <span>{category.icon}</span>
                    <span>{category.label}</span>
                    <strong>{category.count}</strong>
                  </button>
                ))}
              </div>
            </section>

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

          <main className="skill-v2-main skill-hub-detail">
            {!selectedSkill && (
              <div className="skill-v2-placeholder">
                <p>选择左侧一个技能查看详情</p>
                <p>当前共 {skills.length} 个技能，目录和策略都可以在这里统一管理。</p>
              </div>
            )}

            {selectedSkill && (
              <>
                <section className="skill-v2-card skill-detail-hero-card">
                  <div className="skill-detail-hero">
                    <div>
                      <div className="skill-detail-kicker">Skill Detail</div>
                      <h3>{selectedSkill.name}</h3>
                      <p className="skill-v2-desc">{selectedSkill.description}</p>
                    </div>
                    <div className="skill-v2-badges">
                      <span className="skill-v2-badge">{selectedSkill.version}</span>
                      <span className="skill-v2-badge">{selectedCategoryIcon} {selectedCategoryLabel}</span>
                      <span className="skill-v2-badge">APIs {selectedSkill.apis.length}</span>
                      {selectedSkill.metadata?.rdkstudio?.tab && <span className="skill-v2-badge">入口 {selectedSkill.metadata.rdkstudio.tab}</span>}
                      {selectedRequires?.device && <span className="skill-v2-badge warning">需要设备在线</span>}
                    </div>
                  </div>
                </section>

                <section className="skill-v2-policy-grid skill-detail-grid">
                  <div className="skill-v2-card">
                    <h3>能力画像</h3>
                    <div className="skill-hub-meta-list">
                      <div className="skill-hub-meta-item">
                        <span>文件路径</span>
                        <strong>{selectedSkill.filePath || '未声明'}</strong>
                      </div>
                      <div className="skill-hub-meta-item">
                        <span>默认入口</span>
                        <strong>{selectedSkill.metadata?.rdkstudio?.tab || '无指定入口'}</strong>
                      </div>
                      <div className="skill-hub-meta-item">
                        <span>设备依赖</span>
                        <strong>{selectedRequires?.device ? '需要设备' : '纯本地/服务端能力'}</strong>
                      </div>
                      <div className="skill-hub-meta-item">
                        <span>服务依赖</span>
                        <strong>{selectedServices.length > 0 ? selectedServices.join(' / ') : '未声明'}</strong>
                      </div>
                    </div>

                    {selectedSkill.clientActions.length > 0 && (
                      <>
                        <h4 className="skill-hub-subsection-title">客户端动作</h4>
                        <div className="skill-v2-chip-list">
                          {selectedSkill.clientActions.map((action, index) => (
                            <code className="skill-v2-chip" key={`${action}-${index}`}>{action}</code>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="skill-v2-card">
                    <h3>API 列表</h3>
                    {selectedSkill.apis.length === 0 ? (
                      <p className="skill-v2-desc">该技能暂未声明 API。</p>
                    ) : (
                      <div className="skill-v2-api-list">
                        {selectedSkill.apis.map((api, index) => (
                          <div key={`${api.path}-${index}`} className="skill-v2-api-row">
                            <span className={`skill-api-method ${api.method.toLowerCase()}`}>{api.method}</span>
                            <span className="skill-api-path">{api.path}</span>
                            <span className="skill-api-name">{api.name}</span>
                            {api.caution && <span className="skill-api-caution">⚠ {api.caution}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="skill-v2-card">
                    <h3>SKILL.md 原文</h3>
                    <pre className="skill-v2-raw">{skillMd || '正在读取技能说明...'}</pre>
                  </div>
                </section>
              </>
            )}
          </main>
        </div>
      ) : (
        <div className="skill-policy-view">
          {policy && (
            <>
              <section className="skill-policy-overview">
                {policyOverview.map((item) => (
                  <div key={item.title} className="skill-policy-overview-card">
                    <span>{item.title}</span>
                    <strong>{item.value}</strong>
                    <small>{item.desc}</small>
                  </div>
                ))}
              </section>

              <section className="skill-v2-policy-grid skill-policy-grid-v3">
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
                  <p className="skill-v2-desc">
                    这决定 RDKClaw 在 Studio 主会话和共享通道里分别能读取哪些长期上下文。
                  </p>
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
                  <p className="skill-v2-desc">
                    定时任务、提醒和后台自主运行默认会把结果发送到这里。
                  </p>
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
                    联网默认走审批
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

                <div className="skill-v2-card skill-channel-card">
                  <h3>渠道与运行入口</h3>
                  <div className="skill-channel-stack">
                    {channelCards.map((card) => (
                      <button key={card.title} type="button" className="skill-channel-link" onClick={card.onClick}>
                        <div>
                          <strong>{card.title}</strong>
                          <span>{card.desc}</span>
                        </div>
                        <span>{card.action}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="skill-v2-card skill-channel-card">
                  <h3>Provider / 模型配置</h3>
                  <p className="skill-v2-desc">
                    Studio 主助手的模型供应商和 OpenClaw 网关配置分离管理，避免“本地聊天模型”和“板端代理模型”相互覆盖。
                  </p>
                  <div className="skill-channel-stack">
                    <button type="button" className="skill-channel-link" onClick={openAiSettings}>
                      <div>
                        <strong>Studio AI 配置</strong>
                        <span>设置当前聊天模型、API Key 与兼容 Base URL。</span>
                      </div>
                      <span>打开 AI 设置</span>
                    </button>
                    <button type="button" className="skill-channel-link" onClick={() => setActiveTab('openclaw')}>
                      <div>
                        <strong>OpenClaw Runtime</strong>
                        <span>查看网关模型、插件和飞书运行状态。</span>
                      </div>
                      <span>打开 OpenClaw</span>
                    </button>
                  </div>
                </div>

                <div className="skill-v2-policy-footer">
                  <button className="skill-v2-btn primary" onClick={savePolicy} disabled={savingPolicy}>
                    {savingPolicy ? '保存中...' : '保存策略'}
                  </button>
                  <span className="skill-v2-save-info">{saveInfoText}</span>
                </div>
              </section>
            </>
          )}
        </div>
      )}
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
