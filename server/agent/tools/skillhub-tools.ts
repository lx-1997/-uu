/**
 * SkillHub / ClawHub 公共注册表搜索（与 Studio「技能工坊」同源 API，默认 lightmake.site）。
 */
import type { Tool } from './types.js';
import { clawhubSearch } from '../../clawhub-registry.js';

const MAX_RESULTS = 20;
const OUTPUT_CHAR_CAP = 12_000;

export function createSkillhubTools(): Tool[] {
  return [skillhubSearchTool];
}

const skillhubSearchTool: Tool<{ query: string; limit?: number }> = {
  name: 'skillhub_search',
  description:
    '在 SkillHub（与 ClawHub 兼容的公共注册表）中按关键词搜索**可安装的 OpenClaw 技能**；基址受 `CLAWHUB_REGISTRY` 影响（默认国内同源）。' +
    '**一般能力缺口请先调用内置 `find_skills`**（腾讯 SkillHub + 本地技能）；本工具用于仅需注册表搜索、或需与 `CLAWHUB_REGISTRY` 换源一致时。' +
    '关键词示例：weather、百度、obsidian、pdf。返回 slug、摘要与版本，供 `board_openclaw_skill_install` / Studio 技能工坊。',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词，建议 1～5 个词，可中英混排（如「天气」「baidu search」「pdf 编辑」）',
      },
      limit: {
        type: 'number',
        description: '最多返回条数，默认 10，最大 20',
      },
    },
    required: ['query'],
  },
  async execute(input) {
    const q = String(input.query || '').trim();
    if (!q) {
      return JSON.stringify({ ok: false, error: 'query 不能为空' });
    }
    const lim = Math.min(MAX_RESULTS, Math.max(1, Number(input.limit) || 10));
    try {
      const { results } = await clawhubSearch(q, lim);
      const slim = results.map((r) => ({
        slug: r.slug,
        displayName: r.displayName,
        summary: r.summary,
        version: r.version ?? undefined,
        score: r.score,
      }));
      let text = JSON.stringify(
        {
          ok: true,
          query: q,
          count: slim.length,
          results: slim,
          hint:
            '安装：套件端可用 board_openclaw_skill_install（owner/slug）；本机可在 Studio「技能工坊 → SkillHub」浏览。',
        },
        null,
        2,
      );
      if (text.length > OUTPUT_CHAR_CAP) {
        text = text.slice(0, OUTPUT_CHAR_CAP) + '\n…(truncated)';
      }
      return text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return JSON.stringify({ ok: false, error: msg });
    }
  },
};
