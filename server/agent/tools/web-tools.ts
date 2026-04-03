import type { Tool } from "./types.js";
import { decodeEntities, normalizeUrl, stripHtml, truncate } from "./web-text-utils.js";
import type { WebToolOptions } from "./web-tool-options.js";
import { createBrowserFetchTools } from "./browser-tools.js";

export type { WebToolOptions };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_FETCH_CHARS = 16_000;
/** 网络请求最大重试次数 */
const MAX_NETWORK_RETRIES = 2;

/** 连续汉字（含扩展区）：对足够长的片段加英文双引号，提示搜索引擎按「精确短语」匹配，减轻分词把品牌/专名拆成前缀字导致的跑偏。 */
const CJK_RUN_RE = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;

const MIN_CJK_PHRASE_QUOTE_LEN = 3;

function applyCjkPhraseQuotes(raw: string): { query: string; changed: boolean } {
  const q = raw.trim();
  if (!q) return { query: q, changed: false };
  let changed = false;
  const out = q.replace(CJK_RUN_RE, (run, offset) => {
    if (run.length < MIN_CJK_PHRASE_QUOTE_LEN) return run;
    const before = offset > 0 ? q[offset - 1] : "";
    const after = offset + run.length < q.length ? q[offset + run.length] : "";
    if (before === '"' && after === '"') return run;
    changed = true;
    return `"${run}"`;
  });
  return { query: out, changed };
}

/**
 * 不改变模型传入的语义，只做送引擎前的通用规范化。
 * 若模型把「泡泡玛特」截成「泡泡」，服务端无法可靠猜回全称——须在工具契约中禁止截断专名；输出里会并列展示 tool_argument 与 search_query 以便核对。
 */
function prepareWebSearchQuery(raw: string): { query: string; expansionNote?: string } {
  const q0 = raw.trim();
  if (!q0) return { query: q0 };
  const { query, changed } = applyCjkPhraseQuotes(q0);
  if (!changed) return { query };
  return {
    query,
    expansionNote: `已为连续中文专名片段（≥${MIN_CJK_PHRASE_QUOTE_LEN} 字）添加精确短语引号再送搜索引擎，减轻整词被拆分成单字义项的噪声命中`,
  };
}

/**
 * 整段 query 仅为单个高歧义 token 时返回拒绝原因文案，否则返回 null。
 * 多词（如「pop music」「泡泡 战士」）一律放行，避免误伤。
 */
export function ambiguousSoleWebSearchQueryReason(raw: string): string | null {
  const q0 = raw.trim();
  if (!q0) return null;
  const stripped = q0.replace(/^["']+|["']+$/g, "").trim();
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) return null;
  const one = tokens[0];
  if (one === "泡泡") {
    return "web_search 被拒：仅「泡泡」歧义过大。请改为完整品牌名（如「泡泡玛特」），港股可再加股份代号 09992。";
  }
  if (/^pop$/i.test(one)) {
    return "web_search 被拒：仅「pop」歧义过大。若指 Pop Mart 请用「Pop Mart」「泡泡玛特」等并可加 09992；其他主题请补充限定词（如「pop music」）。";
  }
  return null;
}

function envFlagTrue(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

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
    // 如果已经被 abort，不要重试
    if (signal.aborted) throw firstErr;
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

function formatWebSearchResults(
  query: string,
  engineLine: string,
  results: Array<{ title: string; url: string; snippet?: string }>,
  opts?: { toolArgument?: string },
): string {
  const lines = results.map((item, i) => {
    const sn = item.snippet ? `\n   snippet: ${item.snippet}` : "";
    return `${i + 1}. ${item.title}\n   ${item.url}${sn}`;
  });
  const arg = opts?.toolArgument;
  const head =
    arg !== undefined
      ? `tool_argument: ${arg.trim()}\nsearch_query: ${query}\n`
      : `query: ${query}\n`;
  return `${head}engine: ${engineLine}\nresults:\n${lines.join("\n")}`;
}

/** 必应中国（cn.bing.com）PC 页：每条自然结果多为 <li class="b_algo"> 内 <h2><a href> */
function extractBingChinaHtmlResults(html: string, limit: number): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const rawHref = (m[1] || "").trim();
    if (!rawHref || rawHref.startsWith("javascript:")) continue;
    let url: string;
    try {
      url = new URL(rawHref, "https://cn.bing.com").toString();
    } catch {
      continue;
    }
    try {
      const u = new URL(url);
      if ((u.hostname === "cn.bing.com" || u.hostname === "www.bing.com") && u.pathname.startsWith("/search")) {
        continue;
      }
    } catch {
      continue;
    }
    const title = stripHtml(m[2] || "").slice(0, 200).trim();
    if (!title || title.length < 2) continue;
    const key = url.split("#")[0] || url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url });
  }
  return out.slice(0, limit);
}

/** 与 skills/multi-search-engine/config.json 中 Bing CN / Bing INT 模板对齐 */
async function fetchBingSerpHtml(
  query: string,
  signal: AbortSignal,
  variant: "cn" | "intl",
): Promise<Array<{ html: string; status: number; via: string }>> {
  const q = encodeURIComponent(query);
  const out: Array<{ html: string; status: number; via: string }> = [];
  const url =
    variant === "cn"
      ? `https://cn.bing.com/search?q=${q}&setlang=zh-cn`
      : `https://cn.bing.com/search?q=${q}&ensearch=1`;
  const via = variant === "cn" ? "cn.bing.com(zh)" : "cn.bing.com(intl)";
  try {
    const res = await fetch(url, {
      method: "GET",
      signal,
      headers: { ...DDG_FETCH_HEADERS, Referer: "https://cn.bing.com/" },
    });
    const text = await res.text();
    if (text.length > 80) {
      out.push({ html: text, status: res.status, via });
    }
  } catch {
    /* 下一来源 */
  }
  return out;
}

function looksLikeBaiduCaptcha(html: string): boolean {
  const h = html.slice(0, 12_000);
  return /wappass\.baidu\.com|安全验证|请输入验证码|authcenter\.baidu/i.test(h);
}

async function fetchBaiduSerpHtml(
  query: string,
  signal: AbortSignal,
): Promise<Array<{ html: string; status: number; via: string }>> {
  const q = encodeURIComponent(query);
  const out: Array<{ html: string; status: number; via: string }> = [];
  try {
    const res = await fetch(`https://www.baidu.com/s?wd=${q}&ie=utf-8`, {
      method: "GET",
      signal,
      headers: { ...DDG_FETCH_HEADERS, Referer: "https://www.baidu.com/" },
    });
    const text = await res.text();
    if (text.length > 80) {
      out.push({ html: text, status: res.status, via: "www.baidu.com" });
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** 百度 PC 结果常见：<h3 class="t"><a href=...>title</a> */
function extractBaiduHtmlResults(html: string, limit: number): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  const re =
    /<h3[^>]*class="[^"]*\bt\b[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const rawHref = (m[1] || "").trim();
    if (!rawHref || rawHref.startsWith("javascript:")) continue;
    let url: string;
    try {
      url = new URL(rawHref, "https://www.baidu.com").toString();
    } catch {
      continue;
    }
    const title = stripHtml(m[2] || "").slice(0, 200).trim();
    if (!title || title.length < 2) continue;
    const key = url.split("#")[0] || url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url });
  }
  return out.slice(0, limit);
}

function extractBingResultsFromPages(
  pages: Array<{ html: string; status: number; via: string }>,
  limit: number,
): { results: Array<{ title: string; url: string }>; via: string; status: number } | null {
  for (const page of pages) {
    const parsed = extractBingChinaHtmlResults(page.html, limit);
    if (parsed.length > 0) {
      return { results: parsed, via: page.via, status: page.status };
    }
  }
  return null;
}

/**
 * DDG 连通性缓存：首次失败后标记不可用，避免后续请求重复等待。
 * 每 5 分钟重置一次，给 DDG 恢复的机会。
 */
let ddgAvailable = true;
let ddgLastCheckMs = 0;
const DDG_RECHECK_INTERVAL_MS = 5 * 60 * 1000;

async function fetchDuckDuckGoHtml(
  query: string,
  signal: AbortSignal,
): Promise<Array<{ html: string; status: number; via: string }>> {
  // 连通性缓存：DDG 不可用时直接跳过
  const now = Date.now();
  if (!ddgAvailable && now - ddgLastCheckMs < DDG_RECHECK_INTERVAL_MS) {
    return [];
  }

  const q = encodeURIComponent(query);
  const out: Array<{ html: string; status: number; via: string }> = [];

  // DDG 快速超时：国内环境 8 秒没响应基本就是不通
  const DDG_FAST_TIMEOUT_MS = 8000;
  const ddgSignal = AbortSignal.any
    ? AbortSignal.any([signal, AbortSignal.timeout(DDG_FAST_TIMEOUT_MS)])
    : signal;

  const tryFetch = async (
    label: string,
    fn: () => Promise<Response>,
  ): Promise<{ html: string; status: number; via: string } | null> => {
    try {
      const res = await fn();
      const text = await res.text();
      if (text.length > 80) {
        return { html: text, status: res.status, via: label };
      }
    } catch {
      /* 下一来源 */
    }
    return null;
  };

  // 并行请求所有 DDG 端点（而非串行），取第一个成功的
  const results = await Promise.allSettled([
    tryFetch("html.duckduckgo.com POST", () =>
      fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        signal: ddgSignal,
        headers: {
          ...DDG_FETCH_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: "https://duckduckgo.com/",
        },
        body: `q=${q}`,
      }),
    ),
    tryFetch("duckduckgo.com/html GET", () =>
      fetch(`https://duckduckgo.com/html/?q=${q}`, {
        method: "GET",
        signal: ddgSignal,
        headers: { ...DDG_FETCH_HEADERS, Referer: "https://duckduckgo.com/" },
      }),
    ),
    tryFetch("lite.duckduckgo.com", () =>
      fetch(`https://lite.duckduckgo.com/lite/?q=${q}`, {
        method: "GET",
        signal: ddgSignal,
        headers: { ...DDG_FETCH_HEADERS, Referer: "https://duckduckgo.com/" },
      }),
    ),
  ]);

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      out.push(r.value);
    }
  }

  // 更新连通性缓存
  if (out.length === 0) {
    ddgAvailable = false;
    ddgLastCheckMs = now;
  } else {
    ddgAvailable = true;
  }

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

/** 从 DuckDuckGo HTML 页解析结果条 */
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

type WebSearchDdgFailCtx = { tavilyFirstChain: boolean; tavilyAfterDomesticChain: boolean };

function formatDdgSearchOutput(
  query: string,
  pages: Array<{ html: string; status: number; via: string }>,
  limit: number,
  failCtx?: WebSearchDdgFailCtx,
  opts?: { toolArgument?: string },
): string {
  const ctx = failCtx ?? { tavilyFirstChain: false, tavilyAfterDomesticChain: false };
  const got = extractDdgResultsFromPages(pages, limit);
  const arg = opts?.toolArgument;
  const qHead =
    arg !== undefined ? `tool_argument: ${arg.trim()}\nsearch_query: ${query}\n` : `query: ${query}\n`;
  if (!got) {
    const last = pages[pages.length - 1];
    const hint = last
      ? last.status >= 400
        ? `DuckDuckGo 最后一跳 HTTP ${last.status}（${last.via}）。`
        : `DuckDuckGo 已尝试 ${pages.length} 种入口，解析到 0 条（末页约 ${last.html.length} 字符，${last.via}）。可能被反爬拦截、页面结构变更或网络不稳定；可换更短/英文关键词，或直接对已知文档 URL 使用 web_fetch。`
      : "未能从 DuckDuckGo 拉取到页面（网络或 TLS 问题）。";
    let chain: string;
    if (ctx.tavilyFirstChain) {
      chain =
        "已依次尝试：Tavily、联网搜索首选 Multi-Search-Engine（多引擎顺序：百度→必应中国→必应国际→DuckDuckGo）。";
    } else if (ctx.tavilyAfterDomesticChain) {
      chain =
        "已依次尝试：联网搜索首选 Multi-Search-Engine（多引擎顺序：百度→必应中国→必应国际→DuckDuckGo）、Tavily。";
    } else {
      chain =
        "已依次尝试：联网搜索首选 Multi-Search-Engine（多引擎顺序：百度→必应中国→必应国际→DuckDuckGo）。";
    }
    return `${qHead}未检索到可用结果。\n${chain}\n${hint}`;
  }
  return formatWebSearchResults(
    query,
    `DuckDuckGo (${got.via}${got.status ? `, http ${got.status}` : ""})`,
    got.results,
    opts,
  );
}

function webSearchTool(options: WebToolOptions): Tool<{ query: string; limit?: number }> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    name: "web_search",
    description:
      "在互联网上搜索关键词，返回标题、链接与（若有）摘要。**联网搜索首选 Multi-Search-Engine（多引擎顺序）**（RDKClaw 本机）：按仓库 `skills/multi-search-engine` 的引擎列表依次请求，当前已实现顺序为 百度→必应（中国）→必应（国际）→DuckDuckGo，零密钥。配置 `TAVILY_API_KEY` 后，可在该链路无结果时再调 Tavily（计费）；若需 Tavily 先于 Multi-Search-Engine，设环境变量 `WEB_SEARCH_TAVILY_FIRST=1`。可对命中 URL 再 `web_fetch`。**关键**：`query` 必须与你在推理里决定使用的关键词一致；品牌名、公司名、产品名等**专有名词须完整逐字写入**，禁止缩成更易歧义的前缀（中文：「泡泡玛特」不得只传「泡泡」；英文：`Pop Mart` 不得只传 `pop`）。**上市公司**检索宜在 query 中同时包含 **证券简称/全称 + 交易所代号**（例：`泡泡玛特 09992 回购`）。中文连续专名（≥3 字）服务端可能自动加短语引号以减轻分词跑偏。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "搜索关键词：与推理中计划的检索词一致；专名、品牌全称完整输入（勿「泡泡」「pop」等歧义缩写）；港股可含代号如 09992。",
        },
        limit: { type: "number", description: "返回条数，默认 5，最大 10" },
      },
      required: ["query"],
    },
    async execute(input) {
      const toolArgument = input.query.trim();
      const ambiguous = ambiguousSoleWebSearchQueryReason(input.query);
      if (ambiguous) throw new Error(ambiguous);
      const { query: preparedQuery, expansionNote } = prepareWebSearchQuery(input.query);
      const query = preparedQuery;
      if (!query) throw new Error("query 不能为空");
      const limit = Math.min(10, Math.max(1, Number(input.limit || 5)));
      const expansionFoot = expansionNote ? `\n\n[query_expansion] ${expansionNote}` : "";
      const fmtOpts = { toolArgument };
      const finalize = (body: string) => body + expansionFoot;

      // 网络请求重试：DNS/TLS 首次慢或临时网络波动
      let lastError: Error | null = null;
      for (let retry = 0; retry <= MAX_NETWORK_RETRIES; retry++) {
        const timeout = withTimeout(timeoutMs);
        try {
          const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();
          const hasTavily = !!tavilyKey;
          const tavilyWantsFirst = envFlagTrue("WEB_SEARCH_TAVILY_FIRST");

          let tavilyEarlyFailNote = "";
          if (hasTavily && tavilyWantsFirst) {
            try {
              const tv = await searchTavily(query, limit, timeout.signal);
              if (tv.ok && tv.results.length > 0) {
                const rt =
                  tv.responseTime !== undefined ? `, ${tv.responseTime.toFixed(2)}s` : "";
                return finalize(
                  formatWebSearchResults(
                    query,
                    `Tavily (basic${rt}, WEB_SEARCH_TAVILY_FIRST 优先)`,
                    tv.results,
                    fmtOpts,
                  ),
                );
              }
              tavilyEarlyFailNote = !tv.ok
                ? `Tavily 不可用（${tv.httpStatus ?? "?"}）：${tv.reason}`
                : "Tavily 返回 0 条";
            } catch (e) {
              tavilyEarlyFailNote = `Tavily 请求异常：${e instanceof Error ? e.message : String(e)}`;
            }
          }

          const afterTavilyEarlyFoot =
            tavilyEarlyFailNote !== ""
              ? `\n\n[注] ${tavilyEarlyFailNote}；以下为 Multi-Search-Engine（多引擎顺序）链路命中。`
              : "";

          // 联网搜索首选 Multi-Search-Engine（多引擎顺序）；与 skills/multi-search-engine/config.json 前段一致
          const baiduPages = await fetchBaiduSerpHtml(query, timeout.signal);
          for (const bp of baiduPages) {
            if (looksLikeBaiduCaptcha(bp.html)) continue;
            const baiduResults = extractBaiduHtmlResults(bp.html, limit);
            if (baiduResults.length > 0) {
              return finalize(
                formatWebSearchResults(
                  query,
                  `百度 (${bp.via}${bp.status ? `, http ${bp.status}` : ""})`,
                  baiduResults,
                  fmtOpts,
                ) + afterTavilyEarlyFoot,
              );
            }
          }

          const bingCnPages = await fetchBingSerpHtml(query, timeout.signal, "cn");
          const bingCnGot = extractBingResultsFromPages(bingCnPages, limit);
          if (bingCnGot && bingCnGot.results.length > 0) {
            return finalize(
              formatWebSearchResults(
                query,
                `必应（中国）(${bingCnGot.via}${bingCnGot.status ? `, http ${bingCnGot.status}` : ""})`,
                bingCnGot.results,
                fmtOpts,
              ) + afterTavilyEarlyFoot,
            );
          }

          const bingIntlPages = await fetchBingSerpHtml(query, timeout.signal, "intl");
          const bingIntlGot = extractBingResultsFromPages(bingIntlPages, limit);
          if (bingIntlGot && bingIntlGot.results.length > 0) {
            return finalize(
              formatWebSearchResults(
                query,
                `必应（国际）(${bingIntlGot.via}${bingIntlGot.status ? `, http ${bingIntlGot.status}` : ""})`,
                bingIntlGot.results,
                fmtOpts,
              ) + afterTavilyEarlyFoot,
            );
          }

          const pages = await fetchDuckDuckGoHtml(query, timeout.signal);
          const ddg = extractDdgResultsFromPages(pages, limit);
          if (ddg && ddg.results.length > 0) {
            return finalize(
              formatWebSearchResults(
                query,
                `DuckDuckGo (${ddg.via}${ddg.status ? `, http ${ddg.status}` : ""})`,
                ddg.results,
                fmtOpts,
              ) + afterTavilyEarlyFoot,
            );
          }

          let tavilyLateNote = "";
          if (hasTavily && !tavilyWantsFirst) {
            try {
              const tv = await searchTavily(query, limit, timeout.signal);
              if (tv.ok && tv.results.length > 0) {
                const rt =
                  tv.responseTime !== undefined ? `, ${tv.responseTime.toFixed(2)}s` : "";
                return finalize(
                  formatWebSearchResults(
                    query,
                    `Tavily (basic${rt}, Multi-Search-Engine 链路无结果后补充)`,
                    tv.results,
                    fmtOpts,
                  ),
                );
              }
              tavilyLateNote = !tv.ok
                ? `Tavily 不可用（${tv.httpStatus ?? "?"}）：${tv.reason}`
                : "Tavily 返回 0 条";
            } catch (e) {
              tavilyLateNote = `Tavily 请求异常：${e instanceof Error ? e.message : String(e)}`;
            }
          }

          const ddgFail = formatDdgSearchOutput(
            query,
            pages,
            limit,
            {
              tavilyFirstChain: hasTavily && tavilyWantsFirst,
              tavilyAfterDomesticChain: hasTavily && !tavilyWantsFirst,
            },
            fmtOpts,
          );
          const extraNote = tavilyLateNote || tavilyEarlyFailNote;
          return finalize(extraNote ? `${ddgFail}\n\n[注] ${extraNote}` : ddgFail);
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

