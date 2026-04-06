/**
 * 文档切片器 — 将文本内容切分为适合检索的 chunks
 *
 * 策略：
 * - 按标题层级（H1/H2/H3）自然分段
 * - 代码块和表格保持完整
 * - 单 chunk 目标 500-1000 tokens（≈ 2000-4000 字符）
 * - chunk 之间保留 overlap 确保上下文连续性
 */

import { randomUUID } from "node:crypto";
import { extractTerms, type KnowledgeChunk, type KnowledgeChunkMetadata } from "./knowledge-space-store.js";

// ---------------------------------------------------------------------------
//  配置
// ---------------------------------------------------------------------------

export interface ChunkOptions {
  /** 单 chunk 最大字符数 */
  maxChars?: number;
  /** chunk 间重叠字符数 */
  overlapChars?: number;
  /** 尊重标题断点 */
  respectHeadings?: boolean;
  /** 代码块不截断 */
  keepCodeBlocks?: boolean;
}

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  maxChars: 3000,
  overlapChars: 200,
  respectHeadings: true,
  keepCodeBlocks: true,
};

/**
 * 用户自备链接/文档：大块、少切分，便于保留上下文，RDKClaw 按问题再取少量相关片段即可。
 */
export const USER_LIBRARY_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: 12_000,
  overlapChars: 120,
  respectHeadings: true,
  keepCodeBlocks: true,
};

// ---------------------------------------------------------------------------
//  切片主函数
// ---------------------------------------------------------------------------

export function chunkDocument(
  text: string,
  spaceId: string,
  sourceId: string,
  baseMetadata: Omit<KnowledgeChunkMetadata, "sourceId">,
  options?: ChunkOptions,
): KnowledgeChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: KnowledgeChunk[] = [];

  // 1. 按标题分段
  const sections = opts.respectHeadings
    ? splitByHeadings(text)
    : [{ heading: undefined, content: text }];

  for (const section of sections) {
    const sectionText = section.content.trim();
    if (!sectionText) continue;

    if (sectionText.length <= opts.maxChars) {
      // 整段作为一个 chunk
      chunks.push(makeChunk(sectionText, spaceId, sourceId, {
        ...baseMetadata,
        section: section.heading,
      }));
    } else {
      // 需要进一步切分
      const subChunks = splitLongText(sectionText, opts.maxChars, opts.overlapChars, opts.keepCodeBlocks);
      for (const sub of subChunks) {
        chunks.push(makeChunk(sub, spaceId, sourceId, {
          ...baseMetadata,
          section: section.heading,
        }));
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
//  辅助函数
// ---------------------------------------------------------------------------

interface Section {
  heading?: string;
  content: string;
}

function splitByHeadings(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let currentHeading: string | undefined;
  let currentLines: string[] = [];

  for (const line of lines) {
    // 匹配 Markdown 标题（H1-H3）
    const headingMatch = /^(#{1,3})\s+(.+)/.exec(line);
    if (headingMatch) {
      // 保存之前的段落
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, content: currentLines.join("\n") });
      }
      currentHeading = headingMatch[2].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // 最后一段
  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, content: currentLines.join("\n") });
  }

  return sections;
}

function splitLongText(
  text: string,
  maxChars: number,
  overlapChars: number,
  keepCodeBlocks: boolean,
): string[] {
  const chunks: string[] = [];

  if (keepCodeBlocks) {
    // 先提取代码块，保护它们不被截断
    const parts = splitPreservingCodeBlocks(text);
    let buffer = "";

    for (const part of parts) {
      if (buffer.length + part.length <= maxChars) {
        buffer += part;
      } else {
        if (buffer.trim()) {
          chunks.push(buffer.trim());
        }
        // 如果单个 part（如代码块）超过 maxChars，直接保留
        if (part.length > maxChars) {
          chunks.push(part.trim());
          buffer = "";
        } else {
          // 加 overlap
          const overlap = buffer.length > overlapChars
            ? buffer.slice(-overlapChars)
            : "";
          buffer = overlap + part;
        }
      }
    }

    if (buffer.trim()) {
      chunks.push(buffer.trim());
    }
  } else {
    // 简单按段落/句子切分
    const paragraphs = text.split(/\n\n+/);
    let buffer = "";

    for (const para of paragraphs) {
      if (buffer.length + para.length + 2 <= maxChars) {
        buffer += (buffer ? "\n\n" : "") + para;
      } else {
        if (buffer.trim()) {
          chunks.push(buffer.trim());
        }
        const overlap = buffer.length > overlapChars
          ? buffer.slice(-overlapChars)
          : "";
        buffer = overlap + para;
      }
    }

    if (buffer.trim()) {
      chunks.push(buffer.trim());
    }
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * 将文本拆分为普通文本段和代码块段
 */
function splitPreservingCodeBlocks(text: string): string[] {
  const parts: string[] = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // 代码块之前的文本
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // 代码块本身
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  // 代码块后的文本
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function makeChunk(
  content: string,
  spaceId: string,
  sourceId: string,
  metadata: Omit<KnowledgeChunkMetadata, "sourceId">,
): KnowledgeChunk {
  return {
    id: randomUUID(),
    spaceId,
    sourceId,
    content,
    metadata: { ...metadata, sourceId },
    keywords: extractTerms(content),
  };
}
