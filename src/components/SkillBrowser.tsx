import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppState } from '../hooks/useAppState';
import { fetchDeviceOpenClawHealth } from '../api';
import { resolveApiUrl } from '../utils/apiBase';

interface OpenClawSkillsPayload {
  ok?: boolean;
  skills?: string[];
}

type SourceKind = 'github' | 'nodehub' | 'web';

function looksLikeHttpUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function detectSourceKind(rawUrl: string): SourceKind {
  try {
    const u = new URL(rawUrl.trim());
    const host = u.hostname.toLowerCase();
    if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
    if (host.includes('nodehub') || host.includes('d-robotics.cc')) return 'nodehub';
    return 'web';
  } catch {
    return 'web';
  }
}

function getSourceKindLabel(kind: SourceKind): string {
  if (kind === 'github') return 'GitHub';
  if (kind === 'nodehub') return 'NodeHub';
  return '普通网页';
}

function buildQualityPromptBySource(
  kind: SourceKind,
  url: string,
  goal: string,
  deviceHint: string,
): string {
  const skillTemplate = [
    'SKILL.md 模板（必须严格遵循）：',
    '---',
    'name: <skill-name>',
    'description: "<一句话描述边界>"',
    'version: 1.0.0',
    'trigger: <逗号分隔关键词，含中英文>',
    'risk: low|medium|high',
    'permissions: <最小必要权限，逗号分隔>',
    'delegate_preference: local|board|hybrid',
    'requires_board: true|false',
    'approval_level: none|auto|confirm|strict',
    '---',
    '# <标题>',
    '## 场景',
    '## 执行流程（3-6步，动作句）',
    '## 失败回退',
    '## 验证步骤',
  ].join('\n');

  const common = [
    '通用质量要求：',
    '1) 必须给出可执行命令，不允许只给概念描述。',
    '2) 若关键信息缺失，必须明确列出“缺失项 + 风险 + 建议补充”。',
    '3) 必须输出完整 SKILL.md（name/description/trigger/risk/permissions/delegate_preference/approval_level）。',
    '4) 给出推荐 skillId 与 slug，并说明命名依据。',
    `5) 目标设备：${deviceHint}`,
    '6) 若设备在线：执行安装与验证；若不在线：输出一键安装命令与验证命令。',
    '7) 最终输出结构：A. 信息来源摘要 B. 生成的 SKILL.md C. 安装/验证步骤 D. 风险与回滚方案。',
    '必须进行三轮自检验证：格式、可执行性、可用性。',
    skillTemplate,
  ];

  if (kind === 'github') {
    return [
      '这是 GitHub 仓库链接，请按“代码仓库技能化”流程执行。',
      `链接: ${url}`,
      `目标: ${goal}`,
      'GitHub 专项要求：README/依赖文件/构建与运行拆分/版本锁定建议。',
      ...common,
    ].join('\n');
  }
  if (kind === 'nodehub') {
    return [
      '这是 NodeHub 链接，请按“应用页面技能化”流程执行。',
      `链接: ${url}`,
      `目标: ${goal}`,
      'NodeHub 专项要求：应用ID、安装/运行/停止、配置项、资源占用与长期驻留判断。',
      ...common,
    ].join('\n');
  }
  return [
    '这是普通网页链接，请按“文档到技能”流程执行。',
    `链接: ${url}`,
    `目标: ${goal}`,
    '网页专项要求：抓取正文 + 抽取要点 + 至少一个来源交叉验证。',
    ...common,
  ].join('\n');
}

export default function SkillBrowser() {
  const { currentDevice, addToast, setCmd, setChatExpanded } = useAppState();

  const [loading, setLoading] = useState(true);
  const [boardSkills, setBoardSkills] = useState<string[]>([]);
  const [openclawHealth, setOpenclawHealth] = useState<{ installed: boolean; gatewayRunning: boolean; aiReady: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [selectedBoardSkill, setSelectedBoardSkill] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState('');
  const [skillContentPath, setSkillContentPath] = useState('');
  const [skillContentLoading, setSkillContentLoading] = useState(false);

  const [sourceUrl, setSourceUrl] = useState('');
  const [skillGoal, setSkillGoal] = useState('');

  const loadBoardSkills = useCallback(async () => {
    if (!currentDevice) {
      setBoardSkills([]);
      setOpenclawHealth(null);
      return;
    }
    try {
      const [skillsRes, healthRes] = await Promise.all([
        fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/skills`)),
        fetchDeviceOpenClawHealth(currentDevice.id),
      ]);
      if (skillsRes.ok) {
        const payload = await skillsRes.json() as OpenClawSkillsPayload;
        setBoardSkills(payload.ok ? (payload.skills || []) : []);
      } else {
        setBoardSkills([]);
      }
      setOpenclawHealth({
        installed: !!healthRes.status?.installed,
        gatewayRunning: !!healthRes.status?.gatewayRunning,
        aiReady: !!healthRes.status?.aiReady,
      });
    } catch {
      setBoardSkills([]);
      setOpenclawHealth(null);
    }
  }, [currentDevice]);

  const loadSkillContent = useCallback(async (skillId: string) => {
    if (!currentDevice || !skillId) return;
    setSkillContentLoading(true);
    setSkillContent('');
    setSkillContentPath('');
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/skill-content?skillId=${encodeURIComponent(skillId)}`));
      const data = await res.json() as { ok?: boolean; content?: string; path?: string; error?: string };
      if (!res.ok || !data.ok) {
        setSkillContent(data.error || `无法读取该技能内容（HTTP ${res.status}）`);
      } else {
        setSkillContent(data.content || '(空内容)');
        setSkillContentPath(data.path || '');
      }
    } catch (e: any) {
      setSkillContent(`读取失败: ${e?.message || '网络错误'}`);
    } finally {
      setSkillContentLoading(false);
    }
  }, [currentDevice]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      await loadBoardSkills();
      setLoading(false);
    };
    run();
  }, [loadBoardSkills]);

  useEffect(() => {
    if (boardSkills.length === 0) {
      setSelectedBoardSkill(null);
      setSkillContent('');
      setSkillContentPath('');
      return;
    }
    if (!selectedBoardSkill || !boardSkills.includes(selectedBoardSkill)) {
      setSelectedBoardSkill(boardSkills[0]);
    }
  }, [boardSkills, selectedBoardSkill]);

  useEffect(() => {
    if (selectedBoardSkill) void loadSkillContent(selectedBoardSkill.split('|')[0]);
  }, [selectedBoardSkill, loadSkillContent]);

  const filteredBoardSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boardSkills;
    return boardSkills.filter((s) => s.toLowerCase().includes(q));
  }, [boardSkills, search]);

  const sourceKind = useMemo(() => (looksLikeHttpUrl(sourceUrl) ? detectSourceKind(sourceUrl) : null), [sourceUrl]);

  const startCreateDialog = (prompt: string) => {
    setCmd(prompt);
    setChatExpanded(true);
  };

  const startUrlBasedSkillCreate = () => {
    const url = sourceUrl.trim();
    if (!url) return addToast?.('请先输入链接', 'warning');
    if (!looksLikeHttpUrl(url)) return addToast?.('请输入有效的 http/https 链接', 'warning');
    const goal = skillGoal.trim() || '将该链接内容转化为通用可复用的 OpenClaw 技能';
    const prompt = buildQualityPromptBySource(
      detectSourceKind(url),
      url,
      goal,
      currentDevice ? `${currentDevice.name} (${currentDevice.id})` : '当前未连接设备，先只生成定义',
    );
    startCreateDialog(prompt);
  };

  return (
    <div className="config-page" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong style={{ fontSize: '1rem' }}>OpenClaw 技能工坊</strong>
          <span className="badge badge-muted">{boardSkills.length} 个板端真实技能</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={loadBoardSkills} disabled={loading}>{loading ? '...' : '刷新'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>板端真实技能列表</div>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索板端技能..." style={{ fontSize: '0.8125rem' }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredBoardSkills.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                当前设备无已安装技能
              </div>
            )}
            {filteredBoardSkills.map((s) => {
              const name = s.split('|')[0] || s;
              const desc = (s.split('|')[2] || '').replace(/^"|"$/g, '').trim();
              return (
                <button
                  key={s}
                  className={`config-sidebar-item ${selectedBoardSkill === s ? 'active' : ''}`}
                  onClick={() => setSelectedBoardSkill(s)}
                  title={desc || name}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px' }}
                >
                  <span className="badge badge-ok" style={{ fontSize: '0.56rem' }}>real</span>
                  <strong style={{ fontSize: '0.75rem', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</strong>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--accent-subtle)', borderRadius: 'var(--radius-md)', padding: '16px', border: '1px solid var(--accent-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <strong style={{ fontSize: '0.875rem' }}>链接转技能（高质量模式）</strong>
                <span className="badge badge-accent">AI 驱动</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                支持 GitHub / NodeHub / 普通网页；会按来源类型应用不同的制作规范与三轮验证。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="粘贴链接（GitHub / NodeHub / 文档 URL）" />
                {sourceKind && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-accent">识别类型: {getSourceKindLabel(sourceKind)}</span>
                  </div>
                )}
                <textarea className="input" value={skillGoal} onChange={(e) => setSkillGoal(e.target.value)} rows={3} placeholder="可选：补充目标" style={{ resize: 'vertical', minHeight: 74 }} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={startUrlBasedSkillCreate}>解析链接并生成 Skill</button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <strong style={{ fontSize: '0.875rem' }}>板端 OpenClaw 状态</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span className={`badge ${openclawHealth?.installed ? 'badge-ok' : 'badge-muted'}`}>已安装: {openclawHealth?.installed ? '是' : '否'}</span>
                <span className={`badge ${openclawHealth?.gatewayRunning ? 'badge-ok' : 'badge-muted'}`}>网关运行: {openclawHealth?.gatewayRunning ? '是' : '否'}</span>
                <span className={`badge ${openclawHealth?.aiReady ? 'badge-ok' : 'badge-muted'}`}>AI就绪: {openclawHealth?.aiReady ? '是' : '否'}</span>
              </div>
            </div>

            <div className="divider" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: '0.875rem' }}>Skill 内容</strong>
                {skillContentPath && <span className="badge badge-muted">{skillContentPath}</span>}
              </div>
              {!selectedBoardSkill && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>请在左侧选择一个板端真实技能查看内容。</p>
              )}
              {selectedBoardSkill && (
                <>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>当前技能: {selectedBoardSkill.split('|')[0]}</div>
                  <div className="config-terminal" style={{ maxHeight: 360 }}>
                    <pre style={{ margin: 0 }}>
                      {skillContentLoading ? '正在读取板端 SKILL.md ...' : (skillContent || '未读取到内容')}
                    </pre>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
