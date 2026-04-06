/**
 * Knowledge Space — 知识空间数据模型与存储
 *
 * 知识空间是一个文档集合，支持多种来源（URL/文件/文本/GitHub）。
 * 文档被切片存储，支持 BM25 关键词检索。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type KnowledgeSourceType = "url" | "file" | "text" | "github";
export type IndexStatus = "pending" | "indexing" | "ready" | "error";

export interface KnowledgeSourceUrl {
  type: "url";
  id: string;
  url: string;
  crawlDepth?: number;
  title?: string;
}

export interface KnowledgeSourceFile {
  type: "file";
  id: string;
  filePath: string;
  mimeType: string;
  size: number;
  title?: string;
}

export interface KnowledgeSourceText {
  type: "text";
  id: string;
  title: string;
  content: string;
}

export interface KnowledgeSourceGitHub {
  type: "github";
  id: string;
  repo: string;
  branch?: string;
  paths?: string[];
}

export type KnowledgeSource =
  | KnowledgeSourceUrl
  | KnowledgeSourceFile
  | KnowledgeSourceText
  | KnowledgeSourceGitHub;

export interface KnowledgeChunkMetadata {
  title?: string;
  url?: string;
  section?: string;
  sourceId: string;
}

export interface KnowledgeChunk {
  id: string;
  spaceId: string;
  sourceId: string;
  content: string;
  metadata: KnowledgeChunkMetadata;
  keywords: string[];
}

export interface KnowledgeSpace {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  sources: KnowledgeSource[];
  indexStatus: IndexStatus;
  totalChunks: number;
}

export interface KnowledgeSpaceRegistry {
  spaces: KnowledgeSpace[];
}

// ---------------------------------------------------------------------------
//  BM25 搜索结果
// ---------------------------------------------------------------------------

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  score: number;
  spaceName: string;
}

// ---------------------------------------------------------------------------
//  Paths
// ---------------------------------------------------------------------------

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const SPACES_DIR = path.join(CONFIG_DIR, "knowledge-spaces");
const REGISTRY_FILE = path.join(SPACES_DIR, "registry.json");

function ensureSpacesDir(): void {
  if (!fs.existsSync(SPACES_DIR)) {
    fs.mkdirSync(SPACES_DIR, { recursive: true });
  }
}

function spaceDir(spaceId: string): string {
  return path.join(SPACES_DIR, spaceId);
}

function spaceChunksFile(spaceId: string): string {
  return path.join(spaceDir(spaceId), "chunks.json");
}

// ---------------------------------------------------------------------------
//  KnowledgeSpaceStore
// ---------------------------------------------------------------------------

export class KnowledgeSpaceStore {
  private cache: KnowledgeSpaceRegistry | null = null;
  /** 缓存的 chunks（spaceId → chunks） */
  private chunksCache = new Map<string, KnowledgeChunk[]>();

  // ---------- Registry ----------

  getRegistry(): KnowledgeSpaceRegistry {
    if (this.cache) return this.cache;
    try {
      if (!fs.existsSync(REGISTRY_FILE)) return { spaces: [] };
      const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
      const parsed = JSON.parse(raw) as KnowledgeSpaceRegistry;
      this.cache = parsed;
      return parsed;
    } catch {
      return { spaces: [] };
    }
  }

  private persist(registry: KnowledgeSpaceRegistry): void {
    ensureSpacesDir();
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf-8");
    this.cache = registry;
  }

  // ---------- CRUD ----------

  listSpaces(): KnowledgeSpace[] {
    return this.getRegistry().spaces;
  }

  getSpace(id: string): KnowledgeSpace | undefined {
    return this.getRegistry().spaces.find((s) => s.id === id);
  }

  getSpaceByName(name: string): KnowledgeSpace | undefined {
    const lower = name.toLowerCase().trim();
    return this.getRegistry().spaces.find(
      (s) => s.name.toLowerCase() === lower || s.name.toLowerCase().includes(lower),
    );
  }

  createSpace(input: { name: string; description: string; sources?: KnowledgeSource[] }): KnowledgeSpace {
    const now = Date.now();
    const space: KnowledgeSpace = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      sources: input.sources ?? [],
      indexStatus: "pending",
      totalChunks: 0,
    };
    const reg = this.getRegistry();
    reg.spaces.push(space);
    this.persist(reg);

    // 创建空间目录
    const dir = spaceDir(space.id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return space;
  }

  updateSpace(id: string, patch: Partial<Omit<KnowledgeSpace, "id" | "createdAt">>): KnowledgeSpace | undefined {
    const reg = this.getRegistry();
    const idx = reg.spaces.findIndex((s) => s.id === id);
    if (idx < 0) return undefined;
    reg.spaces[idx] = { ...reg.spaces[idx], ...patch, updatedAt: Date.now() };
    this.persist(reg);
    return reg.spaces[idx];
  }

  deleteSpace(id: string): boolean {
    const reg = this.getRegistry();
    const before = reg.spaces.length;
    reg.spaces = reg.spaces.filter((s) => s.id !== id);
    if (reg.spaces.length < before) {
      this.persist(reg);
      this.chunksCache.delete(id);
      // 删除空间目录（async，best-effort）
      const dir = spaceDir(id);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return true;
    }
    return false;
  }

  // ---------- Chunks 管理 ----------

  getChunks(spaceId: string): KnowledgeChunk[] {
    const cached = this.chunksCache.get(spaceId);
    if (cached) return cached;
    try {
      const file = spaceChunksFile(spaceId);
      if (!fs.existsSync(file)) return [];
      const raw = fs.readFileSync(file, "utf-8");
      const chunks = JSON.parse(raw) as KnowledgeChunk[];
      this.chunksCache.set(spaceId, chunks);
      return chunks;
    } catch {
      return [];
    }
  }

  saveChunks(spaceId: string, chunks: KnowledgeChunk[]): void {
    const dir = spaceDir(spaceId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(spaceChunksFile(spaceId), JSON.stringify(chunks, null, 2), "utf-8");
    this.chunksCache.set(spaceId, chunks);

    // 更新空间 totalChunks
    this.updateSpace(spaceId, { totalChunks: chunks.length, indexStatus: "ready" });
  }

  // ---------- BM25 搜索 ----------

  /**
   * 在指定知识空间中搜索
   * @param query 搜索关键词
   * @param spaceIds 搜索范围（为空搜全部）
   * @param topK 返回前 K 个
   */
  search(query: string, spaceIds?: string[], topK: number = 5): KnowledgeSearchResult[] {
    const queryTerms = extractTerms(query);
    if (queryTerms.length === 0) return [];

    const targetSpaces = spaceIds?.length
      ? this.listSpaces().filter((s) => spaceIds.includes(s.id))
      : this.listSpaces();

    const results: KnowledgeSearchResult[] = [];

    for (const space of targetSpaces) {
      if (space.indexStatus !== "ready") continue;
      const chunks = this.getChunks(space.id);

      for (const chunk of chunks) {
        const score = computeBM25Score(chunk.content, chunk.keywords, queryTerms, chunks.length);
        if (score > 0) {
          results.push({ chunk, score, spaceName: space.name });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  resetCache(): void {
    this.cache = null;
    this.chunksCache.clear();
  }
}

// ---------------------------------------------------------------------------
//  BM25 实现（复用 OpenClaw mini 的思路）
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "this", "that", "these",
  "those", "i", "me", "my", "we", "our", "you", "your", "he", "him",
  "she", "her", "it", "its", "they", "them", "their", "what", "which",
  "who", "whom", "and", "but", "or", "nor", "not", "no", "so", "if",
  "then", "than", "too", "very", "just", "about", "above", "after",
  "before", "between", "from", "into", "through", "during", "with",
  "at", "by", "for", "of", "on", "to", "in", "as",
]);

/**
 * 分词：支持中英文混合
 * - 英文按空格和标点分词
 * - 中文按字符分（简单分词，后续可升级 jieba）
 */
export function extractTerms(text: string): string[] {
  const lower = text.toLowerCase();
  // 提取英文单词和中文字符
  const tokens: string[] = [];

  // 英文单词
  const englishWords = lower.match(/[a-z0-9_]+(?:\.[a-z0-9_]+)*/g) ?? [];
  tokens.push(...englishWords);

  // 中文词组（2-4 字符 bigram/trigram）
  const chineseChars = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const segment of chineseChars) {
    if (segment.length >= 2) {
      // bigram
      for (let i = 0; i < segment.length - 1; i++) {
        tokens.push(segment.slice(i, i + 2));
      }
    }
    if (segment.length >= 3) {
      // trigram
      for (let i = 0; i < segment.length - 2; i++) {
        tokens.push(segment.slice(i, i + 3));
      }
    }
    // 整段
    if (segment.length >= 2) {
      tokens.push(segment);
    }
  }

  return tokens.filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * BM25 打分
 * k1=1.5, b=0.75
 */
function computeBM25Score(
  content: string,
  keywords: string[],
  queryTerms: string[],
  totalDocs: number,
): number {
  const k1 = 1.5;
  const b = 0.75;
  const avgDl = 200; // 假设平均文档长度

  const docTerms = keywords.length > 0 ? keywords : extractTerms(content);
  const dl = docTerms.length;
  if (dl === 0) return 0;

  const termFreq = new Map<string, number>();
  for (const t of docTerms) {
    termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
  }

  let score = 0;
  const matchedTerms = new Set<string>();

  for (const qt of queryTerms) {
    const tf = termFreq.get(qt) ?? 0;
    if (tf === 0) continue;
    matchedTerms.add(qt);

    // IDF（简化：假设每个 term 出现在 10% 的文档中）
    const idf = Math.log((totalDocs + 1) / (Math.max(totalDocs * 0.1, 1) + 0.5));
    // BM25 TF
    const tfScore = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl)));
    score += idf * tfScore;
  }

  // 覆盖率加权
  const coverageBonus = matchedTerms.size / queryTerms.length;
  score *= 0.7 + 0.3 * coverageBonus;

  return score;
}
