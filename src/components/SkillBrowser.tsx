import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import { fillTemplate } from '../i18n/en-extras';
import { fetchDeviceOpenClawHealth } from '../api';
import { resolveApiUrl } from '../utils/apiBase';

interface OpenClawSkillsPayload {
  ok?: boolean;
  skills?: string[];
}

type SourceKind = 'github' | 'nodehub' | 'web';
type RightTab = 'view' | 'create' | 'link';

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

function getSourceKindLabel(kind: SourceKind, t: (key: string, zh: string) => string): string {
  if (kind === 'github') return 'GitHub';
  if (kind === 'nodehub') return 'NodeHub';
  return t('skillBrowser.source.web', '普通网页');
}

const SKILL_TEMPLATE_ZH = `---
name: my-skill
description: "一句话描述技能的能力边界"
version: 1.0.0
trigger: 关键词1,关键词2,keyword1,keyword2
risk: low
permissions: device_exec
delegate_preference: board
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Custom
---

# 技能标题

## 适用场景
- 具体场景描述

## 执行流程
1. 步骤一（对应具体命令或工具）
2. 步骤二
3. 步骤三

## 前置条件
- 需要的环境或依赖

## 验证步骤
- 如何验证技能执行成功
`;

function buildQualityPromptBySource(
  kind: SourceKind,
  url: string,
  goal: string,
  deviceHint: string,
  t: (key: string, zh: string) => string,
  tf: (key: string, zh: string, vars: Record<string, string | number>) => string,
): string {
  const common = [
    t('skillBrowser.prompt.mustWrite', '【重要】你必须使用 board_openclaw_write_skill 工具将生成的 SKILL.md 直接写入板端。不要只输出文本。'),
    t('skillBrowser.prompt.noTool', '如果没有该工具可用，请生成完整的 SKILL.md 内容并明确告知用户需要手动部署。'),
    '',
    t('skillBrowser.prompt.qualityTitle', '质量要求：'),
    t('skillBrowser.prompt.q1', '1) 必须给出可执行命令，不允许只给概念描述。'),
    t('skillBrowser.prompt.q2', '2) 若关键信息缺失，必须明确列出"缺失项 + 风险 + 建议补充"。'),
    t('skillBrowser.prompt.q3', '3) 必须输出完整 SKILL.md，包含所有 frontmatter 字段（name/description/version/trigger/risk/permissions/delegate_preference/requires_board/approval_level/cooldown_seconds/scheduler_template/category）。'),
    t('skillBrowser.prompt.q4', '4) 给出推荐的技能名（kebab-case），并说明命名依据。'),
    tf('skillBrowser.prompt.deviceLine', '5) 目标设备：{{hint}}', { hint: deviceHint }),
    t('skillBrowser.prompt.q6', '6) 最终输出结构：A. 信息来源摘要 B. 生成的 SKILL.md C. 部署结果 D. 风险与回滚方案。'),
  ];

  if (kind === 'github') {
    return [
      t('skillBrowser.prompt.githubIntro', '请将以下 GitHub 仓库转化为 OpenClaw 技能并部署到板端。'),
      tf('skillBrowser.prompt.linkLine', '链接: {{url}}', { url }),
      tf('skillBrowser.prompt.goalLine', '目标: {{goal}}', { goal }),
      t('skillBrowser.prompt.githubExtra', 'GitHub 专项：分析 README、依赖文件，提取构建与运行命令，锁定版本。'),
      ...common,
    ].join('\n');
  }
  if (kind === 'nodehub') {
    return [
      t('skillBrowser.prompt.nodehubIntro', '请将以下 NodeHub 应用转化为 OpenClaw 技能并部署到板端。'),
      tf('skillBrowser.prompt.linkLine', '链接: {{url}}', { url }),
      tf('skillBrowser.prompt.goalLine', '目标: {{goal}}', { goal }),
      t('skillBrowser.prompt.nodehubExtra', 'NodeHub 专项：提取应用 ID、安装/运行/停止命令、配置项、资源占用。'),
      ...common,
    ].join('\n');
  }
  return [
    t('skillBrowser.prompt.webIntro', '请将以下网页内容转化为 OpenClaw 技能并部署到板端。'),
    tf('skillBrowser.prompt.linkLine', '链接: {{url}}', { url }),
    tf('skillBrowser.prompt.goalLine', '目标: {{goal}}', { goal }),
    t('skillBrowser.prompt.webExtra', '网页专项：抓取正文要点，提取可执行的操作步骤。'),
    ...common,
  ].join('\n');
}

async function writeSkillToBoard(deviceId: string, skillId: string, content: string): Promise<{ ok: boolean; message: string; path?: string }> {
  const res = await fetch(resolveApiUrl(`/api/devices/${deviceId}/openclaw/skill-write`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillId, content }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, message: data?.error || `HTTP ${res.status}` };
  return { ok: !!data.ok, message: data.message || 'Write complete', path: data.path };
}

function extractSkillName(content: string): string {
  const match = content.match(/^name:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

export default function SkillBrowser() {
  const { currentDevice, addToast, setCmd, setChatExpanded } = useAppState();
  const { t } = useI18n();
  const tf = useCallback(
    (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars),
    [t],
  );

  const [loading, setLoading] = useState(true);
  const [boardSkills, setBoardSkills] = useState<string[]>([]);
  const [openclawHealth, setOpenclawHealth] = useState<{ installed: boolean; gatewayRunning: boolean; aiReady: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [selectedBoardSkill, setSelectedBoardSkill] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState('');
  const [skillContentPath, setSkillContentPath] = useState('');
  const [skillContentLoading, setSkillContentLoading] = useState(false);

  const [rightTab, setRightTab] = useState<RightTab>('view');

  // Create skill state
  const [newSkillId, setNewSkillId] = useState('');
  const [newSkillContent, setNewSkillContent] = useState(SKILL_TEMPLATE_ZH);
  const [deploying, setDeploying] = useState(false);

  // Link-to-skill state
  const [sourceUrl, setSourceUrl] = useState('');
  const [skillGoal, setSkillGoal] = useState('');

  // Edit mode
  const [editContent, setEditContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Confirm dialog
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    detail: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const skillTplInitialized = useRef(false);
  useEffect(() => {
    if (skillTplInitialized.current) return;
    skillTplInitialized.current = true;
    setNewSkillContent(t('skillBrowser.template', SKILL_TEMPLATE_ZH));
  }, [t]);

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
    setEditing(false);
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/skill-content?skillId=${encodeURIComponent(skillId)}`));
      const data = await res.json() as { ok?: boolean; content?: string; path?: string; error?: string };
      if (!res.ok || !data.ok) {
        setSkillContent(data.error || tf('skillBrowser.err.readHttp', '无法读取该技能内容（HTTP {{status}}）', { status: res.status }));
      } else {
        setSkillContent(data.content || t('skillBrowser.err.emptyBody', '(空内容)'));
        setSkillContentPath(data.path || '');
      }
    } catch (e: any) {
      setSkillContent(tf('skillBrowser.err.readFail', '读取失败: {{msg}}', { msg: e?.message || t('api.err.default', '网络错误') }));
    } finally {
      setSkillContentLoading(false);
    }
  }, [currentDevice, t, tf]);

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
    if (selectedBoardSkill) {
      void loadSkillContent(selectedBoardSkill.split('|')[0]);
      setRightTab('view');
    }
  }, [selectedBoardSkill, loadSkillContent]);

  const filteredBoardSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boardSkills;
    return boardSkills.filter((s) => s.toLowerCase().includes(q));
  }, [boardSkills, search]);

  const sourceKind = useMemo(() => (looksLikeHttpUrl(sourceUrl) ? detectSourceKind(sourceUrl) : null), [sourceUrl]);

  const executeDeploy = useCallback(async (id: string, content: string) => {
    if (!currentDevice) return;
    setDeploying(true);
    try {
      const result = await writeSkillToBoard(currentDevice.id, id, content.trim());
      if (result.ok) {
        addToast?.(tf('skillBrowser.toast.deployOk', '技能 {{id}} 已部署到板端: {{path}}', { id, path: result.path || '' }), 'success');
        await loadBoardSkills();
        setRightTab('view');
      } else {
        addToast?.(tf('skillBrowser.toast.deployFail', '部署失败: {{msg}}', { msg: result.message }), 'error');
      }
    } catch (e: any) {
      addToast?.(tf('skillBrowser.toast.deployFail', '部署失败: {{msg}}', { msg: e?.message || t('api.err.default', '网络错误') }), 'error');
    } finally {
      setDeploying(false);
    }
  }, [currentDevice, addToast, loadBoardSkills, t, tf]);

  const handleDeploy = () => {
    if (!currentDevice) return addToast?.(t('skillBrowser.toast.needDevice', '请先连接设备'), 'warning');
    const id = newSkillId.trim() || extractSkillName(newSkillContent);
    if (!id) return addToast?.(t('skillBrowser.toast.needId', '请填写技能名称（或在 SKILL.md 中设置 name 字段）'), 'warning');
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return addToast?.(t('skillBrowser.toast.badId', '技能名只能包含字母、数字、下划线和横线'), 'warning');
    if (!newSkillContent.trim()) return addToast?.(t('skillBrowser.toast.emptyContent', 'SKILL.md 内容不能为空'), 'warning');

    setConfirmAction({
      title: tf('skillBrowser.confirm.deployTitle', '部署技能「{{id}}」到板端？', { id }),
      detail: tf('skillBrowser.confirm.deployDetail', '将写入 ~/.openclaw/workspace/skills/{{id}}/SKILL.md（{{lines}} 行）', {
        id,
        lines: newSkillContent.trim().split('\n').length,
      }),
      confirmLabel: t('skillBrowser.confirm.deploy', '确认部署'),
      onConfirm: () => { setConfirmAction(null); void executeDeploy(id, newSkillContent); },
    });
  };

  const executeSaveEdit = async () => {
    if (!currentDevice || !selectedBoardSkill) return;
    const id = selectedBoardSkill.split('|')[0];
    if (!id) return;
    setSaving(true);
    try {
      const result = await writeSkillToBoard(currentDevice.id, id, editContent.trim());
      if (result.ok) {
        addToast?.(tf('skillBrowser.toast.updated', '技能 {{id}} 已更新', { id }), 'success');
        setEditing(false);
        setSkillContent(editContent);
        await loadBoardSkills();
      } else {
        addToast?.(tf('skillBrowser.toast.saveFail', '保存失败: {{msg}}', { msg: result.message }), 'error');
      }
    } catch (e: any) {
      addToast?.(tf('skillBrowser.toast.saveFail', '保存失败: {{msg}}', { msg: e?.message || t('api.err.default', '网络错误') }), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = () => {
    if (!currentDevice || !selectedBoardSkill) return;
    const id = selectedBoardSkill.split('|')[0];
    if (!id) return;
    setConfirmAction({
      title: tf('skillBrowser.confirm.saveTitle', '保存修改到板端技能「{{id}}」？', { id }),
      detail: t('skillBrowser.confirm.saveDetail', '此操作将覆盖板端已有的 SKILL.md 文件。'),
      confirmLabel: t('skillBrowser.confirm.save', '确认保存'),
      onConfirm: () => { setConfirmAction(null); void executeSaveEdit(); },
    });
  };

  const startUrlBasedSkillCreate = () => {
    const url = sourceUrl.trim();
    if (!url) return addToast?.(t('skillBrowser.toast.needUrl', '请先输入链接'), 'warning');
    if (!looksLikeHttpUrl(url)) return addToast?.(t('skillBrowser.toast.badUrl', '请输入有效的 http/https 链接'), 'warning');
    const goal = skillGoal.trim() || t('skillBrowser.defaultGoal', '将该链接内容转化为通用可复用的 OpenClaw 技能');
    const deviceHint = currentDevice
      ? tf('skillBrowser.deviceHintLine', '{{name}} ({{id}})', { name: currentDevice.name, id: currentDevice.id })
      : t('skillBrowser.deviceDisconnected', '当前未连接设备，先只生成定义');
    const prompt = buildQualityPromptBySource(detectSourceKind(url), url, goal, deviceHint, t, tf);
    setCmd(prompt);
    setChatExpanded(true);
  };

  const startEdit = () => {
    setEditContent(skillContent);
    setEditing(true);
  };

  return (
    <div className="config-page" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong style={{ fontSize: '1rem' }}>{t('skillBrowser.title', 'OpenClaw 技能工坊')}</strong>
          <span className="badge badge-muted">{tf('skillBrowser.count', '{{n}} 个板端技能', { n: boardSkills.length })}</span>
          {openclawHealth && (
            <span className={`badge ${openclawHealth.gatewayRunning ? 'badge-ok' : 'badge-muted'}`}>
              {openclawHealth.gatewayRunning ? t('skillBrowser.gwOn', '网关运行中') : t('skillBrowser.gwOff', '网关未运行')}
            </span>
          )}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={loadBoardSkills} disabled={loading}>{loading ? '...' : t('skillBrowser.refresh', '刷新')}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('skillBrowser.searchPh', '搜索技能...')} style={{ fontSize: '0.8125rem' }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredBoardSkills.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                {currentDevice ? t('skillBrowser.empty.noSkills', '当前设备无已安装技能') : t('skillBrowser.empty.noDevice', '请先连接设备')}
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
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px' }}
                >
                  <strong style={{ fontSize: '0.75rem', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</strong>
                </button>
              );
            })}
          </div>
          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
            <button type="button" className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: '0.75rem' }} onClick={() => setRightTab('create')}>{t('skillBrowser.newSkill', '+ 创建新技能')}</button>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {(['view', 'create', 'link'] as RightTab[]).map((tab) => (
              <button key={tab} type="button" className={`btn btn-ghost btn-sm ${rightTab === tab ? 'active' : ''}`}
                onClick={() => setRightTab(tab)}
                style={{ borderRadius: 0, borderBottom: rightTab === tab ? '2px solid var(--accent)' : '2px solid transparent', fontSize: '0.75rem', padding: '8px 16px' }}>
                {tab === 'view' ? t('skillBrowser.tab.view', '查看 / 编辑') : tab === 'create' ? t('skillBrowser.tab.create', '创建技能') : t('skillBrowser.tab.link', '链接转技能')}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            {/* Tab: View / Edit */}
            {rightTab === 'view' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {!selectedBoardSkill ? (
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{t('skillBrowser.view.pick', '请在左侧选择一个板端技能查看内容。')}</p>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <strong style={{ fontSize: '0.875rem' }}>{selectedBoardSkill.split('|')[0]}</strong>
                        {skillContentPath && <span className="badge badge-muted" style={{ marginLeft: 8, fontSize: '0.625rem' }}>{skillContentPath}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!editing && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit} disabled={skillContentLoading || !skillContent}>{t('skillBrowser.edit', '编辑')}</button>
                        )}
                        {editing && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>{t('skillBrowser.cancel', '取消')}</button>
                            <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={saving}>{saving ? t('skillBrowser.saving', '保存中...') : t('skillBrowser.saveToBoard', '保存到板端')}</button>
                          </>
                        )}
                      </div>
                    </div>
                    {editing ? (
                      <textarea
                        className="input"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        placeholder={t('skillBrowser.editPlaceholder', '编辑 SKILL.md 内容')}
                        style={{ fontFamily: 'monospace', fontSize: '0.75rem', minHeight: 400, resize: 'vertical', whiteSpace: 'pre', lineHeight: 1.5 }}
                      />
                    ) : (
                      <div className="config-terminal" style={{ maxHeight: 'none' }}>
                        <pre style={{ margin: 0, fontSize: '0.75rem' }}>
                          {skillContentLoading ? t('skillBrowser.loading', '正在读取板端 SKILL.md ...') : (skillContent || t('skillBrowser.noContent', '未读取到内容'))}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Tab: Create */}
            {rightTab === 'create' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <strong style={{ fontSize: '0.875rem' }}>{t('skillBrowser.createTitle', '创建自定义技能')}</strong>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                    {t('skillBrowser.createDesc', '编写 SKILL.md 内容，一键部署到板端 OpenClaw 技能目录。')}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>{t('skillBrowser.idLabel', '技能 ID（kebab-case）')}</label>
                  <input
                    className="input"
                    value={newSkillId}
                    onChange={(e) => setNewSkillId(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                    placeholder={t('skillBrowser.idPh', '例如: my-custom-skill')}
                    style={{ fontSize: '0.8125rem' }}
                  />
                  <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                    {t('skillBrowser.idHint', '留空则自动从 SKILL.md 的 name 字段提取。部署路径: ~/.openclaw/workspace/skills/{skillId}/SKILL.md')}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>{t('skillBrowser.contentLabel', 'SKILL.md 内容')}</label>
                  <textarea
                    className="input"
                    value={newSkillContent}
                    onChange={(e) => setNewSkillContent(e.target.value)}
                    placeholder={t('skillBrowser.contentPh', '输入 SKILL.md 内容')}
                    style={{ fontFamily: 'monospace', fontSize: '0.75rem', minHeight: 360, resize: 'vertical', whiteSpace: 'pre', lineHeight: 1.5 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleDeploy} disabled={deploying || !currentDevice}>
                    {deploying ? t('skillBrowser.deploying', '部署中...') : t('skillBrowser.deploy', '部署到板端')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewSkillContent(t('skillBrowser.template', SKILL_TEMPLATE_ZH))}>{t('skillBrowser.resetTemplate', '重置模板')}</button>
                  {!currentDevice && <span style={{ fontSize: '0.625rem', color: 'var(--danger)' }}>{t('skillBrowser.connectFirst', '请先连接设备')}</span>}
                </div>
              </div>
            )}

            {/* Tab: Link-to-Skill */}
            {rightTab === 'link' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <strong style={{ fontSize: '0.875rem' }}>{t('skillBrowser.linkTitle', '链接转技能（AI 辅助）')}</strong>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                    {t('skillBrowser.linkDesc', '输入 GitHub / NodeHub / 文档链接，AI 将分析内容并生成可部署的 OpenClaw 技能。')}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder={t('skillBrowser.urlPh', '粘贴链接（GitHub / NodeHub / 文档 URL）')} />
                  {sourceKind && (
                    <span className="badge badge-accent" style={{ alignSelf: 'flex-start' }}>{t('skillBrowser.kindLabel', '识别类型:')}{' '}{getSourceKindLabel(sourceKind, t)}</span>
                  )}
                  <textarea className="input" value={skillGoal} onChange={(e) => setSkillGoal(e.target.value)} rows={2} placeholder={t('skillBrowser.goalPh', '可选：补充目标说明（如：提取 YOLO 推理相关命令）')} style={{ resize: 'vertical', minHeight: 56 }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={startUrlBasedSkillCreate} disabled={!sourceUrl.trim()}>
                      {t('skillBrowser.aiRun', 'AI 生成并部署')}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                    {t('skillBrowser.linkHint', '流程说明：点击后将跳转到 AI 对话，AI 会分析链接内容、生成 SKILL.md 并通过工具直接写入板端。如果 AI 仅输出了文本模板，你可以复制内容到「创建技能」标签页手动部署。')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)', padding: '24px', maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <strong style={{ fontSize: '0.9375rem', display: 'block', marginBottom: 8 }}>{confirmAction.title}</strong>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 16px' }}>{confirmAction.detail}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmAction(null)}>{t('skillBrowser.confirm.cancel', '取消')}</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={confirmAction.onConfirm}>{confirmAction.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
