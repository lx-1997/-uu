/**
 * find_skills：仅 JSONL 审计（检索 ≠ 内化）。
 * 任务成功且技能证实有用：`persistValidatedSkillUsage` → 拉取 SkillHub SKILL.md 写入 `skills/<id>/` + 长期记忆 + JSONL。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { clawhubFetchSkillMarkdown } from '../../clawhub-registry.js';
import type { MemoryManager } from '../memory.js';
import type { ToolContext } from './types.js';

/** 与技能工坊 / `writeLocalSkill` 一致：目录名仅字母数字下划线横线 */
export function hubSlugToLocalSkillId(slug: string): string {
  const id = String(slug || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const base = id || 'skillhub-skill';
  return base.length > 120 ? base.slice(0, 120) : base;
}

export type MaterializedSkillFile = { slug: string; localSkillId: string; path: string; version?: string };
export type MaterializeSkillError = { slug: string; error: string };

function appendInternalizeFooter(markdown: string, hubSlug: string, taskSummary: string): string {
  const safeTask = taskSummary.replace(/`/g, "'").replace(/\s+/g, ' ').trim().slice(0, 400);
  const safeSlug = hubSlug.replace(/`/g, '').trim().slice(0, 200);
  if (markdown.includes('\n### RDK Studio 内化\n')) return markdown;
  const footer = [
    '',
    '---',
    '',
    '### RDK Studio 内化',
    '',
    `- 时间: ${new Date().toISOString()}`,
    `- 注册表 slug: \`${safeSlug || '(unknown)'}\``,
    `- 任务摘要: ${safeTask || '—'}`,
    '',
  ].join('\n');
  return `${markdown.trimEnd()}${footer}`;
}

/**
 * 从 SkillHub/ClawHub 拉取 SKILL.md，写入 `bootstrapDir/skills/<localId>/SKILL.md`（与 RDKClaw 工作区约定一致）。
 */
export async function materializeHubSlugsToWorkspaceSkills(
  bootstrapDir: string,
  slugs: string[],
  meta: { taskSummary: string; sessionKey?: string },
): Promise<{ materialized: MaterializedSkillFile[]; errors: MaterializeSkillError[] }> {
  const materialized: MaterializedSkillFile[] = [];
  const errors: MaterializeSkillError[] = [];
  const root = bootstrapDir.trim();
  if (!root || slugs.length === 0) return { materialized, errors };

  const seenLocal = new Set<string>();
  const skillsRoot = path.join(root, 'skills');

  for (const raw of slugs) {
    const slug = String(raw || '').trim();
    if (!slug) continue;

    const localId = hubSlugToLocalSkillId(slug);
    if (seenLocal.has(localId)) {
      errors.push({ slug, error: 'sanitize 后与另一 slug 同为目录名，已跳过重复' });
      continue;
    }
    seenLocal.add(localId);

    const skillDir = path.join(skillsRoot, localId);
    const skillPath = path.join(skillDir, 'SKILL.md');

    try {
      if (fs.existsSync(skillPath)) {
        const st = fs.statSync(skillPath);
        if (st.size > 0) {
          errors.push({ slug, error: `工作区已存在 ${localId}/SKILL.md，未覆盖` });
          continue;
        }
      }

      const { markdown, version } = await clawhubFetchSkillMarkdown(slug);
      const body = appendInternalizeFooter(markdown, slug, meta.taskSummary);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(skillPath, body, 'utf-8');
      materialized.push({ slug, localSkillId: localId, path: skillPath, version });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ slug, error: msg });
      console.warn(`[skill_validated] materialize failed ${slug}:`, msg);
    }
  }

  return { materialized, errors };
}

export type FindSkillsPersistPayload = {
  query: string;
  sessionKey?: string;
  tencentSlugs: string[];
  localNames: string[];
  hubSkipped: boolean;
  hubError?: string;
  /** 是否对官方 ClawHub 做了兜底搜索 */
  officialFallbackUsed?: boolean;
  officialSlugs?: string[];
  officialFallbackError?: string;
};

function jsonlPath(bootstrapDir: string): string {
  return path.join(bootstrapDir, '.rdkstudio', 'find-skills-log.jsonl');
}

export function appendFindSkillsJsonl(bootstrapDir: string, payload: FindSkillsPersistPayload): void {
  const dir = path.dirname(jsonlPath(bootstrapDir));
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...payload,
  });
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(jsonlPath(bootstrapDir), `${line}\n`, 'utf-8');
  } catch (err) {
    console.warn('[find_skills] jsonl append failed:', err instanceof Error ? err.message : err);
  }
}

function validatedJsonlPath(bootstrapDir: string): string {
  return path.join(bootstrapDir, '.rdkstudio', 'validated-skills.jsonl');
}

export type ValidatedSkillUsagePayload = {
  skillSlugs: string[];
  localSkillRefs?: string[];
  taskSummary: string;
  howUsed?: string;
  sessionKey?: string;
};

function buildValidatedMemoryLine(p: ValidatedSkillUsagePayload): string {
  const slugs = p.skillSlugs.length ? p.skillSlugs.join(',') : '';
  const locals = p.localSkillRefs?.length ? p.localSkillRefs.join(',') : '';
  const bits = [
    '[skill_validated] 任务已成功，以下技能经实践有效',
    `任务:${p.taskSummary.replace(/\s+/g, ' ').trim().slice(0, 500)}`,
  ];
  if (slugs) bits.push(`SkillHub/slug:${slugs}`);
  if (locals) bits.push(`本地技能:${locals}`);
  if (p.howUsed?.trim()) bits.push(`用法:${p.howUsed.replace(/\s+/g, ' ').trim().slice(0, 400)}`);
  return bits.join(' ');
}

/**
 * 仅写入检索审计（`.rdkstudio/find-skills-log.jsonl`），**不**写入长期记忆，避免「搜过就当会用」。
 */
export function persistFindSkillsAuditOnly(_ctx: ToolContext, payload: FindSkillsPersistPayload): void {
  const root = (_ctx.bootstrapDir || _ctx.workspaceDir || '').trim();
  if (!root) return;
  appendFindSkillsJsonl(root, payload);
}

export type PersistValidatedSkillResult = {
  root: string;
  wroteJsonl: boolean;
  wroteDailyMd: boolean;
  wroteLongTermMemory: boolean;
  materialized: MaterializedSkillFile[];
  materializeErrors: MaterializeSkillError[];
};

/**
 * 任务**成功**且确认采用了相关技能后调用：MemoryManager + daily memory + `validated-skills.jsonl`（供内化与 memory_search）。
 * 无可用工作区根路径时返回 `root: ''`，调用方应报错。
 */
export async function persistValidatedSkillUsage(
  ctx: ToolContext,
  payload: ValidatedSkillUsagePayload,
): Promise<PersistValidatedSkillResult> {
  const empty: PersistValidatedSkillResult = {
    root: '',
    wroteJsonl: false,
    wroteDailyMd: false,
    wroteLongTermMemory: false,
    materialized: [],
    materializeErrors: [],
  };
  const root = (ctx.bootstrapDir || ctx.workspaceDir || '').trim();
  if (!root) return empty;

  const lineObj = {
    at: new Date().toISOString(),
    ...payload,
  };
  let wroteJsonl = false;
  try {
    const dir = path.dirname(validatedJsonlPath(root));
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(validatedJsonlPath(root), `${JSON.stringify(lineObj)}\n`, 'utf-8');
    wroteJsonl = true;
  } catch (err) {
    console.warn('[skill_validated] jsonl failed:', err instanceof Error ? err.message : err);
  }

  let wroteDailyMd = false;
  const memLine = `- ${new Date().toISOString()} ${buildValidatedMemoryLine(payload)}\n`;
  try {
    const memoryDir = path.join(root, 'memory');
    const day = new Date().toISOString().slice(0, 10);
    const dailyFile = path.join(memoryDir, `${day}.md`);
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.appendFileSync(dailyFile, memLine, 'utf-8');
    wroteDailyMd = true;
  } catch (err) {
    console.warn('[skill_validated] daily memory failed:', err instanceof Error ? err.message : err);
  }

  let wroteLongTermMemory = false;
  const memory: MemoryManager | undefined = ctx.memory;
  if (memory) {
    try {
      await memory.add(buildValidatedMemoryLine(payload), 'memory');
      wroteLongTermMemory = true;
    } catch (err) {
      console.warn('[skill_validated] memory.add failed:', err instanceof Error ? err.message : err);
    }
  }

  let materialized: MaterializedSkillFile[] = [];
  let materializeErrors: MaterializeSkillError[] = [];
  if (payload.skillSlugs.length > 0) {
    const m = await materializeHubSlugsToWorkspaceSkills(root, payload.skillSlugs, {
      taskSummary: payload.taskSummary,
      sessionKey: payload.sessionKey,
    });
    materialized = m.materialized;
    materializeErrors = m.errors;
  }

  return { root, wroteJsonl, wroteDailyMd, wroteLongTermMemory, materialized, materializeErrors };
}
