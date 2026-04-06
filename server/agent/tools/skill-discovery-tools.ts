/**
 * 腾讯 SkillHub「find-skills」等价能力：RDK Studio 内置工具；远程先腾讯 API，零命中或失败再兜底官方 clawhub.ai。
 */
import type { Tool } from './types.js';
import {
  clawhubSearchAt,
  getOfficialClawhubFallbackBase,
  TENCENT_SKILLHUB_API_BASE,
  type ClawhubSearchHit,
} from '../../clawhub-registry.js';
import type { RDKClawSkillMeta } from '../../rdkclaw/types.js';
import { findSkillsQueryLooksLikeOpenWebDistractor } from '../../rdkclaw/open-web-intent.js';
import { persistFindSkillsAuditOnly, persistValidatedSkillUsage } from './skill-discovery-persistence.js';

const HUB_CAP = 12;
const LOCAL_CAP = 12;
const OUTPUT_CHAR_CAP = 14_000;

export interface SkillDiscoveryToolOptions {
  matchLocal: (query: string) => RDKClawSkillMeta[];
  /** 与 skillhub_search 一致：关闭联网策略时不请求公网，仅返回本地匹配 */
  remoteEnabled: boolean;
  /** 将 SkillHub slug 写入 `skills/<id>/SKILL.md` 后刷新 SkillRegistry */
  afterSkillFilesMaterialized?: () => void;
}

export function createSkillDiscoveryTools(opts: SkillDiscoveryToolOptions): Tool[] {
  return [buildFindSkillsTool(opts), buildSkillMarkValidatedTool(opts)];
}

function slimLocal(m: RDKClawSkillMeta) {
  return {
    name: m.name,
    description: m.description,
    path: m.sourcePath,
    triggers: m.trigger.length ? m.trigger : undefined,
    risk: m.risk,
  };
}

function normBase(b: string): string {
  return String(b || '')
    .trim()
    .replace(/\/$/, '')
    .toLowerCase();
}

function mapHit(r: ClawhubSearchHit) {
  return {
    slug: r.slug,
    displayName: r.displayName,
    summary: r.summary,
    version: r.version ?? undefined,
    score: r.score,
  };
}

function buildFindSkillsTool(opts: SkillDiscoveryToolOptions): Tool<{ query: string; hub_limit?: number }> {
  return {
    name: 'find_skills',
    description:
      '用户**仅要打开/浏览网页**时用 **`studio_open_url`**（宿主工具），**不要**用本工具搜「浏览器」类技能。' +
      '**内置检索**：优先 **腾讯 SkillHub** API；若**零命中**或请求**失败**，自动再查 **官方 ClawHub**（默认 https://clawhub.ai，可用 `CLAWHUB_OFFICIAL_FALLBACK_BASE` 改）。合并本地 `SKILL.md`。' +
      '能力缺口时**必须**调用；关键词 1～5 个词。' +
      '安装：套件端/CLI 一般为 `clawhub install <技能短名>`（如 `find-skills`）；注册表返回的 `slug` 常为 `owner/skill` 亦可用于 install；`clawhub clone owner/skill` 用于克隆仓库。' +
      '未联网仅本地。需与 `CLAWHUB_REGISTRY` 单源一致时用 `skillhub_search`。**检索只记审计日志**；某技能**实际采用且任务验收成功**后再调用 `skill_mark_validated`：**拉取** SKILL.md 写入工作区 `skills/<id>/`，并写入记忆与 validated JSONL。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '任务或领域关键词，简短（如「飞书 webhook」「pdf」「ros2 诊断」）',
        },
        hub_limit: {
          type: 'number',
          description: `远程检索每条 API 最多返回条数（腾讯与官方兜底共用），默认 ${HUB_CAP}，最大 ${HUB_CAP}`,
        },
      },
      required: ['query'],
    },
    async execute(input, ctx) {
      const q = String(input.query || '').trim();
      if (!q) {
        return JSON.stringify({ ok: false, error: 'query 不能为空' });
      }
      if (findSkillsQueryLooksLikeOpenWebDistractor(q)) {
        console.warn('[find_skills] query resembles open-web intent; model should use studio_open_url', {
          query: q.slice(0, 160),
          sessionKey: ctx.sessionKey,
        });
      }
      const lim = Math.min(HUB_CAP, Math.max(1, Number(input.hub_limit) || HUB_CAP));

      const localFull = opts.matchLocal(q).slice(0, LOCAL_CAP);
      const local = localFull.map(slimLocal);
      const localNames = localFull.map((m) => m.name);

      const out: Record<string, unknown> = {
        ok: true,
        query: q,
        product: 'find-skills (Tencent SkillHub, built into RDK Studio)',
        priority: 'tencent_skillhub_then_official_clawhub',
        skillhub_api_base: TENCENT_SKILLHUB_API_BASE,
        tencent_skillhub: null as unknown,
        local_workspace_skills: local,
        audit_only:
          '本次检索仅追加 `.rdkstudio/find-skills-log.jsonl`（审计，**不**写入长期记忆）。若本回合中**实际使用**某 SkillHub 技能且任务**明确成功**，再调用 `skill_mark_validated`（填 slug）以**落盘** SKILL.md 并内化记忆。',
        hint:
          '优先采用腾讯结果；仅腾讯无命中或失败时采用官方兜底列表。安装：`clawhub install <slug或短名>`；套件端可用 `board_openclaw_skill_install`。本地命中：`read` SKILL.md。',
      };

      let tencentSlugs: string[] = [];
      let hubSkipped = false;
      let hubError: string | undefined;
      let officialFallbackUsed = false;
      let officialSlugs: string[] = [];
      let officialFallbackError: string | undefined;

      if (!opts.remoteEnabled) {
        out.tencent_skillhub = { skipped: true, reason: '当前会话未启用联网策略，仅返回本地技能。' };
        out.official_clawhub_fallback = { used: false, reason: '联网关闭，未请求官方兜底' };
        hubSkipped = true;
      } else {
        try {
          const { results } = await clawhubSearchAt(TENCENT_SKILLHUB_API_BASE, q, lim);
          tencentSlugs = results.map((r) => r.slug);
          out.tencent_skillhub = {
            ok: true,
            count: results.length,
            results: results.map(mapHit),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          hubError = msg;
          out.tencent_skillhub = { ok: false, error: msg };
        }

        const officialBase = getOfficialClawhubFallbackBase();
        const shouldFallback =
          normBase(officialBase) !== normBase(TENCENT_SKILLHUB_API_BASE) &&
          (hubError !== undefined || tencentSlugs.length === 0);

        if (shouldFallback) {
          officialFallbackUsed = true;
          try {
            const { results } = await clawhubSearchAt(officialBase, q, lim);
            officialSlugs = results.map((r) => r.slug);
            out.official_clawhub_fallback = {
              used: true,
              ok: true,
              api_base: officialBase,
              count: results.length,
              results: results.map(mapHit),
            };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            officialFallbackError = msg;
            out.official_clawhub_fallback = {
              used: true,
              ok: false,
              api_base: officialBase,
              error: msg,
            };
          }
        } else if (normBase(officialBase) === normBase(TENCENT_SKILLHUB_API_BASE)) {
          out.official_clawhub_fallback = {
            used: false,
            reason: '官方兜底基址与腾讯相同，跳过重复请求',
          };
        } else {
          out.official_clawhub_fallback = {
            used: false,
            reason: '腾讯 SkillHub 已有命中，未请求官方兜底',
          };
        }
      }

      persistFindSkillsAuditOnly(ctx, {
        query: q,
        sessionKey: ctx.sessionKey,
        tencentSlugs,
        localNames,
        hubSkipped,
        hubError,
        officialFallbackUsed,
        officialSlugs,
        officialFallbackError,
      });

      let text = JSON.stringify(out, null, 2);
      if (text.length > OUTPUT_CHAR_CAP) text = text.slice(0, OUTPUT_CHAR_CAP) + '\n…(truncated)';
      return text;
    },
  };
}

function buildSkillMarkValidatedTool(opts: SkillDiscoveryToolOptions): Tool<{
  outcome: 'success' | 'failure' | 'cancelled';
  skill_slugs?: string[];
  local_skill_refs?: string[];
  task_summary: string;
  how_used?: string;
}> {
  return {
    name: 'skill_mark_validated',
    description:
      '**仅在任务已验收成功且你确实采用了某次检索/安装的技能后调用**：从 SkillHub/ClawHub **下载**对应 `skill_slugs` 的 SKILL.md，写入 RDKClaw 工作区 `skills/<目录名>/SKILL.md`；**若当前会话已连接设备**，同时写入套件端 `/root/.openclaw/workspace/skills/<目录名>/SKILL.md`；并写记忆与 `.rdkstudio/validated-skills.jsonl`。' +
      '**禁止**在：仅 `find_skills` 未实际采用、任务失败、半途放弃、尚未确认成功时调用。' +
      '本机目录下已有非空 SKILL.md 时**不覆盖**本机文件（仍会尝试同步到套件端）。纯本地技能填 `local_skill_refs`（**不**从远端拉取、也**不**自动推套件端）。' +
      '`skill_slugs` 为 SkillHub/registry slug（如 owner/skill 或短名）。',
    inputSchema: {
      type: 'object',
      properties: {
        outcome: {
          type: 'string',
          enum: ['success', 'failure', 'cancelled'],
          description: '仅 outcome=success 时写入内化；failure/cancelled 会拒绝且不记录',
        },
        skill_slugs: {
          type: 'array',
          items: { type: 'string' },
          description: '实际起作用的 SkillHub 技能 slug 列表，可空若全是本地技能',
        },
        local_skill_refs: {
          type: 'array',
          items: { type: 'string' },
          description: '本地工作区技能：SKILL.md 路径或 frontmatter name',
        },
        task_summary: { type: 'string', description: '用户任务与结果一句话（已成功）' },
        how_used: { type: 'string', description: '可选：该技能如何帮你完成任务' },
      },
      required: ['outcome', 'task_summary'],
    },
    async execute(input, ctx) {
      const outcome = String(input.outcome || '')
        .trim()
        .toLowerCase() as 'success' | 'failure' | 'cancelled';
      if (outcome !== 'success') {
        return JSON.stringify({
          ok: false,
          skipped: true,
          reason: '仅任务成功且技能证实有用时内化；当前 outcome 不会写入记忆或 validated-skills。',
        });
      }
      const slugs = Array.isArray(input.skill_slugs)
        ? input.skill_slugs.map((s) => String(s).trim()).filter(Boolean)
        : [];
      const locals = Array.isArray(input.local_skill_refs)
        ? input.local_skill_refs.map((s) => String(s).trim()).filter(Boolean)
        : [];
      if (slugs.length === 0 && locals.length === 0) {
        return JSON.stringify({
          ok: false,
          error: '请至少提供 skill_slugs 或 local_skill_refs 之一，指向实际采用过的技能',
        });
      }
      const taskSummary = String(input.task_summary || '').trim();
      if (!taskSummary) {
        return JSON.stringify({ ok: false, error: 'task_summary 不能为空' });
      }
      const persist = await persistValidatedSkillUsage(ctx, {
        skillSlugs: slugs,
        localSkillRefs: locals.length ? locals : undefined,
        taskSummary,
        howUsed: input.how_used?.trim() || undefined,
        sessionKey: ctx.sessionKey,
      });
      const boardOk = persist.boardPushed.filter((b) => b.ok).length;
      const anyArtifact =
        persist.wroteJsonl ||
        persist.wroteDailyMd ||
        persist.wroteLongTermMemory ||
        persist.materialized.length > 0 ||
        boardOk > 0;
      if (!persist.root || !anyArtifact) {
        return JSON.stringify({
          ok: false,
          error:
            persist.root
              ? '内化写入失败（磁盘、注册表拉取、套件端 SSH 或路径异常），请检查工作区与设备'
              : '无法解析工作区路径（bootstrapDir/workspaceDir），内化未写入',
        });
      }
      if (persist.materialized.length > 0 || boardOk > 0) {
        try {
          opts.afterSkillFilesMaterialized?.();
        } catch {
          /* ignore */
        }
      }
      return JSON.stringify({
        ok: true,
        wrote: {
          validated_jsonl: persist.wroteJsonl,
          daily_memory_md: persist.wroteDailyMd,
          long_term_memory_index: persist.wroteLongTermMemory,
        },
        materialized_skills: persist.materialized,
        materialize_errors: persist.materializeErrors.length ? persist.materializeErrors : undefined,
        board_pushed: persist.boardPushed.length ? persist.boardPushed : undefined,
        message:
          (persist.materialized.length
            ? `已内化 ${persist.materialized.length} 个 SkillHub 技能到本机 skills/；`
            : '') +
          (boardOk ? `已同步 ${boardOk} 个到套件端 ~/.openclaw/workspace/skills/；` : '') +
          (persist.wroteLongTermMemory
            ? '已写入 validated-skills.jsonl、当日 memory/*.md 与长期记忆索引'
            : '已写入 validated-skills.jsonl 与当日 memory（当前会话未注入 MemoryManager 时无长期记忆索引）'),
      });
    },
  };
}
