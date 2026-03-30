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

/** 部分 CDN 对无 UA 请求更严格限流 */
const CLAWHUB_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'RDK-Studio/SkillRegistry (https://github.com/D-Robotics; SkillHub mirror)',
} as const;

const MAX_HTTP_ATTEMPTS = 6;
const SKILL_MD_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedSkillMd = { markdown: string; version: string; slug: string; cachedAt: number };

const skillMdCache = new Map<string, CachedSkillMd>();
const searchCache = new Map<string, { at: number; results: ClawhubSearchHit[] }>();
const inflightSkillMd = new Map<string, Promise<CachedSkillMd>>();

export function getClawhubRegistryBase(): string {
  const raw = String(process.env.CLAWHUB_REGISTRY ?? '').trim();
  return raw.replace(/\/$/, '') || DEFAULT_REGISTRY;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchTextWithRetry(url: string, extraHeaders: Record<string, string>): Promise<string> {
  const headers = { ...CLAWHUB_HEADERS, ...extraHeaders };
  for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt++) {
    const res = await fetch(url, { method: 'GET', headers });
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
    const res = await fetch(url, { method: 'GET', headers });
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

export async function clawhubSearch(query: string, limit = 20): Promise<{ results: ClawhubSearchHit[] }> {
  const q = query.trim();
  if (!q) return { results: [] };
  const lim = Math.min(50, Math.max(1, limit));
  const cacheKey = `search:${q.toLowerCase()}\0${lim}`;
  const now = Date.now();
  const hit = searchCache.get(cacheKey);
  if (hit && now - hit.at < SEARCH_CACHE_TTL_MS) {
    return { results: hit.results };
  }

  const base = getClawhubRegistryBase();
  const url = new URL('/api/v1/search', `${base}/`);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(lim));
  const text = await fetchTextWithRetry(url.toString(), {});
  const data = JSON.parse(text) as { results?: ClawhubSearchHit[] };
  const results = Array.isArray(data.results) ? data.results : [];
  searchCache.set(cacheKey, { at: now, results });
  return { results };
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
  const text = await fetchTextWithRetry(url, {});
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
