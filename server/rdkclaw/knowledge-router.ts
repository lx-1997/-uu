/**
 * Knowledge Router — 知识路由器
 *
 * 职责：
 * 1. 根据当前激活的 Bot / @docs / @url 决定注入哪些知识
 * 2. 管理 RDK 官方文档与用户自定义文档的冲突优先级
 * 3. 在 context window 预算内选择最相关的知识切片
 * 4. 格式化为适合注入 system prompt 的结构化文本
 */

import type { RoboBot, DocPriority } from "./bot-store.js";
import { KnowledgeSpaceStore, type KnowledgeSearchResult } from "./knowledge-space-store.js";

/** 启用资料后先注入简短目录，让模型知道「有哪些参考」，再按需取少量相关摘录 */
function buildUserMaterialCatalog(
  spaceStore: KnowledgeSpaceStore,
  spaceIds: string[],
  maxChars: number,
): string {
  const header = "### 已录入的资料\n";
  const footer =
    "\n\n> 回答时结合上述目录判断引用范围；与当前问题相关的片段见下方（如有）。";
  const bodyParts: string[] = [];

  for (const sid of spaceIds) {
    const space = spaceStore.getSpace(sid);
    if (!space) continue;
    const lines: string[] = [`**${space.name}**`];
    const srcs = space.sources ?? [];
    if (srcs.length === 0) {
      lines.push("- （尚未导入链接或文档）");
    } else {
      for (const src of srcs.slice(0, 12)) {
        if (src.type === "url") {
          const label = src.title?.trim() || src.url;
          lines.push(`- ${label}`);
        } else if (src.type === "text") {
          lines.push(`- ${src.title?.trim() || "粘贴文本"}`);
        } else if (src.type === "file") {
          lines.push(`- ${src.title?.trim() || src.filePath}`);
        } else if (src.type === "github") {
          lines.push(`- ${src.repo}`);
        }
      }
    }
    bodyParts.push(lines.join("\n"));
  }

  if (bodyParts.length === 0) return "";
  let body = bodyParts.join("\n\n");
  let out = `${header}${body}${footer}`;
  if (out.length > maxChars) {
    const room = Math.max(0, maxChars - header.length - footer.length - 1);
    body = body.slice(0, room) + "…";
    out = `${header}${body}${footer}`;
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface KnowledgeRouterInput {
  /** 用户消息（用于相关性检索） */
  userMessage: string;
  /** 当前激活的 RoboBot */
  activeBot?: RoboBot;
  /** @docs 追加的知识空间名称/ID */
  activeKnowledgeSpaceIds: string[];
  /** @url 即时引用的 URL 文本内容（已抓取） */
  instantUrlContents: Array<{ url: string; title?: string; content: string }>;
  /** 是否包含 RDK 官方文档（来自 Bot 配置或默认 true） */
  includeRdkOfficialDocs: boolean;
  /** 文档优先策略 */
  docPriority: DocPriority;
  /** 知识注入的 token 预算（大约字符数 / 4） */
  tokenBudget?: number;
}

export interface KnowledgeRouterOutput {
  /** 格式化后的知识上下文（用于注入 system prompt） */
  knowledgeContextBlock: string;
  /** 使用的知识空间名称列表 */
  usedSpaceNames: string[];
  /** 注入的总字符数（近似） */
  totalCharsInjected: number;
  /** 是否有有效知识注入 */
  hasKnowledge: boolean;
}

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

/** 默认知识 token 预算（约 30K tokens ≈ 120K chars） */
const DEFAULT_TOKEN_BUDGET = 30_000;
const CHARS_PER_TOKEN = 4;

/** 单个 @url 即时内容的最大字符数 */
const MAX_URL_CONTENT_CHARS = 16_000;

/** 相关摘录条数（用户资料已大块存储，不必堆很多条） */
const MAX_SEARCH_RESULTS = 5;

/** 资料目录块预算（字符） */
const MAX_CATALOG_CHARS = 2_000;

// ---------------------------------------------------------------------------
//  Router
// ---------------------------------------------------------------------------

export class KnowledgeRouter {
  constructor(private spaceStore: KnowledgeSpaceStore) {}

  /**
   * 执行知识路由，返回格式化的知识上下文块
   */
  route(input: KnowledgeRouterInput): KnowledgeRouterOutput {
    const budget = (input.tokenBudget ?? DEFAULT_TOKEN_BUDGET) * CHARS_PER_TOKEN;
    let usedChars = 0;
    const sections: string[] = [];
    const usedSpaceNames: string[] = [];

    // ---- 1. @url 即时引用：最高优先级 ----
    for (const urlContent of input.instantUrlContents) {
      if (usedChars >= budget) break;
      const truncated = urlContent.content.slice(0, MAX_URL_CONTENT_CHARS);
      const section = formatUrlSection(urlContent.url, urlContent.title, truncated);
      sections.push(section);
      usedChars += section.length;
      usedSpaceNames.push(`@url: ${urlContent.url}`);
    }

    // ---- 2. 已绑定资料：先简短目录，再按问题取少量相关摘录 ----
    const allSpaceIds = [...input.activeKnowledgeSpaceIds];

    if (input.activeBot) {
      for (const sid of input.activeBot.knowledgeSpaceIds) {
        if (!allSpaceIds.includes(sid)) {
          allSpaceIds.push(sid);
        }
      }
    }

    if (allSpaceIds.length > 0) {
      const remainingForCatalog = budget - usedChars;
      if (remainingForCatalog > 400) {
        const catalog = buildUserMaterialCatalog(
          this.spaceStore,
          allSpaceIds,
          Math.min(MAX_CATALOG_CHARS, remainingForCatalog - 400),
        );
        if (catalog) {
          sections.push(catalog);
          usedChars += catalog.length;
        }
      }
    }

    if (allSpaceIds.length > 0 && input.userMessage.trim()) {
      const remaining = budget - usedChars;
      if (remaining > 500) {
        const results = this.spaceStore.search(
          input.userMessage,
          allSpaceIds,
          MAX_SEARCH_RESULTS,
        );
        const grouped = groupBySpace(results);

        for (const [spaceName, chunks] of grouped) {
          if (usedChars >= budget) break;
          const section = formatChunksSection(spaceName, chunks, budget - usedChars);
          sections.push(section);
          usedChars += section.length;
          if (!usedSpaceNames.includes(spaceName)) {
            usedSpaceNames.push(spaceName);
          }
        }
      }
    }

    // ---- 3. 文档优先级注释 ----
    if (sections.length > 0) {
      const priorityNote = buildPriorityNote(input.docPriority, input.includeRdkOfficialDocs);
      sections.push(priorityNote);
    }

    const knowledgeContextBlock = sections.length > 0
      ? `## 用户资料参考\n\n${sections.join("\n\n")}`
      : "";

    return {
      knowledgeContextBlock,
      usedSpaceNames,
      totalCharsInjected: usedChars,
      hasKnowledge: sections.length > 0,
    };
  }
}

// ---------------------------------------------------------------------------
//  格式化辅助
// ---------------------------------------------------------------------------

function formatUrlSection(url: string, title: string | undefined, content: string): string {
  const header = title ? `### 📎 即时引用: ${title}` : `### 📎 即时引用`;
  return [
    header,
    `> 来源: ${url}`,
    "",
    content,
  ].join("\n");
}

function formatChunksSection(
  spaceName: string,
  results: KnowledgeSearchResult[],
  charBudget: number,
): string {
  const lines: string[] = [`### 相关摘录 · ${spaceName}`];
  let used = lines[0].length;

  for (const { chunk } of results) {
    if (used >= charBudget) break;
    const sourceLabel = chunk.metadata.url
      ? `[来源: ${chunk.metadata.title ?? chunk.metadata.url}, ${chunk.metadata.section ?? ""}]`
      : `[来源: ${chunk.metadata.title ?? chunk.sourceId}]`;

    const entry = `\n**${sourceLabel}**\n${chunk.content}`;
    if (used + entry.length > charBudget) {
      // 截断
      const remaining = charBudget - used - sourceLabel.length - 20;
      if (remaining > 100) {
        lines.push(`\n**${sourceLabel}**\n${chunk.content.slice(0, remaining)}…`);
      }
      break;
    }
    lines.push(entry);
    used += entry.length;
  }

  return lines.join("\n");
}

function groupBySpace(results: KnowledgeSearchResult[]): Map<string, KnowledgeSearchResult[]> {
  const map = new Map<string, KnowledgeSearchResult[]>();
  for (const r of results) {
    const existing = map.get(r.spaceName);
    if (existing) {
      existing.push(r);
    } else {
      map.set(r.spaceName, [r]);
    }
  }
  return map;
}

function buildPriorityNote(docPriority: DocPriority, includeRdk: boolean): string {
  if (!includeRdk) {
    return "---\n📌 当前知识上下文仅来自用户自定义文档（已关闭 RDK 官方文档）。";
  }
  switch (docPriority) {
    case "bot-first":
      return "---\n📌 文档优先策略: **Bot 文档优先**。如用户自定义文档与 RDK 官方文档冲突，优先采信用户文档，但请说明差异来源。";
    case "rdk-first":
      return "---\n📌 文档优先策略: **RDK 文档优先**。如用户自定义文档与 RDK 官方文档冲突，优先采信 RDK 官方文档。";
    case "merged":
    default:
      return "---\n📌 文档优先策略: **融合模式**。综合 RDK 官方文档与用户自定义文档，如有冲突请综合判断并说明来源差异。";
  }
}
