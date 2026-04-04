/**
 * 技能公共注册表 HTTP 调用（与 clawhub CLI 使用的 `/api/v1/*` 形态一致）。
 * 默认使用国内 [SkillHub](https://skillhub.tencent.com) 同源后端（lightmake.site），避免 clawhub.ai 限流。
 * 可通过环境变量 `CLAWHUB_REGISTRY` 覆盖，例如 `https://clawhub.ai`。
 *
 * 含：429/限流文案重试、短期缓存、同 slug 并发合并，减轻 Rate limit exceeded。
 */
import JSZip from 'jszip';

/** SkillHub 与官网前端共用 API；勿改为 skillhub.tencent.com（该域对 `/api/v1/*` 会回退 SPA HTML） */
const DEFAULT_REGISTRY = 'https://lightmake.site';

/**
 * 腾讯 SkillHub 开放 API 基址（与 SkillHub 前端同源后端）。
 * RDKClaw 聚合检索时**固定优先**此端点，便于国内可达并与 `CLAWHUB_REGISTRY` 其它用途解耦。
 */
export const TENCENT_SKILLHUB_API_BASE = DEFAULT_REGISTRY;

/**
 * 官方 ClawHub 注册表 API 基址（与公开文档一致：`clawhub config set registry https://clawhub.ai`）。
 * `find_skills` 在腾讯 **零命中** 或 **请求失败** 时兜底查询；可用 `CLAWHUB_OFFICIAL_FALLBACK_BASE` 覆盖（需完整 https 基址，无尾斜杠）。
 */
export function getOfficialClawhubFallbackBase(): string {
  const raw = String(process.env.CLAWHUB_OFFICIAL_FALLBACK_BASE ?? 'https://clawhub.ai')
    .trim()
    .replace(/\/$/, '');
  return raw || 'https://clawhub.ai';
}

/** 部分 CDN 对无 UA 请求更严格限流 */
const CLAWHUB_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'RDK-Studio/SkillRegistry (https://github.com/D-Robotics; SkillHub mirror)',
} as const;

const MAX_HTTP_ATTEMPTS = 6;
/** 超时重试次数（DNS/TLS 首次慢，第二次通常有缓存） */
const MAX_TIMEOUT_RETRIES = 2;
const SKILL_MD_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

/** 单次出站 fetch 超时，避免首包 DNS/TLS 慢时无限挂起；重试每轮独立计时 */
const SEARCH_FETCH_TIMEOUT_MS = 55_000;
const JSON_FETCH_TIMEOUT_MS = 55_000;
const ZIP_FETCH_TIMEOUT_MS = 120_000;

type CachedSkillMd = { markdown: string; version: string; slug: string; cachedAt: number };

const skillMdCache = new Map<string, CachedSkillMd>();
const searchCache = new Map<string, { at: number; results: ClawhubSearchHit[] }>();
const inflightSearch = new Map<string, Promise<{ results: ClawhubSearchHit[] }>>();
const inflightSkillMd = new Map<string, Promise<CachedSkillMd>>();

export function getClawhubRegistryBase(): string {
  const raw = String(process.env.CLAWHUB_REGISTRY ?? '').trim();
  return raw.replace(/\/$/, '') || DEFAULT_REGISTRY;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  if (signal) {
    return fetch(url, { ...init, signal });
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const ra = headers.get('retry-after');
  if (!ra) return undefined;
  const n = parseInt(ra.trim(), 10);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 120);
  return undefined;
}

function isRateLimited(status: number, bodyText: string): boolean {
  if (status === 429) return true;
  return /rate\s*limit/i.test(bodyText);
}

type FetchTextOptions = { timeoutMs?: number };

async function fetchTextWithRetry(
  url: string,
  extraHeaders: Record<string, string>,
  options?: FetchTextOptions,
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? JSON_FETCH_TIMEOUT_MS;
  const headers = { ...CLAWHUB_HEADERS, ...extraHeaders };
  let timeoutRetries = 0;
  for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { method: 'GET', headers }, timeoutMs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = /abort|timeout/i.test(msg) || (e instanceof Error && e.name === 'AbortError');
      // 超时和网络错误都重试（DNS/TLS 首次慢，第二次通常有缓存）
      if (timeoutRetries < MAX_TIMEOUT_RETRIES) {
        timeoutRetries++;
        const reason = isTimeout ? 'timeout' : `network error (${msg})`;
        console.warn(`[clawhub] ${reason}, retry ${timeoutRetries}/${MAX_TIMEOUT_RETRIES}: ${url}`);
        if (!isTimeout) await sleep(1000);
        continue;
      }
      if (isTimeout) throw new Error('clawhub_fetch_timeout');
      throw e instanceof Error ? e : new Error(String(e));
    }
    const text = await res.text();
    if (isRateLimited(res.status, text)) {
      if (attempt >= MAX_HTTP_ATTEMPTS - 1) {
        throw new Error('clawhub_rate_limited');
      }
      const waitSec = parseRetryAfterSeconds(res.headers) ?? Math.min(2 ** attempt, 45);
      console.warn(`[clawhub] rate limited, retry in ${waitSec}s (attempt ${attempt + 1}/${MAX_HTTP_ATTEMPTS})`);
      await sleep(waitSec * 1000);
      continue;
    }
    if (!res.ok) {
      throw new Error(text || `HTTP ${res.status}`);
    }
    return text;
  }
  throw new Error('clawhub_rate_limited');
}

async function fetchBufferWithRetry(url: string): Promise<Uint8Array> {
  const headers = {
    Accept: 'application/octet-stream',
    'User-Agent': CLAWHUB_HEADERS['User-Agent'],
  };
  for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { method: 'GET', headers }, ZIP_FETCH_TIMEOUT_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort|timeout/i.test(msg) || (e instanceof Error && e.name === 'AbortError')) {
        throw new Error('clawhub_fetch_timeout');
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
    if (res.status === 429) {
      if (attempt >= MAX_HTTP_ATTEMPTS - 1) {
        throw new Error('clawhub_rate_limited');
      }
      const waitSec = parseRetryAfterSeconds(res.headers) ?? Math.min(2 ** attempt, 45);
      console.warn(`[clawhub] download rate limited, retry in ${waitSec}s`);
      await sleep(waitSec * 1000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (isRateLimited(res.status, text)) {
        if (attempt >= MAX_HTTP_ATTEMPTS - 1) {
          throw new Error('clawhub_rate_limited');
        }
        const waitSec = parseRetryAfterSeconds(res.headers) ?? Math.min(2 ** attempt, 45);
        await sleep(waitSec * 1000);
        continue;
      }
      throw new Error(text || `HTTP ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error('clawhub_rate_limited');
}

function assertSafeSlug(slug: string): string {
  const s = slug.trim();
  if (!s || !/^[a-zA-Z0-9._-]+$/.test(s)) {
    throw new Error('invalid_skill_slug');
  }
  return s;
}

export type ClawhubSearchHit = {
  slug: string;
  displayName?: string;
  summary?: string;
  score?: number;
  version?: string | null;
  updatedAt?: number;
};

/**
 * SkillHub `/api/v1/search` 常返回「语义/宽泛」命中，短关键词也会出现大量弱相关条目。
 * 在展示前按用户输入做二次过滤：多词时要求 slug/标题/摘要中**同时**出现各词（忽略大小写）。
 */
export function filterClawhubHitsByQuery(query: string, hits: ClawhubSearchHit[]): ClawhubSearchHit[] {
  const raw = query.trim().toLowerCase();
  if (!raw || hits.length === 0) return hits;
  const tokens = raw.split(/[\s\-_/]+/).filter((t) => t.length >= 2);

  const blobFor = (h: ClawhubSearchHit) =>
    `${h.slug} ${h.displayName ?? ''} ${h.summary ?? ''}`.toLowerCase();

  if (tokens.length === 0) {
    if (raw.length >= 2) {
      return hits.filter((h) => blobFor(h).includes(raw));
    }
    return hits;
  }

  if (tokens.length === 1) {
    const t = tokens[0];
    return hits.filter((h) => blobFor(h).includes(t));
  }

  return hits.filter((h) => {
    const blob = blobFor(h);
    return tokens.every((t) => blob.includes(t));
  });
}

/**
 * 在指定注册表基址上搜索（用于强制走腾讯 SkillHub 等，而不受 `CLAWHUB_REGISTRY` 影响）。
 */
export async function clawhubSearchAt(
  registryBase: string,
  query: string,
  limit = 20,
): Promise<{ results: ClawhubSearchHit[] }> {
  const base = String(registryBase || '').replace(/\/$/, '') || DEFAULT_REGISTRY;
  const q = query.trim();
  if (!q) return { results: [] };
  const lim = Math.min(50, Math.max(1, limit));
  const cacheKey = `searchAt:${base}\0${q.toLowerCase()}\0${lim}`;
  const now = Date.now();
  const hit = searchCache.get(cacheKey);
  if (hit && now - hit.at < SEARCH_CACHE_TTL_MS) {
    return { results: hit.results };
  }

  const pending = inflightSearch.get(cacheKey);
  if (pending) return pending;

  const p = (async () => {
    const url = new URL('/api/v1/search', `${base}/`);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(lim));
    const text = await fetchTextWithRetry(url.toString(), {}, { timeoutMs: SEARCH_FETCH_TIMEOUT_MS });
    const data = JSON.parse(text) as { results?: ClawhubSearchHit[] };
    const rawList = Array.isArray(data.results) ? data.results : [];
    const results = filterClawhubHitsByQuery(q, rawList);
    searchCache.set(cacheKey, { at: Date.now(), results });
    return { results };
  })();

  inflightSearch.set(cacheKey, p);
  p.finally(() => inflightSearch.delete(cacheKey));
  return p;
}

/** 使用环境变量 `CLAWHUB_REGISTRY` 或默认基址搜索（与 CLI/其它调用一致）。 */
export async function clawhubSearch(query: string, limit = 20): Promise<{ results: ClawhubSearchHit[] }> {
  return clawhubSearchAt(getClawhubRegistryBase(), query, limit);
}

/**
 * 进程启动后预热一次到注册表的连接（DNS/TLS/keep-alive），减轻用户首次点击搜索的冷启动延迟。
 */
let warmupStarted = false;
export function warmupClawhubRegistry(): void {
  if (warmupStarted) return;
  warmupStarted = true;
  setImmediate(() => {
    clawhubSearch('warmup', 1).catch(() => undefined);
  });
}

type SkillMetaJson = {
  latestVersion?: { version?: string };
  owner?: { handle?: string };
  skill?: { slug?: string };
};

/** 供板端 `clawhub install` 使用：owner/slug（与注册表一致） */
export async function clawhubResolveInstallRef(slug: string): Promise<{ installRef: string; version: string }> {
  const safe = assertSafeSlug(slug);
  const base = getClawhubRegistryBase();
  const url = `${base}/api/v1/skills/${encodeURIComponent(safe)}`;
  const text = await fetchTextWithRetry(url, {}, { timeoutMs: JSON_FETCH_TIMEOUT_MS });
  const data = JSON.parse(text) as SkillMetaJson;
  const v = data.latestVersion?.version?.trim();
  if (!v) {
    throw new Error('clawhub_skill_no_version');
  }
  const handle = data.owner?.handle?.trim();
  const skillSlug = (data.skill?.slug || safe).trim();
  const safeHandle = handle && /^[a-zA-Z0-9._-]+$/.test(handle) ? handle : '';
  const safeSkillSlug = /^[a-zA-Z0-9._-]+$/.test(skillSlug) ? skillSlug : safe;
  const installRef = safeHandle ? `${safeHandle}/${safeSkillSlug}` : safeSkillSlug;
  if (!/^([a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(installRef)) {
    throw new Error('clawhub_invalid_install_ref');
  }
  return { installRef, version: v };
}

async function fetchSkillLatestVersion(slug: string): Promise<string> {
  const { version } = await clawhubResolveInstallRef(slug);
  return version;
}

async function downloadSkillZipBytes(slug: string, version: string): Promise<Uint8Array> {
  const safe = assertSafeSlug(slug);
  const base = getClawhubRegistryBase();
  const url = new URL('/api/v1/download', `${base}/`);
  url.searchParams.set('slug', safe);
  url.searchParams.set('version', version);
  return fetchBufferWithRetry(url.toString());
}

/** 从技能 zip 中提取 SKILL.md 正文（取路径最短的一条，避免嵌套重复） */
export async function extractSkillMdFromZip(zipBytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(zipBytes);
  const paths: string[] = [];
  zip.forEach((relPath, file) => {
    if (file.dir) return;
    const n = relPath.replace(/\\/g, '/');
    if (n.endsWith('SKILL.md') && !n.includes('..')) {
      paths.push(n);
    }
  });
  if (paths.length === 0) {
    throw new Error('clawhub_zip_no_skill_md');
  }
  paths.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const first = paths[0];
  const file = zip.file(first);
  if (!file) {
    throw new Error('clawhub_zip_read_failed');
  }
  const md = await file.async('string');
  if (!md.trim()) {
    throw new Error('clawhub_skill_md_empty');
  }
  return md;
}

async function loadSkillMarkdownUncached(safeSlug: string, version: string): Promise<CachedSkillMd> {
  const zip = await downloadSkillZipBytes(safeSlug, version);
  const markdown = await extractSkillMdFromZip(zip);
  const row: CachedSkillMd = {
    markdown,
    version,
    slug: safeSlug,
    cachedAt: Date.now(),
  };
  const ck = `${safeSlug}@${version}`;
  skillMdCache.set(ck, row);
  return row;
}

export async function clawhubFetchSkillMarkdown(
  slug: string,
  version?: string,
): Promise<{ markdown: string; version: string; slug: string }> {
  const safe = assertSafeSlug(slug);
  const resolvedVersion = version?.trim() || (await fetchSkillLatestVersion(safe));
  const cacheKey = `${safe}@${resolvedVersion}`;

  const cached = skillMdCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < SKILL_MD_CACHE_TTL_MS) {
    return { markdown: cached.markdown, version: cached.version, slug: cached.slug };
  }

  const existing = inflightSkillMd.get(cacheKey);
  if (existing) {
    const r = await existing;
    return { markdown: r.markdown, version: r.version, slug: r.slug };
  }

  const p = loadSkillMarkdownUncached(safe, resolvedVersion).finally(() => {
    inflightSkillMd.delete(cacheKey);
  });
  inflightSkillMd.set(cacheKey, p);
  const r = await p;
  return { markdown: r.markdown, version: r.version, slug: r.slug };
}
