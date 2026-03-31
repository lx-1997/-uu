import type { Tool } from "./types.js";
import { decodeEntities, normalizeUrl, stripHtml, truncate } from "./web-text-utils.js";
import type { WebToolOptions } from "./web-tool-options.js";
import { createBrowserFetchTools } from "./browser-tools.js";

export type { WebToolOptions };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_FETCH_CHARS = 16_000;
/** 网络请求最大重试次数 */
const MAX_NETWORK_RETRIES = 2;

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/** 从原始 HTML 取 title / meta description，用于正文过短时的补充（常见于 SEO / 部分静态壳） */
function extractHtmlAuxiliaryText(html: string): { title?: string; description?: string } {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripHtml(titleM[1] || "").slice(0, 300) : undefined;
  const metaM = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
  ) || html.match(
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i,
  );
  const description = metaM ? stripHtml(metaM[1] || "").slice(0, 500) : undefined;
  return {
    title: title?.trim() || undefined,
    description: description?.trim() || undefined,
  };
}

/** 服务端 fetch 常见「壳 HTML」：正文需浏览器执行 JS 才出现 */
function looksLikeClientRenderedShell(html: string, strippedLen: number): boolean {
  if (strippedLen > 600) return false;
  const h = html.slice(0, 120_000).toLowerCase();
  const markers =
    /id=["']root["']|id=["']__next["']|id=["']app["']|__next_data__|data-reactroot|ng-app|vite\/client|createRoot\(|vue\.createApp|nuxt|sveltekit|data-v-/.test(
      h,
    );
  return markers && strippedLen < 500;
}

/**
 * Next.js 页面常带 __NEXT_DATA__；若 pageProps 为空则 SSR 未注入详情（与地瓜 NodeHub 详情页行为一致）。
 */
function analyzeNextJsEmbeddedData(html: string): string | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*type="application\/json">([\s\S]*?)<\/script>/i);
  if (!m?.[1]) return null;
  try {
    const d = JSON.parse(m[1]) as {
      props?: { pageProps?: Record<string, unknown> };
      query?: Record<string, string>;
      page?: string;
    };
    const pp = d.props?.pageProps;
    const pagePath = String(d.page || "");
    const q = d.query || {};
    const keys = pp && typeof pp === "object" ? Object.keys(pp) : [];
    if (keys.length === 0) {
      const idHint = q.id ? `路由 id=${q.id}` : "";
      if (pagePath.includes("nodehub") || pagePath.includes("Nodehub")) {
        return `Next.js __NEXT_DATA__: pageProps 为空，NodeHub 详情由浏览器异步加载；${idHint}。若已配置 TAVILY_API_KEY，web_fetch 会自动尝试 Tavily Extract（advanced）兜底；若仍不足需人工在网页复制或向官方要详情 API。`;
      }
      return `Next.js __NEXT_DATA__: pageProps 为空，正文多为客户端请求后渲染。${idHint}`;
    }
    return `Next.js __NEXT_DATA__: SSR 含 pageProps（键: ${keys.slice(0, 12).join(", ")}）`;
  } catch {
    return null;
  }
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

/** DuckDuckGo 经典 HTML 与 lite 页会换 class/结构，多模式提取并去重 */
function extractDdgHtmlResults(html: string, limit: number): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  const push = (href: string, inner: string) => {
    const raw = href.trim();
    if (!raw || raw === "#" || raw.startsWith("javascript:")) return;
    let url = parseDdgResultLink(raw);
    try {
      const u = new URL(url);
      if (u.hostname.includes("duckduckgo.com") && !u.searchParams.get("uddg")) return;
    } catch {
      return;
    }
    const title = stripHtml(inner).slice(0, 200).trim();
    if (!title || title.length < 2) return;
    const key = url.split("#")[0] || url;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, url });
  };

  const patterns: RegExp[] = [
    /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]*class="[^"]*\bresult-link\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]+href="([^"]*duckduckgo\.com\/l\/\?[^"]*uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const regex of patterns) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) && out.length < limit) {
      push(m[1] || "", m[2] || "");
    }
    if (out.length >= limit) break;
  }

  return out.slice(0, limit);
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** web_fetch 与浏览器行为略对齐，减少被站点直接挡掉 */
const PAGE_FETCH_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.5,*/*;q=0.3",
  "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * GET 拉取正文；对网络错误与 502/503/504 各重试一次（与常见「类浏览器」容错一致）
 */
async function httpGetPageText(
  url: string,
  signal: AbortSignal,
): Promise<{ res: Response; text: string; retried: boolean }> {
  const doFetch = async () => {
    const res = await fetch(url, {
      method: "GET",
      signal,
      headers: PAGE_FETCH_HEADERS,
      redirect: "follow",
    });
    const text = await res.text();
    return { res, text };
  };

  try {
    let { res, text } = await doFetch();
    if ([502, 503, 504].includes(res.status)) {
      await new Promise((r) => setTimeout(r, 450));
      const second = await doFetch();
      return { res: second.res, text: second.text, retried: true };
    }
    return { res, text, retried: false };
  } catch (firstErr) {
    await new Promise((r) => setTimeout(r, 450));
    const { res, text } = await doFetch();
    return { res, text, retried: true };
  }
}

const DDG_FETCH_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

async function fetchDuckDuckGoHtml(
  query: string,
  signal: AbortSignal,
): Promise<Array<{ html: string; status: number; via: string }>> {
  const q = encodeURIComponent(query);
  const out: Array<{ html: string; status: number; via: string }> = [];

  const push = async (
    label: string,
    fn: () => Promise<Response>,
  ) => {
    try {
      const res = await fn();
      const text = await res.text();
      if (text.length > 80) {
        out.push({ html: text, status: res.status, via: label });
      }
    } catch {
      /* 下一来源 */
    }
  };

  await push("html.duckduckgo.com POST", () =>
    fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      signal,
      headers: {
        ...DDG_FETCH_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://duckduckgo.com/",
      },
      body: `q=${q}`,
    }),
  );
  await push("duckduckgo.com/html GET", () =>
    fetch(`https://duckduckgo.com/html/?q=${q}`, {
      method: "GET",
      signal,
      headers: { ...DDG_FETCH_HEADERS, Referer: "https://duckduckgo.com/" },
    }),
  );
  await push("lite.duckduckgo.com", () =>
    fetch(`https://lite.duckduckgo.com/lite/?q=${q}`, {
      method: "GET",
      signal,
      headers: { ...DDG_FETCH_HEADERS, Referer: "https://duckduckgo.com/" },
    }),
  );

  return out;
}

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

/** 地瓜 NodeHub 详情页：首屏无 pageProps 或正文极短时，用 Tavily Extract 再拉一层（见 docs.tavily.com /extract） */
function shouldTavilyExtractDroboticsNodeHub(rawHtml: string, strippedText: string, pageUrl: string): boolean {
  if (!(process.env.TAVILY_API_KEY || "").trim()) return false;
  try {
    const u = new URL(pageUrl);
    if (u.hostname !== "developer.d-robotics.cc") return false;
    if (!/nodehubdetail|\/nodehub\/detail\//i.test(u.pathname)) return false;
    const nextHint = analyzeNextJsEmbeddedData(rawHtml);
    if (nextHint && nextHint.includes("pageProps 为空")) return true;
    if (strippedText.length < 500) return true;
    return false;
  } catch {
    return false;
  }
}

/** 消耗 Tavily Extract 额度（advanced 约 2 credits/5 URLs，以官方计费为准） */
async function tavilyExtractPageMarkdown(pageUrl: string): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  const apiKey = (process.env.TAVILY_API_KEY || "").trim();
  if (!apiKey) return { ok: false, error: "TAVILY_API_KEY 未配置" };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 32_000);
  try {
    const res = await fetch(TAVILY_EXTRACT_URL, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        urls: [pageUrl],
        extract_depth: "advanced",
        format: "markdown",
        timeout: 25,
      }),
    });
    const rawText = await res.text();
    if (!res.ok) {
      let detail = rawText.slice(0, 400);
      try {
        const j = JSON.parse(rawText) as { detail?: { error?: string } };
        if (j?.detail?.error) detail = j.detail.error;
      } catch {
        /* 保持截断 */
      }
      return { ok: false, error: detail || `HTTP ${res.status}` };
    }
    const data = JSON.parse(rawText) as {
      results?: Array<{ raw_content?: string }>;
      failed_results?: Array<{ error?: string }>;
    };
    const r = data.results?.[0];
    if (r?.raw_content && String(r.raw_content).trim().length > 30) {
      return { ok: true, markdown: String(r.raw_content).trim() };
    }
    const fail = data.failed_results?.[0];
    return { ok: false, error: fail?.error || "extract 无 raw_content（页面可能仍依赖登录或强反爬）" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("abort") ? "Tavily Extract 超时" : msg };
  } finally {
    clearTimeout(timer);
  }
}

function snippetLine(text: string | undefined, max = 220) {
  if (!text) return "";
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max)}…`;
}

/** 见 https://docs.tavily.com/api-reference/endpoint/search — 需环境变量 TAVILY_API_KEY */
async function searchTavily(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<
  | {
      ok: true;
      results: Array<{ title: string; url: string; snippet?: string }>;
      answer?: string;
      responseTime?: number;
    }
  | { ok: false; reason: string; httpStatus?: number }
> {
  const apiKey = (process.env.TAVILY_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, reason: "TAVILY_API_KEY 未配置" };
  }

  const res = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: Math.min(20, limit),
      topic: "general",
      include_answer: false,
    }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    let detail = rawText.slice(0, 400);
    try {
      const j = JSON.parse(rawText) as { detail?: { error?: string } };
      if (j?.detail?.error) detail = j.detail.error;
    } catch {
      /* 保持原文截断 */
    }
    return { ok: false, reason: detail || `HTTP ${res.status}`, httpStatus: res.status };
  }

  let data: {
    query?: string;
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
    response_time?: number;
  };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    return { ok: false, reason: "Tavily 响应非 JSON" };
  }

  const results = (data.results || [])
    .map((r) => {
      const title = String(r.title || "").trim();
      const url = String(r.url || "").trim();
      if (!title || !url) return null;
      const snippet = r.content ? snippetLine(r.content) : undefined;
      return { title, url, snippet };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, limit);

  return {
    ok: true,
    results,
    answer: data.answer,
    responseTime: data.response_time,
  };
}

/** 产品策略：先 DDG（无 API 成本），解析不到再 Tavily（TAVILY_API_KEY） */
function extractDdgResultsFromPages(
  pages: Array<{ html: string; status: number; via: string }>,
  limit: number,
): { results: Array<{ title: string; url: string }>; via: string; status: number } | null {
  for (const page of pages) {
    const parsed = extractDdgHtmlResults(page.html, limit);
    if (parsed.length > 0) {
      return { results: parsed, via: page.via, status: page.status };
    }
  }
  return null;
}

function formatDdgSearchOutput(
  query: string,
  pages: Array<{ html: string; status: number; via: string }>,
  limit: number,
): string {
  const got = extractDdgResultsFromPages(pages, limit);
  if (!got) {
    const last = pages[pages.length - 1];
    const hint = last
      ? last.status >= 400
        ? `最后一跳 HTTP ${last.status}（${last.via}）。`
        : `已尝试 ${pages.length} 种入口，解析到 0 条（末页约 ${last.html.length} 字符，${last.via}）。可能被反爬拦截、页面结构变更或网络不稳定；可换更短/英文关键词，或直接对已知文档 URL 使用 web_fetch。`
      : "未能从 DuckDuckGo 拉取到页面（网络或 TLS 问题）。";
    return `query: ${query}\n未检索到可用结果。\n${hint}`;
  }
  const lines = got.results.map((item, i) => `${i + 1}. ${item.title}\n   ${item.url}`);
  return `query: ${query}\nengine: DuckDuckGo (${got.via}${got.status ? `, http ${got.status}` : ""})\nresults:\n${lines.join("\n")}`;
}

function webSearchTool(options: WebToolOptions): Tool<{ query: string; limit?: number }> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const hasTavily = !!(process.env.TAVILY_API_KEY || "").trim();
  return {
    name: "web_search",
    description: hasTavily
      ? "在互联网上搜索关键词，返回标题、链接与（若有）摘要。优先 DuckDuckGo 网页解析；无可用结果时再调用 Tavily API。需要全文可对结果 URL 再使用 web_fetch。"
      : "在互联网上搜索关键词，返回结果标题和链接（DuckDuckGo 网页解析；可在服务端配置 TAVILY_API_KEY，在无结果时启用 Tavily 兜底）。需要正文请对链接再使用 web_fetch。",
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

      // 网络请求重试：DNS/TLS 首次慢或临时网络波动
      let lastError: Error | null = null;
      for (let retry = 0; retry <= MAX_NETWORK_RETRIES; retry++) {
        const timeout = withTimeout(timeoutMs);
        try {
          const pages = await fetchDuckDuckGoHtml(query, timeout.signal);
          const ddg = extractDdgResultsFromPages(pages, limit);
          if (ddg && ddg.results.length > 0) {
            const lines = ddg.results.map((item, i) => `${i + 1}. ${item.title}\n   ${item.url}`);
            return `query: ${query}\nengine: DuckDuckGo (${ddg.via}${ddg.status ? `, http ${ddg.status}` : ""})\nresults:\n${lines.join("\n")}`;
          }

          if ((process.env.TAVILY_API_KEY || "").trim()) {
            try {
              const tv = await searchTavily(query, limit, timeout.signal);
              if (tv.ok && tv.results.length > 0) {
                const lines = tv.results.map((item, i) => {
                  const sn = item.snippet ? `\n   snippet: ${item.snippet}` : "";
                  return `${i + 1}. ${item.title}\n   ${item.url}${sn}`;
                });
                const rt =
                  tv.responseTime !== undefined ? `, ${tv.responseTime.toFixed(2)}s` : "";
                return `query: ${query}\nengine: Tavily (basic${rt}, fallback after DDG empty)\nresults:\n${lines.join("\n")}`;
              }
              const ddgFail = formatDdgSearchOutput(query, pages, limit);
              const tvNote = !tv.ok
                ? `Tavily 不可用（${tv.httpStatus ?? "?"}）：${tv.reason}`
                : "Tavily 返回 0 条";
              return `${ddgFail}\n\n[注] ${tvNote}`;
            } catch (e) {
              const ddgFail = formatDdgSearchOutput(query, pages, limit);
              return `${ddgFail}\n\n[注] Tavily 请求异常：${e instanceof Error ? e.message : String(e)}`;
            }
          }

          return formatDdgSearchOutput(query, pages, limit);
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (retry < MAX_NETWORK_RETRIES) {
            console.warn(`[web_search] retry ${retry + 1}/${MAX_NETWORK_RETRIES}: ${lastError.message}`);
            continue;
          }
        } finally {
          timeout.clear();
        }
      }
      throw lastError ?? new Error("web_search failed");
    },
  };
}

function webFetchTool(options: WebToolOptions): Tool<{ url: string; maxChars?: number }> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxFetchChars = Math.max(2000, options.maxFetchChars ?? DEFAULT_MAX_FETCH_CHARS);
  return {
    name: "web_fetch",
    description:
      "抓取指定 URL 的响应体并转为可读文本（GET，跟随重定向）。HTML 会剥标签。对 developer.d-robotics.cc 的 NodeHub 详情页，若首屏无正文且已配置 TAVILY_API_KEY，会自动追加 Tavily Extract（advanced）结果。非 2xx 仍会返回状态码与部分正文。",
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
        const { res, text: raw, retried } = await httpGetPageText(url, timeout.signal);
        const contentType = (res.headers.get("content-type") || "").toLowerCase();
        const isHtml = contentType.includes("html") || /^<!DOCTYPE html|<html[\s>]/i.test(raw.slice(0, 400));

        let text = isHtml ? stripHtml(raw) : raw.trim();
        let auxNote = "";
        if (isHtml) {
          const aux = extractHtmlAuxiliaryText(raw);
          if (text.length < 120 && (aux.description || aux.title)) {
            const parts = [aux.title && `title: ${aux.title}`, aux.description && `meta_description: ${aux.description}`].filter(
              Boolean,
            );
            text = `${text}\n\n${parts.join("\n")}`.trim();
            auxNote = "（已附加 title/meta 摘要：正文过短）";
          }
        }

        const spaHint = isHtml && looksLikeClientRenderedShell(raw, text.length)
          ? "\nfetch_hint: 该页疑似前端渲染（服务端仅收到壳 HTML）。可改用 web_search 找文档镜像、或向用户要静态文档链接/API。"
          : "";

        const nextHint = isHtml ? analyzeNextJsEmbeddedData(raw) : null;
        const nextBlock = nextHint ? `\nframework_hint: ${nextHint}` : "";

        const statusLine = `http_status: ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
        const okLine = res.ok ? "http_ok: true" : "http_ok: false";
        const retryLine = retried ? "retried: true（曾自动重试 1 次）" : "";

        const head = [
          `source: ${url}`,
          statusLine,
          okLine,
          `content_type: ${contentType || "unknown"}`,
          `fetched_at: ${new Date().toISOString()}`,
          retryLine,
          auxNote && `note: ${auxNote}`,
        ]
          .filter(Boolean)
          .join("\n");

        const body = truncate(text, maxChars);
        const errBanner = !res.ok ? `\nfetch_warning: HTTP ${res.status}，以下为响应体提取，请谨慎采信。\n` : "\n";

        let tavilyExtractBlock = "";
        if (isHtml && shouldTavilyExtractDroboticsNodeHub(raw, text, url)) {
          const tv = await tavilyExtractPageMarkdown(url);
          if (tv.ok) {
            tavilyExtractBlock = `\n---\ntavily_extract_ok: true\ntavily_extract (advanced, markdown):\n${truncate(tv.markdown, maxChars)}\n`;
          } else {
            tavilyExtractBlock = `\n---\ntavily_extract_ok: false\ntavily_extract_error: ${tv.error}\n`;
          }
        }

        return `${head}${errBanner}${body}${spaHint}${nextBlock}${tavilyExtractBlock}`;
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
    ...createBrowserFetchTools(options),
  ];
}

