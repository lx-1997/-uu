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
    <div className="config-page">
      <div className="grid-3">
        {summaryCards.map((card) => (
          <div key={card.label} className="card card-compact">
            <span className="config-label">{card.label}</span>
            <strong className="config-value">{card.value}</strong>
          </div>
        ))}
      </div>

      <div className="config-section">
        <div className="config-tabs">
          <button
            type="button"
            className={`config-tab ${workspaceTab === 'catalog' ? 'active' : ''}`}
            onClick={() => setWorkspaceTab('catalog')}
          >
            技能目录
          </button>
          <button
            type="button"
            className={`config-tab ${workspaceTab === 'policy' ? 'active' : ''}`}
            onClick={() => setWorkspaceTab('policy')}
          >
            策略中心
          </button>
        </div>

        <div className="config-actions">
          <input
            className="input"
            type="text"
            placeholder="搜索技能..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
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
          <button className="btn btn-ghost btn-sm" onClick={handleReload} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </button>
          {workspaceTab === 'policy' && (
            <button className="btn btn-primary btn-sm" onClick={savePolicy} disabled={savingPolicy || !policy}>
              {savingPolicy ? '保存中...' : '保存策略'}
            </button>
          )}
        </div>
      </div>

      {workspaceTab === 'catalog' ? (
        <div className="config-split">
          <aside className="config-sidebar">
            <div className="config-row">
              <span className="config-label">当前结果</span>
              <strong className="config-value">{filtered.length}</strong>
            </div>

            <section className="config-section">
              <h3 className="config-section-title">分类</h3>
              <div className="config-actions">
                <button
                  type="button"
                  className={`chip ${filter === 'all' ? 'active' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  全部
                </button>
                {categorySummary.map((category) => (
                  <button
                    key={category.key}
                    type="button"
                    className={`chip ${filter === category.key ? 'active' : ''}`}
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
              <section className="config-section">
                <h3 className="config-section-title">内置 · {builtinSkills.length}</h3>
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
              <section className="config-section">
                <h3 className="config-section-title">生态 · {ecoSkills.length}</h3>
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

            {filtered.length === 0 && !loading && <div className="badge badge-muted">无匹配技能</div>}
          </aside>

          <main className="config-detail">
            {!selectedSkill && (
              <div className="config-section">
                <span className="config-label">选择技能查看详情</span>
              </div>
            )}

            {selectedSkill && (
              <>
                <section className="config-card">
                  <div className="config-card-head">
                    <div>
                      <h3>{selectedSkill.name}</h3>
                      <span className="config-label">{selectedSkill.description}</span>
                    </div>
                    <div className="config-actions">
                      <span className="badge badge-muted">{selectedSkill.version}</span>
                      <span className="badge badge-muted">{selectedCategoryIcon} {selectedCategoryLabel}</span>
                      <span className="badge badge-accent">APIs {selectedSkill.apis.length}</span>
                      {selectedSkill.metadata?.rdkstudio?.tab && <span className="badge badge-ok">入口 {selectedSkill.metadata.rdkstudio.tab}</span>}
                      {selectedRequires?.device && <span className="badge badge-warn">需要设备在线</span>}
                    </div>
                  </div>
                </section>

                <section className="config-grid">
                  <div className="config-card">
                    <h3 className="config-section-title">能力画像</h3>
                    <div>
                      <div className="config-row">
                        <span className="config-label">文件路径</span>
                        <strong className="config-value">{selectedSkill.filePath || '未声明'}</strong>
                      </div>
                      <div className="config-row">
                        <span className="config-label">默认入口</span>
                        <strong className="config-value">{selectedSkill.metadata?.rdkstudio?.tab || '无'}</strong>
                      </div>
                      <div className="config-row">
                        <span className="config-label">设备依赖</span>
                        <strong className="config-value">{selectedRequires?.device ? '需要设备' : '无'}</strong>
                      </div>
                      <div className="config-row">
                        <span className="config-label">服务依赖</span>
                        <strong className="config-value">{selectedServices.length > 0 ? selectedServices.join(' / ') : '无'}</strong>
                      </div>
                    </div>

                    {selectedSkill.clientActions.length > 0 && (
                      <>
                        <h4 className="config-section-title">客户端动作</h4>
                        <div className="config-actions">
                          {selectedSkill.clientActions.map((action, index) => (
                            <code className="chip" key={`${action}-${index}`}>{action}</code>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="config-card">
                    <h3 className="config-section-title">API 列表</h3>
                    {selectedSkill.apis.length === 0 ? (
                      <span className="config-label">暂无 API</span>
                    ) : (
                      <div>
                        {selectedSkill.apis.map((api, index) => (
                          <div key={`${api.path}-${index}`} className="config-row">
                            <span className={`badge badge-muted ${api.method.toLowerCase()}`}>{api.method}</span>
                            <span className="config-value">{api.path}</span>
                            <span className="config-label">{api.name}</span>
                            {api.caution && <span className="badge badge-warn">⚠ {api.caution}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="config-card">
                    <h3 className="config-section-title">SKILL.md</h3>
                    <pre className="config-terminal">{skillMd || '加载中...'}</pre>
                  </div>
                </section>
              </>
            )}
          </main>
        </div>
      ) : (
        <div className="config-section">
          {policy && (
            <>
              <section className="grid-3">
                {policyOverview.map((item) => (
                  <div key={item.title} className="card card-compact">
                    <span className="config-label">{item.title}</span>
                    <strong className="config-value">{item.value}</strong>
                  </div>
                ))}
              </section>

              <section className="config-grid">
                <div className="config-card">
                  <h3 className="config-section-title">人格 / 记忆边界</h3>
                  <label className="config-row">
                    <input
                      type="checkbox"
                      checked={policy.memory.mainSessionReadsMemory}
                      onChange={(e) => setPolicy({ ...policy, memory: { ...policy.memory, mainSessionReadsMemory: e.target.checked } })}
                    />
                    主会话读取 MEMORY
                  </label>
                  <label className="config-row">
                    <input
                      type="checkbox"
                      checked={policy.memory.sharedSessionBlocksMemory}
                      onChange={(e) => setPolicy({ ...policy, memory: { ...policy.memory, sharedSessionBlocksMemory: e.target.checked } })}
                    />
                    共享会话屏蔽 MEMORY
                  </label>
                </div>

                <div className="config-card">
                  <h3 className="config-section-title">委派 / 审批</h3>
                  <div className="config-row">
                    <span className="config-label">委派策略</span>
                    <select className="config-value" title="委派策略" aria-label="委派策略" value={policy.delegation.strategy} onChange={(e) => setPolicy({ ...policy, delegation: { ...policy.delegation, strategy: e.target.value as RDKClawPolicy['delegation']['strategy'] } })}>
                      <option value="local-first">local-first</option>
                      <option value="board-first">board-first</option>
                      <option value="hybrid">hybrid</option>
                    </select>
                  </div>
                  <div className="config-row">
                    <span className="config-label">审批模式</span>
                    <select className="config-value" title="审批模式" aria-label="审批模式" value={policy.approval.mode} onChange={(e) => setPolicy({ ...policy, approval: { ...policy.approval, mode: e.target.value as RDKClawPolicy['approval']['mode'] } })}>
                      <option value="always">always</option>
                      <option value="risk-based">risk-based</option>
                      <option value="auto">auto</option>
                    </select>
                  </div>
                  <div className="config-row">
                    <span className="config-label">风险阈值</span>
                    <select className="config-value" title="风险阈值" aria-label="风险阈值" value={policy.approval.riskThreshold} onChange={(e) => setPolicy({ ...policy, approval: { ...policy.approval, riskThreshold: e.target.value as RDKClawPolicy['approval']['riskThreshold'] } })}>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </div>
                </div>

                <div className="config-card">
                  <h3 className="config-section-title">定时 / 推送</h3>
                  <div className="config-row">
                    <span className="config-label">默认推送渠道</span>
                    <select className="config-value" title="默认推送渠道" aria-label="默认推送渠道" value={policy.scheduler.defaultChannel} onChange={(e) => setPolicy({ ...policy, scheduler: { ...policy.scheduler, defaultChannel: e.target.value as RDKClawPolicy['scheduler']['defaultChannel'] } })}>
                      <option value="chat">chat</option>
                      <option value="feishu">feishu</option>
                    </select>
                  </div>
                </div>

                <div className="config-card">
                  <h3 className="config-section-title">联网能力</h3>
                  <label className="config-row">
                    <input
                      type="checkbox"
                      checked={policy.network.enabled}
                      onChange={(e) => setPolicy({ ...policy, network: { ...policy.network, enabled: e.target.checked } })}
                    />
                    启用联网工具
                  </label>
                  <label className="config-row">
                    <input
                      type="checkbox"
                      checked={policy.network.requireApproval}
                      onChange={(e) => setPolicy({ ...policy, network: { ...policy.network, requireApproval: e.target.checked } })}
                    />
                    联网走审批
                  </label>
                  <div className="config-row">
                    <span className="config-label">单次抓取上限</span>
                    <input
                      className="config-value"
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

                <div className="config-card">
                  <h3 className="config-section-title">渠道入口</h3>
                  <div className="config-section">
                    {channelCards.map((card) => (
                      <button key={card.title} type="button" className="btn btn-ghost btn-sm" onClick={card.onClick}>
                        <strong>{card.title}</strong>
                        <span>{card.action}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="config-card">
                  <h3 className="config-section-title">Provider / 模型</h3>
                  <div className="config-section">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={openAiSettings}>
                      <strong>Studio AI 配置</strong>
                      <span>打开 AI 设置</span>
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveTab('openclaw')}>
                      <strong>OpenClaw Runtime</strong>
                      <span>打开 OpenClaw</span>
                    </button>
                  </div>
                </div>

                <div className="config-actions">
                  <button className="btn btn-primary" onClick={savePolicy} disabled={savingPolicy}>
                    {savingPolicy ? '保存中...' : '保存策略'}
                  </button>
                  <span className="badge badge-muted">{saveInfoText}</span>
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
    <button type="button" className={`config-sidebar-item ${selected ? 'active' : ''} ${isEco ? 'eco' : ''}`} onClick={onClick}>
      <div className="config-card-icon">{icon}</div>
      <div>
        <div className="config-card-name">{skill.name}</div>
        <div className="config-label">{skill.description.slice(0, 72)}{skill.description.length > 72 ? '...' : ''}</div>
      </div>
      <div>
        <span className="badge badge-muted">{skill.apis.length} APIs</span>
      </div>
    </button>
  );
}
