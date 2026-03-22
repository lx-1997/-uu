import { useEffect, useState, useCallback, useMemo } from 'react';
import type { SkillManifest } from '../skills/types';
import { fetchSkills, reloadSkills, fetchSkillMd } from '../skills/loader';
import { useAppState } from '../hooks/useAppState';

interface EcoSkill {
  id: string;
  source: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  platforms: string[];
  installCmd: string;
  runCmd: string;
  stopCmd?: string;
  uninstallCmd?: string;
  boardStatusByDevice: Record<string, { installed: boolean; running: boolean }>;
}

const SOURCE_LABELS: Record<string, string> = {
  nodehub: 'NodeHub',
  modelzoo: 'ModelZoo',
  tros: 'TROS',
  openclaw_skill: 'OpenClaw',
};

const CATEGORY_LABELS: Record<string, string> = {
  all: '全部',
  system: '系统',
  development: '开发',
  ai: 'AI',
  robotics: '机器人',
  monitoring: '监控',
  remote: '远程',
  general: '通用',
};

const CREATE_PROMPTS = [
  {
    title: '从 NodeHub 应用创建',
    desc: '把一个 NodeHub 应用变成板端 OpenClaw 可调用的技能',
    prompt: '我想把一个 NodeHub 应用制作成板端 OpenClaw 技能。请先问我应用名称或 NodeHub 链接，然后帮我：1) 分析应用的安装/运行/停止命令 2) 生成高质量的 SKILL.md（包含 trigger、risk、执行策略、前置条件）3) 安装到板端 /opt/openclaw/skills/ 目录',
  },
  {
    title: '从 ModelZoo 模型创建',
    desc: '把一个 AI 模型变成板端可调用的推理技能',
    prompt: '我想把一个 ModelZoo 模型制作成板端 OpenClaw 技能。请先问我模型名称或链接，然后帮我：1) 分析模型的部署/推理/停止命令 2) 生成高质量的 SKILL.md（包含 trigger、risk、执行策略、硬件要求）3) 安装到板端 /opt/openclaw/skills/ 目录',
  },
  {
    title: '自定义技能',
    desc: '从零开始描述一个能力，RDKClaw 帮你生成 SKILL.md',
    prompt: '我想制作一个自定义的板端 OpenClaw 技能。请引导我完成以下步骤：1) 确认技能名称和用途 2) 确认安装依赖、运行命令、停止命令 3) 生成完整的 SKILL.md（参考 RDK Board Delegate 的格式，包含 trigger、risk、permissions、delegate_preference、执行策略、质量要求）4) 安装到板端',
  },
  {
    title: '从 URL 学习并创建',
    desc: '给 RDKClaw 一个文档/仓库链接，自动分析并生成技能',
    prompt: '我想从一个网页/文档/GitHub 仓库链接创建板端 OpenClaw 技能。我会给你链接，请你：1) 抓取并分析页面内容 2) 提取安装步骤、运行方式、依赖要求 3) 生成高质量的 SKILL.md 4) 安装到板端。请问链接是什么？',
  },
];

export default function SkillBrowser() {
  const { currentDevice, addToast, setCmd, setChatExpanded } = useAppState();

  const [rdkSkills, setRdkSkills] = useState<SkillManifest[]>([]);
  const [ecoSkills, setEcoSkills] = useState<EcoSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionOutput, setActionOutput] = useState('');

  const loadRdkSkills = useCallback(async () => {
    setLoading(true);
    const data = await fetchSkills();
    setRdkSkills(data);
    setLoading(false);
  }, []);

  const loadEcoSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/ecosystem/search?q=');
      if (!res.ok) return;
      const data = await res.json();
      setEcoSkills(data.skills || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadRdkSkills(); loadEcoSkills(); }, [loadRdkSkills, loadEcoSkills]);

  const handleReload = async () => {
    setLoading(true);
    const data = await reloadSkills();
    setRdkSkills(data);
    await loadEcoSkills();
    setLoading(false);
  };

  type UnifiedSkill = {
    id: string;
    name: string;
    description: string;
    category: string;
    source: 'builtin' | 'eco';
    ecoSource?: string;
    isEco: boolean;
    boardInstalled: boolean;
    boardRunning: boolean;
    raw: SkillManifest | EcoSkill;
  };

  const allSkills: UnifiedSkill[] = useMemo(() => {
    const result: UnifiedSkill[] = [];
    for (const s of rdkSkills) {
      if (s.name.startsWith('eco-')) continue;
      result.push({
        id: `rdk:${s.name}`,
        name: s.name,
        description: s.description,
        category: s.metadata?.rdkstudio?.category || 'general',
        source: 'builtin',
        isEco: false,
        boardInstalled: false,
        boardRunning: false,
        raw: s,
      });
    }
    for (const s of ecoSkills) {
      const deviceId = currentDevice?.id || '';
      const bs = s.boardStatusByDevice?.[deviceId];
      result.push({
        id: `eco:${s.id}`,
        name: s.name,
        description: s.description,
        category: s.category,
        source: 'eco',
        ecoSource: s.source,
        isEco: true,
        boardInstalled: !!bs?.installed,
        boardRunning: !!bs?.running,
        raw: s,
      });
    }
    return result;
  }, [rdkSkills, ecoSkills, currentDevice]);

  const filtered = useMemo(() => allSkills.filter((s) => {
    if (filter !== 'all') {
      if (filter === 'nodehub' || filter === 'modelzoo' || filter === 'tros') {
        if (s.ecoSource !== filter) return false;
      } else if (filter === 'builtin') {
        if (s.isEco) return false;
      } else {
        if (s.category !== filter) return false;
      }
    }
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    }
    return true;
  }), [allSkills, filter, search]);

  const selected = useMemo(() => {
    if (!selectedId) return filtered[0] || null;
    return allSkills.find((s) => s.id === selectedId) || filtered[0] || null;
  }, [allSkills, filtered, selectedId]);

  useEffect(() => {
    if (!selected) { setSkillMd(null); return; }
    if (!selected.isEco) {
      fetchSkillMd(selected.name).then(setSkillMd).catch(() => setSkillMd(null));
    } else {
      setSkillMd(null);
    }
  }, [selected]);

  const runEcoAction = async (action: string, skillId: string) => {
    if (!currentDevice) { addToast?.('请先连接设备', 'warning'); return; }
    setActionLoading(action);
    setActionOutput('');
    try {
      const res = await fetch(`/api/ecosystem/skills/${encodeURIComponent(skillId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: currentDevice.id }),
      });
      const data = await res.json();
      setActionOutput(data.output || data.message || JSON.stringify(data, null, 2));
      if (data.ok || data.message) addToast?.(`${action} 成功`, 'success');
      else addToast?.(`${action} 可能失败`, 'warning');
      setTimeout(loadEcoSkills, 2000);
    } catch (err: any) {
      setActionOutput(`错误: ${err.message}`);
      addToast?.(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const startCreateDialog = (prompt: string) => {
    setCmd(prompt);
    setChatExpanded(true);
  };

  const builtinCount = allSkills.filter((s) => !s.isEco).length;
  const ecoCount = allSkills.filter((s) => s.isEco).length;

  return (
    <div className="config-page" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong style={{ fontSize: '1rem' }}>RDKClaw 技能</strong>
          <span className="badge badge-muted">{builtinCount} 内置</span>
          <span className="badge badge-muted">{ecoCount} 生态</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleReload} disabled={loading}>{loading ? '...' : '刷新'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left: Skill List */}
        <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索技能..." style={{ fontSize: '0.8125rem' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {['all', 'builtin', 'nodehub', 'modelzoo', 'system', 'ai', 'development'].map((f) => (
                <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)} style={{ fontSize: '0.5625rem', padding: '2px 5px' }}>
                  {f === 'all' ? '全部' : f === 'builtin' ? '内置' : CATEGORY_LABELS[f] || SOURCE_LABELS[f] || f}
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>无匹配技能</div>
            )}
            {filtered.map((s) => (
              <button
                key={s.id}
                className={`config-sidebar-item ${selected?.id === s.id ? 'active' : ''}`}
                onClick={() => setSelectedId(s.id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 12px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
                  <strong style={{ fontSize: '0.75rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</strong>
                  {s.isEco && s.ecoSource && <span className="badge badge-muted" style={{ fontSize: '0.5rem' }}>{SOURCE_LABELS[s.ecoSource] || s.ecoSource}</span>}
                  {!s.isEco && <span className="badge badge-muted" style={{ fontSize: '0.5rem' }}>内置</span>}
                  {s.boardInstalled && <span className="badge badge-ok" style={{ fontSize: '0.5rem' }}>板端</span>}
                </div>
                <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{s.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Detail + Create */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Create Skill Section */}
            <div style={{ background: 'var(--accent-subtle)', borderRadius: 'var(--radius-md)', padding: '16px', border: '1px solid var(--accent-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <strong style={{ fontSize: '0.875rem' }}>通过对话制作技能</strong>
                <span className="badge badge-accent">AI 驱动</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                告诉 RDKClaw 你想要什么能力，它会分析需求、生成高质量的 SKILL.md（包含触发词、风险等级、执行策略、前置条件），并安装到板端。
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {CREATE_PROMPTS.map((p) => (
                  <button
                    key={p.title}
                    className="config-card"
                    onClick={() => startCreateDialog(p.prompt)}
                    style={{ textAlign: 'left', padding: '10px 12px' }}
                  >
                    <strong style={{ fontSize: '0.75rem', display: 'block', marginBottom: 4 }}>{p.title}</strong>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{p.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Skill Detail */}
            {selected && (
              <>
                <div className="divider" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: '0.9375rem' }}>{selected.name}</h3>
                  {selected.isEco && selected.ecoSource && <span className="badge badge-accent">{SOURCE_LABELS[selected.ecoSource] || selected.ecoSource}</span>}
                  <span className="badge badge-muted">{CATEGORY_LABELS[selected.category] || selected.category}</span>
                  {selected.boardInstalled && <span className="badge badge-ok">板端已安装</span>}
                  {selected.boardRunning && <span className="badge badge-accent">运行中</span>}
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>{selected.description}</p>

                {/* Eco skill actions */}
                {selected.isEco && currentDevice && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => runEcoAction('provision', (selected.raw as EcoSkill).id)} disabled={!!actionLoading}>
                      {actionLoading === 'provision' ? '...' : '注册为 OpenClaw Skill'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => runEcoAction('install', (selected.raw as EcoSkill).id)} disabled={!!actionLoading}>
                      {actionLoading === 'install' ? '...' : '安装'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => runEcoAction('run', (selected.raw as EcoSkill).id)} disabled={!!actionLoading}>
                      {actionLoading === 'run' ? '...' : '运行'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => runEcoAction('stop', (selected.raw as EcoSkill).id)} disabled={!!actionLoading}>
                      {actionLoading === 'stop' ? '...' : '停止'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => runEcoAction('deprovision', (selected.raw as EcoSkill).id)} disabled={!!actionLoading} style={{ color: 'var(--danger)' }}>
                      {actionLoading === 'deprovision' ? '...' : '移除'}
                    </button>
                  </div>
                )}

                {/* Eco skill commands */}
                {selected.isEco && (
                  <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--bg-secondary)', padding: '8px 10px', borderRadius: 'var(--radius-xs)' }}>
                    {(selected.raw as EcoSkill).installCmd && <div><span style={{ color: 'var(--text-muted)' }}>install:</span> {(selected.raw as EcoSkill).installCmd}</div>}
                    <div><span style={{ color: 'var(--text-muted)' }}>run:</span> {(selected.raw as EcoSkill).runCmd}</div>
                    {(selected.raw as EcoSkill).stopCmd && <div><span style={{ color: 'var(--text-muted)' }}>stop:</span> {(selected.raw as EcoSkill).stopCmd}</div>}
                  </div>
                )}

                {/* Builtin skill APIs */}
                {!selected.isEco && (selected.raw as SkillManifest).apis.length > 0 && (
                  <>
                    <div className="section-label">API</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {(selected.raw as SkillManifest).apis.map((api) => (
                        <div key={api.name} style={{ display: 'flex', gap: 6, fontSize: '0.6875rem', fontFamily: 'var(--font-mono)' }}>
                          <span className="badge badge-muted" style={{ fontSize: '0.5625rem' }}>{api.method}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{api.path}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Action output */}
                {actionOutput && (
                  <div className="config-terminal" style={{ maxHeight: 180 }}>
                    <pre style={{ margin: 0 }}>{actionOutput}</pre>
                  </div>
                )}

                {/* SKILL.md content */}
                {skillMd && (
                  <>
                    <div className="section-label">SKILL.md</div>
                    <div className="config-terminal" style={{ maxHeight: 300 }}>
                      <pre style={{ margin: 0 }}>{skillMd}</pre>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
