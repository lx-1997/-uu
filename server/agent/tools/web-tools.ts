import type { Tool } from "./types.js";

export interface WebToolOptions {
  maxFetchChars?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_FETCH_CHARS = 16_000;

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function decodeEntities(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripHtml(html: string) {
  const withoutScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = withoutScript.replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function normalizeUrl(raw: string) {
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("URL 仅支持 http/https 协议");
  }
  const url = new URL(value);
  return url.toString();
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[...内容已截断，总长度 ${text.length} 字符]`;
}

function parseDdgResultLink(link: string) {
  try {
    const u = new URL(link, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : u.toString();
  } catch {
    return link;
  }
}

function webSearchTool(options: WebToolOptions): Tool<{ query: string; limit?: number }> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    name: "web_search",
    description: "在互联网上搜索关键词，返回结果标题和链接。适用于最新资讯、文档入口、资料定位。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "number", description: "返回条数，默认 5，最大 10" },
      },
      required: ["query"],
    },
    async execute(input) {
      const query = input.query.trim();
      if (!query) throw new Error("query 不能为空");
      const limit = Math.min(10, Math.max(1, Number(input.limit || 5)));
      const timeout = withTimeout(timeoutMs);
      try {
        const res = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
          method: "GET",
          signal: timeout.signal,
          headers: {
            "User-Agent": "RDKClaw/1.0 (+network-tool)",
          },
        });
        const html = await res.text();
        const results: Array<{ title: string; url: string }> = [];
        const regex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match: RegExpExecArray | null = null;
        while ((match = regex.exec(html)) && results.length < limit) {
          const url = parseDdgResultLink(match[1] || "");
          const title = stripHtml(match[2] || "").slice(0, 120);
          if (!url || !title) continue;
          results.push({ title, url });
        }
        if (results.length === 0) {
          return `query: ${query}\n未检索到结果（可能被目标站点限制或网络波动）。`;
        }
        const lines = results.map((item, i) => `${i + 1}. ${item.title}\n   ${item.url}`);
        return `query: ${query}\nresults:\n${lines.join("\n")}`;
      } finally {
        timeout.clear();
      }
    },
  };
}

function webFetchTool(options: WebToolOptions): Tool<{ url: string; maxChars?: number }> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxFetchChars = Math.max(2000, options.maxFetchChars ?? DEFAULT_MAX_FETCH_CHARS);
  return {
    name: "web_fetch",
    description: "抓取指定网页内容并转为可读文本。适用于文档、公告、博客正文提取。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "要抓取的网页 URL（http/https）" },
        maxChars: { type: "number", description: "最大输出字符数，默认使用系统策略值" },
      },
      required: ["url"],
    },
    async execute(input) {
      const url = normalizeUrl(input.url);
      const maxChars = Math.max(2000, Math.min(120_000, Number(input.maxChars || maxFetchChars)));
      const timeout = withTimeout(timeoutMs);
      try {
        const res = await fetch(url, {
          method: "GET",
          signal: timeout.signal,
          headers: {
            "User-Agent": "RDKClaw/1.0 (+network-tool)",
            Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
          },
        });
        const contentType = (res.headers.get("content-type") || "").toLowerCase();
        const raw = await res.text();
        const text = contentType.includes("html") ? stripHtml(raw) : raw.trim();
        return `source: ${url}\ncontent_type: ${contentType || "unknown"}\nfetched_at: ${new Date().toISOString()}\n\n${truncate(text, maxChars)}`;
      } finally {
        timeout.clear();
      }
    },
  };
}

function webExtractTool(options: WebToolOptions): Tool<{ content: string; question?: string; maxPoints?: number }> {
  const maxFetchChars = Math.max(2000, options.maxFetchChars ?? DEFAULT_MAX_FETCH_CHARS);
  return {
    name: "web_extract",
    description: "对已抓取内容做结构化提取，输出要点、证据句与来源链接。",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "web_fetch 返回的文本内容" },
        question: { type: "string", description: "可选，聚焦提问" },
        maxPoints: { type: "number", description: "最多提取要点数量，默认 5" },
      },
      required: ["content"],
    },
    async execute(input) {
      const content = String(input.content || "").trim();
      if (!content) throw new Error("content 不能为空");
      const question = String(input.question || "").trim();
      const maxPoints = Math.min(10, Math.max(1, Number(input.maxPoints || 5)));
      const srcMatch = content.match(/source:\s*(https?:\/\/\S+)/i);
      const source = srcMatch?.[1] || "";
      const body = content.replace(/^source:.*$/im, "").replace(/^content_type:.*$/im, "").replace(/^fetched_at:.*$/im, "").trim();
      const cleanBody = truncate(body, Math.min(maxFetchChars, 80_000));
      const sentences = cleanBody
        .split(/[。！？!?\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 12);
      const keywords = question ? question.toLowerCase().split(/\s+|，|。|、|,|\./).filter(Boolean) : [];
      const scored = sentences.map((s) => {
        const lower = s.toLowerCase();
        const score = keywords.reduce((acc, k) => (lower.includes(k) ? acc + 1 : acc), 0) + Math.min(3, Math.floor(s.length / 80));
        return { s, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, maxPoints).map((x) => x.s);
      const urlMatches = Array.from(cleanBody.matchAll(/https?:\/\/[^\s)]+/g)).map((m) => m[0]);
      const uniqUrls = Array.from(new Set(urlMatches)).slice(0, 10);
      return [
        `question: ${question || "无（按全文提炼）"}`,
        source ? `source: ${source}` : "source: unknown",
        "points:",
        ...top.map((item, i) => `${i + 1}. ${item}`),
        uniqUrls.length > 0 ? `references:\n${uniqUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}` : "references:\n(未检测到显式链接)",
        "memory_hint: 若本次结论对后续有长期价值，请调用 rdkclaw_memory_append_daily 进行沉淀。",
      ].join("\n");
    },
  };
}

export function createWebTools(options: WebToolOptions = {}): Tool[] {
  return [
    webSearchTool(options),
    webFetchTool(options),
    webExtractTool(options),
  ];
}

