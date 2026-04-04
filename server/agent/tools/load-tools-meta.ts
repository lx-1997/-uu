/**
 * load_tools — 按需将会话中尚未注册的延迟工具加入下一轮 tool 列表
 */

import type { Tool, ToolContext } from "./types.js";
import {
  LAZY_LOAD_MAX_BATCH,
  LAZY_LOAD_MAX_QUERY_MATCHES,
  LOAD_TOOLS_META_NAME,
  isLazyCoreToolName,
} from "./lazy-tool-policy.js";

export { LOAD_TOOLS_META_NAME };

export type LoadToolsInput = {
  /** 精确工具名列表（与 query 至少填一类） */
  names?: string[];
  /** 在工具名与 description 中做子串匹配（不区分大小写） */
  query?: string;
  /** 加载当前策略下全部可延迟工具（有上限） */
  load_all?: boolean;
};

export function createLoadToolsTool(params: {
  getDeferrableCatalog: (ctx: ToolContext) => Tool[];
  /** 当前会话已激活的延迟工具名（可变 Set，需按 sessionKey 由调用方管理） */
  getLoadedSet: (sessionKey: string) => Set<string>;
}): Tool<LoadToolsInput> {
  return {
    name: LOAD_TOOLS_META_NAME,
    description:
      "将**当前回合工具列表里还没有**的「延迟工具」登记进会话；**登记后同一条 assistant 内、下一串行工具步起**即可调用（agent-loop 每步会刷新列表）。若仍报未知工具，说明策略未包含该工具或须开启联网。\n" +
      "**RDK Studio 已选设备时**：`device_*`、`board_openclaw_*` 等常在首轮已预载——若你**已经能看到** `device_exec`，拍照/摄像头/Shell 探活等**直接** `device_exec`，**不要**先调用本工具。\n" +
      "**需要再 load 的典型场景**：列表里还缺 `web_search`、`web_fetch`、附件类、飞书/微信配置等你见不到的工具时，用 `names` / `query` / `load_all`。\n" +
      "用法：\n" +
      "- `names`: 精确名列表，例如 [\"web_search\"]\n" +
      "- `query`: 关键词匹配描述或名称\n" +
      "- `load_all`: true 时载入剩余可延迟工具（有上限）\n" +
      "\n返回简短确认；勿向用户朗读工具名列表。若返回提示「匹配的工具已在会话中」，说明应直接调用已有工具而非重复 load。",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          description: "要载入的工具的精确名称",
        },
        query: {
          type: "string",
          description: "按关键词匹配可延迟工具（名或描述子串）",
        },
        load_all: {
          type: "boolean",
          description: "是否加载当前会话所有可延迟工具（有批量上限）",
        },
      },
    },
    async execute(input, ctx) {
      const sessionKey = ctx.sessionKey;
      const deferrable = params.getDeferrableCatalog(ctx);
      const byName = new Map(deferrable.map((t) => [t.name, t]));
      const loaded = params.getLoadedSet(sessionKey);
      const toActivate = new Set<string>();
      const lines: string[] = [];

      const noteAlready = (n: string) => {
        if (isLazyCoreToolName(n)) {
          lines.push(`- ${n}：已在核心集中，无需加载`);
        } else if (loaded.has(n)) {
          lines.push(`- ${n}：本会话已加载`);
        }
      };

      if (input.load_all === true) {
        for (const t of deferrable) {
          if (toActivate.size >= LAZY_LOAD_MAX_BATCH) break;
          if (!loaded.has(t.name)) toActivate.add(t.name);
        }
      }

      if (Array.isArray(input.names)) {
        for (const raw of input.names) {
          const n = String(raw || "").trim();
          if (!n) continue;
          if (!byName.has(n)) {
            lines.push(`- ${n}：不存在或未对当前会话开放（策略/子代理范围）`);
            continue;
          }
          if (loaded.has(n) || isLazyCoreToolName(n)) {
            noteAlready(n);
            continue;
          }
          if (toActivate.size + loaded.size >= LAZY_LOAD_MAX_BATCH) {
            lines.push(`- 已达单次批量上限 ${LAZY_LOAD_MAX_BATCH}，未继续添加`);
            break;
          }
          toActivate.add(n);
        }
      }

      const q = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
      if (q.length > 0) {
        /** 整句子串匹配；若含空格则再按「词」任一命中（避免 query「device camera photo」整串对不上任何描述） */
        const tokens =
          q.includes(" ") || q.includes("　")
            ? q
                .split(/\s+/)
                .map((x) => x.trim().toLowerCase())
                .filter((x) => x.length >= 3)
            : [];
        const queryHitsDeferrableTool = (t: { name: string; description?: string }) => {
          const name = t.name.toLowerCase();
          const desc = (t.description || "").toLowerCase();
          if (name.includes(q) || desc.includes(q)) return true;
          if (tokens.length === 0) return false;
          return tokens.some((tok) => name.includes(tok) || desc.includes(tok));
        };
        let matched = 0;
        let queryHitAlreadyLoaded = false;
        for (const t of deferrable) {
          if (matched >= LAZY_LOAD_MAX_QUERY_MATCHES) break;
          const hit = queryHitsDeferrableTool(t);
          if (!hit) continue;
          if (loaded.has(t.name) || isLazyCoreToolName(t.name)) {
            queryHitAlreadyLoaded = true;
            continue;
          }
          if (toActivate.size + loaded.size >= LAZY_LOAD_MAX_BATCH) {
            lines.push(`- 已达批量上限，其余匹配项已跳过`);
            break;
          }
          toActivate.add(t.name);
          matched++;
        }
        if (matched === 0 && !input.load_all && (!input.names || input.names.length === 0)) {
          if (q.length > 0) {
            lines.push(
              queryHitAlreadyLoaded
                ? `- query「${input.query}」匹配的工具已在当前会话中，无需 load_tools；请直接调用（如 device_exec）。`
                : `- query「${input.query}」未匹配到新的可延迟工具`,
            );
          }
        }
      }

      if (
        !input.load_all &&
        (!input.names || input.names.length === 0) &&
        !q &&
        toActivate.size === 0
      ) {
        const preview = deferrable
          .filter((t) => !loaded.has(t.name))
          .slice(0, 24)
          .map((t) => t.name);
        return (
          `请至少提供 names、query 之一，或 load_all=true。\n` +
          `当前仍有未加载工具示例（共 ${deferrable.filter((t) => !loaded.has(t.name)).length} 个候选的一部分）：` +
          (preview.length ? `\n${preview.join(", ")}` : "\n（无）")
        );
      }

      for (const n of toActivate) {
        loaded.add(n);
      }

      if (toActivate.size > 0) {
        lines.unshift(
          `登记完成：${toActivate.size} 个工具将于下一轮请求起可用（勿向用户朗读本行或枚举工具名）。`,
        );
      } else if (lines.length === 0) {
        lines.push("没有新的工具被登记（可能已全部可用或不存在）。");
      }

      return lines.join("\n");
    },
  };
}
