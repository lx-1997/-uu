import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import { fillTemplate } from '../i18n/en-extras';
import { fetchDeviceOpenClawHealth } from '../api';
import { persistOpenClawHealthSnapshot } from '../studio-ui-hints';
import { fetchApi } from '../utils/apiBase';
import skillCenterManifestJson from '../skill-center/manifest.json';
import type { SkillCenterManifest } from '../skill-center/types';

const skillCenterManifest = skillCenterManifestJson as SkillCenterManifest;

interface OpenClawSkillsPayload {
  ok?: boolean;
  skills?: string[];
}

type SourceKind = 'github' | 'nodehub' | 'web';
type RightTab = 'view' | 'create' | 'link';
type HubMode = 'board' | 'center';
type CenterSub = 'catalog' | 'clawhub';

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
    t(
      'skillBrowser.prompt.mustWrite',
      '【部署约束】先完整输出 A/B 结构（含 SKILL.md 全文）。未经用户在对话中明确确认写入板端（例如回复「确认写入板端」），不得调用 board_openclaw_write_skill 或向该路径执行 device_file_write。用户确认后，优先使用 board_openclaw_write_skill；若工具不可用，可用 device_file_write 写入 /root/.openclaw/workspace/skills/<skillId>/SKILL.md。禁止未实际调用工具却声称已部署。',
    ),
    t(
      'skillBrowser.prompt.noTool',
      '若 board_openclaw_write_skill 与 device_file_write 均不可用，输出完整 SKILL.md，并说明需在「技能工坊 → 创建技能」中手动部署或粘贴。',
    ),
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
      t('skillBrowser.prompt.githubIntro', '请将以下 GitHub 仓库转化为 OpenClaw 技能（可部署到板端；写入前须用户确认）。'),
      tf('skillBrowser.prompt.linkLine', '链接: {{url}}', { url }),
      tf('skillBrowser.prompt.goalLine', '目标: {{goal}}', { goal }),
      t('skillBrowser.prompt.githubExtra', 'GitHub 专项：分析 README、依赖文件，提取构建与运行命令，锁定版本。'),
      ...common,
    ].join('\n');
  }
  if (kind === 'nodehub') {
    return [
      t('skillBrowser.prompt.nodehubIntro', '请将以下 NodeHub 应用转化为 OpenClaw 技能（可部署到板端；写入前须用户确认）。'),
      tf('skillBrowser.prompt.linkLine', '链接: {{url}}', { url }),
      tf('skillBrowser.prompt.goalLine', '目标: {{goal}}', { goal }),
      t('skillBrowser.prompt.nodehubExtra', 'NodeHub 专项：提取应用 ID、安装/运行/停止命令、配置项、资源占用。'),
      t(
        'skillBrowser.prompt.nodehubUrlHint',
        'URL 说明：官方站点可能使用 `.../nodehub/detail/{id}` 或 `.../nodehubdetail/{id}` 两种路径，末尾数字串均为 NodeHub 应用 ID；若页面为前端动态加载导致无法抓取详情，须如实说明并列出缺失项。',
      ),
      ...common,
    ].join('\n');
  }
  return [
    t('skillBrowser.prompt.webIntro', '请将以下网页内容转化为 OpenClaw 技能（可部署到板端；写入前须用户确认）。'),
    tf('skillBrowser.prompt.linkLine', '链接: {{url}}', { url }),
    tf('skillBrowser.prompt.goalLine', '目标: {{goal}}', { goal }),
    t('skillBrowser.prompt.webExtra', '网页专项：抓取正文要点，提取可执行的操作步骤。'),
    ...common,
  ].join('\n');
}

async function writeSkillToBoard(deviceId: string, skillId: string, content: string): Promise<{ ok: boolean; message: string; path?: string }> {
  const res = await fetchApi(`/api/devices/${deviceId}/openclaw/skill-write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillId, content }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, message: data?.message || data?.error || `HTTP ${res.status}` };
  return { ok: !!data.ok, message: data.message || 'Write complete', path: data.path };
}

/** 与 AI 对话侧一致，用于定位 ~/.rdkstudio/rdkclaw-workspaces/&lt;id&gt;/skills/ */
const STUDIO_USER_ID_KEY = 'rdk:chat:user-id';

function readStudioUserId(): string {
  try {
    const existing = localStorage.getItem(STUDIO_USER_ID_KEY);
    if (existing?.trim()) return existing.trim();
    const created = `studio-user-${Date.now()}`;
    localStorage.setItem(STUDIO_USER_ID_KEY, created);
    return created;
  } catch {
    return `studio-user-${Date.now()}`;
  }
}

async function deleteSkillFromBoard(deviceId: string, skillId: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetchApi(`/api/devices/${deviceId}/openclaw/skill-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: data?.message || data?.error || `HTTP ${res.status}` };
  return { ok: !!data.ok, message: data.message || 'Deleted' };
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

  const [hubMode, setHubMode] = useState<HubMode>('board');
  const [selectedCenterFolder, setSelectedCenterFolder] = useState<string | null>(null);
  const [centerMd, setCenterMd] = useState('');
  const [centerMdLoading, setCenterMdLoading] = useState(false);
  const [centerSearch, setCenterSearch] = useState('');
  const [centerCategory, setCenterCategory] = useState<string>('all');
  const [centerSub, setCenterSub] = useState<CenterSub>('clawhub');

  const [clawhubQuery, setClawhubQuery] = useState('RDK X5');
  const [clawhubResults, setClawhubResults] = useState<
    { slug: string; displayName?: string; summary?: string; score?: number }[]
  >([]);
  const [clawhubSearchLoading, setClawhubSearchLoading] = useState(false);
  const [clawhubSearchErr, setClawhubSearchErr] = useState<string | null>(null);
  const [selectedClawhubSlug, setSelectedClawhubSlug] = useState<string | null>(null);
  const [clawhubMd, setClawhubMd] = useState('');
  const [clawhubMdLoading, setClawhubMdLoading] = useState(false);
  const [clawhubResolvedVersion, setClawhubResolvedVersion] = useState<string | null>(null);
  const [localRdkclawWriteLoading, setLocalRdkclawWriteLoading] = useState(false);

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
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);

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
        fetchApi(`/api/devices/${currentDevice.id}/openclaw/skills`),
        fetchDeviceOpenClawHealth(currentDevice.id),
      ]);
      if (skillsRes.ok) {
        const payload = await skillsRes.json() as OpenClawSkillsPayload;
        setBoardSkills(payload.ok ? (payload.skills || []) : []);
      } else {
        setBoardSkills([]);
      }
      const st = healthRes.status;
      setOpenclawHealth({
        installed: !!st?.installed,
        gatewayRunning: !!st?.gatewayRunning,
        aiReady: !!st?.aiReady,
      });
      if (st) persistOpenClawHealthSnapshot(currentDevice.id, st);
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
      const res = await fetchApi(
        `/api/devices/${currentDevice.id}/openclaw/skill-content?skillId=${encodeURIComponent(skillId)}`,
      );
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

  useEffect(() => {
    if (!confirmAction) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmAction(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmAction]);

  const filteredBoardSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boardSkills;
    return boardSkills.filter((s) => s.toLowerCase().includes(q));
  }, [boardSkills, search]);

  const filteredCenterItems = useMemo(() => {
    const q = centerSearch.trim().toLowerCase();
    return skillCenterManifest.items.filter((it) => {
      if (centerCategory !== 'all' && it.category !== centerCategory) return false;
      if (!q) return true;
      return it.folder.toLowerCase().includes(q) || it.title.toLowerCase().includes(q);
    });
  }, [centerSearch, centerCategory]);

  const fetchCenterMd = useCallback(
    async (folder: string) => {
      setCenterMdLoading(true);
      setCenterMd('');
      try {
        const res = await fetchApi(`/api/skills/${encodeURIComponent(folder)}/md`);
        const text = await res.text();
        if (!res.ok) {
          setCenterMd(
            tf('skillBrowser.center.loadErr', '加载失败: HTTP {{status}}', { status: res.status }),
          );
          return;
        }
        setCenterMd(text);
      } catch (e) {
        setCenterMd(
          tf('skillBrowser.center.loadErr2', '{{msg}}', {
            msg: e instanceof Error ? e.message : t('api.err.default', '网络错误'),
          }),
        );
      } finally {
        setCenterMdLoading(false);
      }
    },
    [t, tf],
  );

  useEffect(() => {
    if (hubMode !== 'center' || centerSub !== 'catalog') return;
    const list = filteredCenterItems;
    if (list.length === 0) {
      setSelectedCenterFolder(null);
      return;
    }
    if (!selectedCenterFolder || !list.some((x) => x.folder === selectedCenterFolder)) {
      setSelectedCenterFolder(list[0].folder);
    }
  }, [hubMode, centerSub, filteredCenterItems, selectedCenterFolder]);

  useEffect(() => {
    if (hubMode !== 'center' || centerSub !== 'catalog' || !selectedCenterFolder) {
      if (hubMode !== 'center' || centerSub !== 'catalog') setCenterMd('');
      return;
    }
    void fetchCenterMd(selectedCenterFolder);
  }, [hubMode, centerSub, selectedCenterFolder, fetchCenterMd]);

  const fetchClawhubSkillMd = useCallback(async (slug: string) => {
    setClawhubMdLoading(true);
    setClawhubMd('');
    setClawhubResolvedVersion(null);
    try {
      const res = await fetchApi(`/api/clawhub/skills/${encodeURIComponent(slug)}/skill-md`);
      const data = await res.json() as {
        ok?: boolean;
        markdown?: string;
        version?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setClawhubMd(
          data.message
            || data.error
            || tf('skillBrowser.center.loadErr', '加载失败: HTTP {{status}}', { status: res.status }),
        );
        return;
      }
      setClawhubMd(data.markdown || '');
      setClawhubResolvedVersion(data.version ?? null);
    } catch (e) {
      setClawhubMd(
        e instanceof Error ? e.message : t('api.err.default', '网络错误'),
      );
    } finally {
      setClawhubMdLoading(false);
    }
  }, [t, tf]);

  useEffect(() => {
    if (hubMode !== 'center' || centerSub !== 'clawhub' || !selectedClawhubSlug) {
      setClawhubMd('');
      setClawhubResolvedVersion(null);
      return;
    }
    void fetchClawhubSkillMd(selectedClawhubSlug);
  }, [hubMode, centerSub, selectedClawhubSlug, fetchClawhubSkillMd]);

  const runClawhubSearch = useCallback(async () => {
    const q = clawhubQuery.trim();
    if (!q) {
      addToast?.(t('skillBrowser.clawhub.needQuery', '请输入搜索关键词'), 'warning');
      return;
    }
    setClawhubSearchLoading(true);
    setClawhubSearchErr(null);
    const ac = new AbortController();
    const tid = window.setTimeout(() => ac.abort(), 75_000);
    try {
      const res = await fetchApi(`/api/clawhub/search?q=${encodeURIComponent(q)}&limit=30`, {
        signal: ac.signal,
      });
      const data = await res.json() as {
        ok?: boolean;
        results?: { slug: string; displayName?: string; summary?: string; score?: number }[];
        error?: string;
        message?: string;
      };
      if (!res.ok || data.ok === false) {
        setClawhubSearchErr(data.message || data.error || t('skillBrowser.clawhub.searchFail', '搜索失败'));
        setClawhubResults([]);
        return;
      }
      const list = data.results ?? [];
      setClawhubResults(list);
      if (list.length === 0) {
        setClawhubSearchErr(t('skillBrowser.clawhub.noResults', '无匹配技能'));
      } else {
        setClawhubSearchErr(null);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setClawhubSearchErr(
          t('skillBrowser.clawhub.searchTimeout', '搜索超时，请再试一次（首次连接技能源可能较慢）'),
        );
      } else {
        setClawhubSearchErr(e instanceof Error ? e.message : t('api.err.default', '网络错误'));
      }
      setClawhubResults([]);
    } finally {
      window.clearTimeout(tid);
      setClawhubSearchLoading(false);
    }
  }, [clawhubQuery, addToast, t]);

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

  const handleDeployBuiltin = () => {
    if (!currentDevice) {
      addToast?.(t('skillBrowser.toast.needDevice', '请先连接设备'), 'warning');
      return;
    }
    if (!selectedCenterFolder || !centerMd.trim()) {
      addToast?.(t('skillBrowser.center.emptyBody', '技能内容为空，无法部署'), 'warning');
      return;
    }
    const id = selectedCenterFolder;
    setConfirmAction({
      title: tf('skillBrowser.confirm.deployTitle', '部署技能「{{id}}」到板端？', { id }),
      detail: tf('skillBrowser.center.deployDetail', '将写入 ~/.openclaw/workspace/skills/{{id}}/SKILL.md（内置 SKILL.md 原文）', { id }),
      confirmLabel: t('skillBrowser.confirm.deploy', '确认部署'),
      onConfirm: () => {
        setConfirmAction(null);
        void executeDeploy(id, centerMd);
      },
    });
  };

  const clawhubDeployId = (slug: string) =>
    slug
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'skillhub-skill';

  const handleDeployClawhub = () => {
    if (!currentDevice) {
      addToast?.(t('skillBrowser.toast.needDevice', '请先连接设备'), 'warning');
      return;
    }
    if (!selectedClawhubSlug || !clawhubMd.trim()) {
      addToast?.(t('skillBrowser.center.emptyBody', '技能内容为空，无法部署'), 'warning');
      return;
    }
    const id = clawhubDeployId(selectedClawhubSlug);
    setConfirmAction({
      title: tf('skillBrowser.confirm.deployTitle', '部署技能「{{id}}」到板端？', { id }),
      detail: tf('skillBrowser.clawhub.deployDetail', '将 SkillHub 技能「{{slug}}」写入 ~/.openclaw/workspace/skills/{{id}}/SKILL.md', {
        slug: selectedClawhubSlug,
        id,
      }),
      confirmLabel: t('skillBrowser.confirm.deploy', '确认部署'),
      onConfirm: () => {
        setConfirmAction(null);
        void executeDeploy(id, clawhubMd);
      },
    });
  };

  const executeWriteLocalRdkclaw = useCallback(
    async (skillId: string, content: string) => {
      setLocalRdkclawWriteLoading(true);
      try {
        const res = await fetchApi('/api/rdkclaw/local-skill-write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: readStudioUserId(),
            skillId,
            content: content.trim(),
          }),
        });
        const data = (await res.json()) as { ok?: boolean; path?: string; message?: string; error?: string };
        if (!res.ok) {
          addToast?.(data.message || data.error || t('skillBrowser.clawhub.localWriteFail', '写入本地 RDKClaw 失败'), 'error');
          return;
        }
        addToast?.(
          tf('skillBrowser.clawhub.localWriteOk', '已写入本地 RDKClaw：{{path}}', { path: data.path || '' }),
          'success',
        );
      } catch (e) {
        addToast?.(e instanceof Error ? e.message : t('api.err.default', '网络错误'), 'error');
      } finally {
        setLocalRdkclawWriteLoading(false);
      }
    },
    [addToast, t, tf],
  );

  const handleWriteLocalRdkclaw = () => {
    if (!selectedClawhubSlug || !clawhubMd.trim()) {
      addToast?.(t('skillBrowser.center.emptyBody', '技能内容为空，无法写入'), 'warning');
      return;
    }
    const id = clawhubDeployId(selectedClawhubSlug);
    setConfirmAction({
      title: tf('skillBrowser.clawhub.localWriteTitle', '写入本地 RDKClaw 技能「{{id}}」？', { id }),
      detail: t(
        'skillBrowser.clawhub.localWriteDetail',
        '将写入本机用户工作区 skills 目录（与对话侧 RDKClaw 同一用户 ID），约数秒内可在对话中匹配；不经过 SSH 设备。',
      ),
      confirmLabel: t('skillBrowser.clawhub.localWriteConfirm', '确认写入'),
      onConfirm: () => {
        setConfirmAction(null);
        void executeWriteLocalRdkclaw(id, clawhubMd);
      },
    });
  };

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

  const executeDeleteSkill = useCallback(
    async (skillId: string) => {
      if (!currentDevice) return;
      setDeletingSkillId(skillId);
      try {
        const result = await deleteSkillFromBoard(currentDevice.id, skillId);
        if (result.ok) {
          addToast?.(tf('skillBrowser.toast.deleted', '已删除板端技能「{{id}}」', { id: skillId }), 'success');
          if (selectedBoardSkill?.split('|')[0] === skillId) {
            setSelectedBoardSkill(null);
            setSkillContent('');
            setSkillContentPath('');
            setEditing(false);
          }
          await loadBoardSkills();
        } else {
          addToast?.(tf('skillBrowser.toast.deleteFail', '删除失败: {{msg}}', { msg: result.message }), 'error');
        }
      } catch (e: unknown) {
        addToast?.(
          tf('skillBrowser.toast.deleteFail', '删除失败: {{msg}}', { msg: e instanceof Error ? e.message : t('api.err.default', '网络错误') }),
          'error',
        );
      } finally {
        setDeletingSkillId(null);
      }
    },
    [currentDevice, addToast, tf, loadBoardSkills, selectedBoardSkill, t],
  );

  const requestDeleteSkill = (skillId: string) => {
    if (!currentDevice) return addToast?.(t('skillBrowser.toast.needDevice', '请先连接设备'), 'warning');
    setConfirmAction({
      title: tf('skillBrowser.confirm.deleteTitle', '删除板端技能「{{id}}」？', { id: skillId }),
      detail: t(
        'skillBrowser.confirm.deleteDetail',
        '将尝试删除 ~/.openclaw/workspace/skills 与 /opt/openclaw/skills 下同名片段（若存在）。若两处均不存在或权限不足，请刷新列表或在设备上手动处理。',
      ),
      confirmLabel: t('skillBrowser.confirm.delete', '删除'),
      onConfirm: () => {
        setConfirmAction(null);
        void executeDeleteSkill(skillId);
      },
    });
  };

  const selectSkillAndView = (s: string) => {
    setSelectedBoardSkill(s);
    setRightTab('view');
  };

  return (
    <div className="config-page" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '1rem' }}>{t('skillBrowser.title', 'OpenClaw 技能工坊')}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className={`btn btn-sm ${hubMode === 'board' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setHubMode('board')}
              style={{ fontSize: '0.6875rem' }}
            >
              {t('skillBrowser.hub.board', '板端')}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${hubMode === 'center' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setHubMode('center')}
              style={{ fontSize: '0.6875rem' }}
            >
              {t('skillBrowser.hub.center', 'Skill 中心')}
            </button>
          </div>
          {hubMode === 'board' && (
            <span className="badge badge-muted">{tf('skillBrowser.count', '{{n}} 个板端技能', { n: boardSkills.length })}</span>
          )}
          {hubMode === 'center' && (
            <span className="badge badge-muted">
              {tf('skillBrowser.center.badge', '内置 {{n}} 条', { n: skillCenterManifest.items.length })}
            </span>
          )}
          {openclawHealth && hubMode === 'board' && (
            <span className={`badge ${openclawHealth.gatewayRunning ? 'badge-ok' : 'badge-muted'}`}>
              {openclawHealth.gatewayRunning ? t('skillBrowser.gwOn', '网关运行中') : t('skillBrowser.gwOff', '网关未运行')}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (hubMode === 'center' && centerSub === 'catalog' && selectedCenterFolder) void fetchCenterMd(selectedCenterFolder);
            else if (hubMode === 'center' && centerSub === 'clawhub' && selectedClawhubSlug) void fetchClawhubSkillMd(selectedClawhubSlug);
            else void loadBoardSkills();
          }}
          disabled={
            loading
            || (hubMode === 'center' && centerSub === 'catalog' && centerMdLoading)
            || (hubMode === 'center' && centerSub === 'clawhub' && clawhubMdLoading)
          }
        >
          {loading || (hubMode === 'center' && centerSub === 'catalog' && centerMdLoading) || (hubMode === 'center' && centerSub === 'clawhub' && clawhubMdLoading)
            ? '...'
            : t('skillBrowser.refresh', '刷新')}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {hubMode === 'board' ? (
            <>
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('skillBrowser.searchPh', '搜索技能...')} style={{ fontSize: '0.8125rem' }} />
                <p style={{ fontSize: '0.625rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.35 }}>
                  {t(
                    'skillBrowser.sidebarHint',
                    '点击名称在右侧查看；点「编辑」修改。垃圾桶会尝试删除工作区与 /opt/openclaw/skills 下同名片段。',
                  )}
                </p>
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
                    <div
                      key={s}
                      className={`config-sidebar-item ${selectedBoardSkill === s ? 'active' : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px' }}
                    >
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => selectSkillAndView(s)}
                        title={desc || name}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          justifyContent: 'flex-start',
                          padding: '4px 6px',
                          fontWeight: selectedBoardSkill === s ? 600 : 400,
                        }}
                      >
                        <strong style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', textAlign: 'left' }}>{name}</strong>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: 4, flexShrink: 0, color: 'var(--danger, #c44)' }}
                        title={t('skillBrowser.deleteSkill', '删除板端技能')}
                        onClick={(e) => {
                          e.stopPropagation();
                          requestDeleteSkill(name);
                        }}
                        disabled={!currentDevice || deletingSkillId === name}
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: '0.75rem' }} onClick={() => setRightTab('create')}>{t('skillBrowser.newSkill', '+ 创建新技能')}</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${centerSub === 'clawhub' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, fontSize: '0.625rem' }}
                  onClick={() => setCenterSub('clawhub')}
                >
                  {t('skillBrowser.clawhub.tab', 'SkillHub')}
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${centerSub === 'catalog' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, fontSize: '0.625rem' }}
                  onClick={() => setCenterSub('catalog')}
                >
                  {t('skillBrowser.center.catalogTab', '本地清单')}
                </button>
              </div>
              {centerSub === 'catalog' ? (
                <>
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <select
                      className="input"
                      value={centerCategory}
                      onChange={(e) => setCenterCategory(e.target.value)}
                      style={{ fontSize: '0.75rem', padding: '4px 6px' }}
                    >
                      <option value="all">{t('skillBrowser.center.catAll', '全部分类')}</option>
                      {skillCenterManifest.categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                    <input
                      className="input"
                      value={centerSearch}
                      onChange={(e) => setCenterSearch(e.target.value)}
                      placeholder={t('skillBrowser.center.searchPh', '搜索内置技能...')}
                      style={{ fontSize: '0.8125rem' }}
                    />
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {filteredCenterItems.length === 0 && (
                      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                        {skillCenterManifest.items.length === 0
                          ? t(
                              'skillBrowser.center.emptyCatalog',
                              '暂无 Skill 中心条目，接入清单后将在此展示。',
                            )
                          : t('skillBrowser.center.emptyFilter', '无匹配项，请调整分类或搜索')}
                      </div>
                    )}
                    {filteredCenterItems.map((it) => (
                      <button
                        key={it.folder}
                        type="button"
                        className={`config-sidebar-item ${selectedCenterFolder === it.folder ? 'active' : ''}`}
                        onClick={() => setSelectedCenterFolder(it.folder)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 10px',
                          border: 'none',
                          background: selectedCenterFolder === it.folder ? 'var(--bg-muted)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <strong style={{ fontSize: '0.75rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</strong>
                        <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{it.folder}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      className="input"
                      value={clawhubQuery}
                      onChange={(e) => setClawhubQuery(e.target.value)}
                      placeholder={t('skillBrowser.clawhub.queryPh', '搜索关键词，如 RDK X5')}
                      style={{ fontSize: '0.8125rem' }}
                      onKeyDown={(e) => e.key === 'Enter' && void runClawhubSearch()}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%', fontSize: '0.75rem' }}
                      onClick={() => void runClawhubSearch()}
                      disabled={clawhubSearchLoading}
                    >
                      {clawhubSearchLoading
                        ? t('skillBrowser.clawhub.searching', '搜索中…')
                        : t('skillBrowser.clawhub.search', '搜索')}
                    </button>
                    {clawhubSearchLoading && (
                      <p style={{ fontSize: '0.5625rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.35 }}>
                        {t(
                          'skillBrowser.clawhub.searchColdHint',
                          '首次连接技能源可能需几秒，请稍候；完成后再次搜索会更快。',
                        )}
                      </p>
                    )}
                    {clawhubSearchErr && (
                      <p style={{ fontSize: '0.625rem', color: 'var(--text-muted)', margin: 0 }}>{clawhubSearchErr}</p>
                    )}
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {clawhubResults.length === 0 && !clawhubSearchLoading && !clawhubSearchErr && (
                      <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {t('skillBrowser.clawhub.hintRun', '输入关键词后点击搜索')}
                      </div>
                    )}
                    {clawhubResults.map((r) => (
                      <button
                        key={r.slug}
                        type="button"
                        className={`config-sidebar-item ${selectedClawhubSlug === r.slug ? 'active' : ''}`}
                        onClick={() => setSelectedClawhubSlug(r.slug)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 10px',
                          border: 'none',
                          background: selectedClawhubSlug === r.slug ? 'var(--bg-muted)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <strong style={{ fontSize: '0.75rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.displayName || r.slug}</strong>
                        <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{r.slug}</span>
                        {r.summary && (
                          <span style={{ fontSize: '0.5625rem', color: 'var(--text-muted)', display: 'block', marginTop: 4, lineHeight: 1.35, maxHeight: '4.2em', overflow: 'hidden' }}>
                            {r.summary}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {hubMode === 'center' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {centerSub === 'catalog' ? (
                <>
                  <div>
                    <strong style={{ fontSize: '0.875rem' }}>{t('skillBrowser.center.title', '内置技能预览')}</strong>
                  </div>
                  {!selectedCenterFolder ? (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{t('skillBrowser.center.pick', '请在左侧选择一条内置技能。')}</p>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <strong style={{ fontSize: '0.875rem' }}>{filteredCenterItems.find((x) => x.folder === selectedCenterFolder)?.title ?? selectedCenterFolder}</strong>
                          <span className="badge badge-muted" style={{ marginLeft: 8, fontSize: '0.625rem', fontFamily: 'monospace' }}>{selectedCenterFolder}</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={handleDeployBuiltin}
                          disabled={deploying || !currentDevice || centerMdLoading || !centerMd.trim()}
                        >
                          {deploying ? t('skillBrowser.deploying', '部署中...') : t('skillBrowser.center.deploy', '部署到板端')}
                        </button>
                      </div>
                      {!currentDevice && (
                        <span style={{ fontSize: '0.625rem', color: 'var(--danger)' }}>{t('skillBrowser.connectFirst', '请先连接设备')}</span>
                      )}
                      <div className="config-terminal" style={{ maxHeight: 'none', flex: 1, minHeight: 280 }}>
                        <pre style={{ margin: 0, fontSize: '0.75rem' }}>
                          {centerMdLoading ? t('skillBrowser.center.loading', '正在加载 SKILL.md ...') : (centerMd || t('skillBrowser.noContent', '未读取到内容'))}
                        </pre>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <strong style={{ fontSize: '0.875rem' }}>{t('skillBrowser.clawhub.previewTitle', 'SkillHub 技能预览')}</strong>
                    <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                      <a href="https://skillhub.tencent.com/" target="_blank" rel="noreferrer">
                        skillhub.tencent.com
                      </a>
                    </p>
                  </div>
                  {!selectedClawhubSlug ? (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{t('skillBrowser.clawhub.pick', '请先在左侧搜索并选择一条技能。')}</p>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <strong style={{ fontSize: '0.875rem' }}>{clawhubResults.find((x) => x.slug === selectedClawhubSlug)?.displayName || selectedClawhubSlug}</strong>
                          <span className="badge badge-muted" style={{ marginLeft: 8, fontSize: '0.625rem', fontFamily: 'monospace' }}>{selectedClawhubSlug}</span>
                          {clawhubResolvedVersion && (
                            <span className="badge badge-muted" style={{ marginLeft: 6, fontSize: '0.625rem' }}>v{clawhubResolvedVersion}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={handleWriteLocalRdkclaw}
                              disabled={localRdkclawWriteLoading || clawhubMdLoading || !clawhubMd.trim()}
                              title={t(
                                'skillBrowser.clawhub.localWriteHint',
                                '写入本机 ~/.rdkstudio/rdkclaw-workspaces/.../skills/（与 RDKClaw 对话同源）',
                              )}
                            >
                              {localRdkclawWriteLoading
                                ? t('skillBrowser.clawhub.localWriting', '写入中...')
                                : t('skillBrowser.clawhub.writeLocal', '写入本地 RDKClaw')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={handleDeployClawhub}
                              disabled={deploying || !currentDevice || clawhubMdLoading || !clawhubMd.trim()}
                            >
                              {deploying ? t('skillBrowser.deploying', '部署中...') : t('skillBrowser.center.deploy', '部署到板端')}
                            </button>
                          </div>
                          <span style={{ fontSize: '0.5625rem', color: 'var(--text-muted)', maxWidth: 300, textAlign: 'right', lineHeight: 1.35 }}>
                            {t(
                              'skillBrowser.clawhub.deployVsLocal',
                              '「写入本地 RDKClaw」：本机对话侧技能目录；「部署到板端」：SSH 到设备写入 OpenClaw 技能目录。',
                            )}
                          </span>
                        </div>
                      </div>
                      {!currentDevice && (
                        <span style={{ fontSize: '0.625rem', color: 'var(--danger)' }}>{t('skillBrowser.connectFirst', '请先连接设备')}</span>
                      )}
                      <div className="config-terminal" style={{ maxHeight: 'none', flex: 1, minHeight: 280 }}>
                        <pre style={{ margin: 0, fontSize: '0.75rem' }}>
                          {clawhubMdLoading ? t('skillBrowser.center.loading', '正在加载 SKILL.md ...') : (clawhubMd || t('skillBrowser.noContent', '未读取到内容'))}
                        </pre>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
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
                      {t('skillBrowser.aiRun', '发送到 AI 生成')}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                    {t(
                      'skillBrowser.linkHint',
                      '流程说明：点击后将把指令发送到 AI 对话；AI 应先给出完整 SKILL.md 并说明来源与缺失项，仅在你在对话中明确确认写入后，才应调用写入工具。你也可以复制 SKILL 到「创建技能」标签页，用界面上的「部署到板端」自行确认部署。',
                    )}
                  </div>
                </div>
              </div>
            )}
              </div>
            </>
          )}
        </div>
      </div>

      {confirmAction && (
        <div
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 12100,
            background: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setConfirmAction(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-browser-confirm-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
              maxWidth: 420,
              width: 'min(420px, 100%)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            <strong id="skill-browser-confirm-title" style={{ fontSize: '0.9375rem', display: 'block', marginBottom: 8 }}>
              {confirmAction.title}
            </strong>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.55 }}>
              {confirmAction.detail}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmAction(null)}>
                {t('skillBrowser.confirm.cancel', '取消')}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={confirmAction.onConfirm}>
                {confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
