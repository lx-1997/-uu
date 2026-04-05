/**
 * RDK 官方文档本地缓存 — 从 GitHub D-Robotics/rdk_doc 仓库的 docs/ 目录
 * 下载原始 Markdown 文件到 ~/.rdkstudio/rdk-doc-cache/，供 web_fetch 命中时
 * 直接读本地（<10 ms），而非每次 HTTP GET 官网 HTML（~20 s）。
 * 刷新时写入 docs.staging 再与 docs 原子替换，避免刷新过程中清空 docs 导致长时间只能走 HTTP。
 *
 * 下载方式：GitHub Git Trees API（递归），一次 API 调用拿到整棵 docs/ 的
 * SHA + path 列表，再批量 Blob GET 下载 .md/.mdx 文件。无外部依赖。
 *
 * 更新策略：
 *   1. 服务启动时检查 meta.json，超过 STALE_THRESHOLD_MS 则后台拉取。
 *   2. 运行期间每 CHECK_INTERVAL_MS 检查一次，过期则后台拉取。
 *   3. 软件关闭后无法更新，下次启动时补。
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const GITHUB_REPO = 'D-Robotics/rdk_doc';
const GITHUB_BRANCH = 'main';
const GITHUB_API_BASE = 'https://api.github.com';

const CACHE_DIR_NAME = 'rdk-doc-cache';
const DOCS_SUBDIR = 'docs';
/** 下载到临时目录，完成后与 docs 原子替换，避免刷新过程中清空缓存导致 web_fetch 长时间走慢速 HTTP */
const DOCS_STAGING_SUBDIR = 'docs.staging';
const DOCS_BACKUP_SUBDIR = 'docs.backup';
const META_FILENAME = 'meta.json';
const INDEX_FILENAME = 'index.json';

/** 过期阈值：24 小时 */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
/** 运行期间检查间隔：1 小时 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** HTTP 请求超时 */
const FETCH_TIMEOUT_MS = 30_000;
/** 单文件大小限制（base64 解码前） */
const MAX_BLOB_SIZE = 2 * 1024 * 1024;
/** 并发下载数（raw.githubusercontent.com 可承受略高于 API 限制） */
const DOWNLOAD_CONCURRENCY = 24;
/** 构建索引时并行读取 MD 文件批大小 */
const INDEX_READ_CONCURRENCY = 40;

const RDK_DOC_URL_PREFIX = 'https://developer.d-robotics.cc/rdk_doc/';

/**
 * 将路径中每一段的数字编号前缀去掉，以便官网 URL 与 GitHub 文件路径对齐。
 * "05_Robot_development/03_boxs/detection/fcos" → "robot_development/boxs/detection/fcos"
 */
function stripNumericPrefixes(p: string): string {
  return p
    .split('/')
    .map((seg) => seg.replace(/^\d+_/, '').toLowerCase())
    .join('/');
}

const GITHUB_HEADERS: Record<string, string> = {
  'User-Agent': 'RDKStudio-DocCache/1.0',
  Accept: 'application/vnd.github.v3+json',
};

// ─── 类型 ─────────────────────────────────────────────────────────────────────

interface CacheMeta {
  lastUpdatedAt: number;
  treeSha: string;
  fileCount: number;
  version: number;
}

export interface DocIndexEntry {
  urlPath: string;
  localPath: string;
  title: string;
  keywords: string[];
}

interface DocIndex {
  builtAt: number;
  entries: DocIndexEntry[];
}

interface GitTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

// ─── 状态 ─────────────────────────────────────────────────────────────────────

let cacheDir = '';
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInProgress = false;
let initialized = false;
let memIndex: DocIndex | null = null;
/** stripNumericPrefixes(urlPath) → 条目，加速 resolveLocalDocPath */
let memIndexByNormPath: Map<string, DocIndexEntry> | null = null;

function rebuildNormPathLookup(idx: DocIndex | null): void {
  if (!idx) {
    memIndexByNormPath = null;
    return;
  }
  const m = new Map<string, DocIndexEntry>();
  for (const e of idx.entries) {
    const k = stripNumericPrefixes(e.urlPath);
    if (!m.has(k)) m.set(k, e);
  }
  memIndexByNormPath = m;
}

// ─── 路径工具 ──────────────────────────────────────────────────────────────────

function resolveCacheDir(): string {
  if (cacheDir) return cacheDir;
  const envDir = String(process.env.RDK_DOC_CACHE_DIR ?? '').trim();
  cacheDir = envDir || path.join(os.homedir(), '.rdkstudio', CACHE_DIR_NAME);
  return cacheDir;
}

function metaPath(): string { return path.join(resolveCacheDir(), META_FILENAME); }
function indexPath(): string { return path.join(resolveCacheDir(), INDEX_FILENAME); }
function docsDir(): string { return path.join(resolveCacheDir(), DOCS_SUBDIR); }
function docsStagingDir(): string { return path.join(resolveCacheDir(), DOCS_STAGING_SUBDIR); }
function docsBackupDir(): string { return path.join(resolveCacheDir(), DOCS_BACKUP_SUBDIR); }

// ─── Meta 读写 ─────────────────────────────────────────────────────────────────

const META_VERSION = 1;

async function readMeta(): Promise<CacheMeta | null> {
  try {
    const obj = JSON.parse(await fsp.readFile(metaPath(), 'utf-8')) as CacheMeta;
    return obj.version === META_VERSION ? obj : null;
  } catch {
    return null;
  }
}

async function writeMeta(meta: CacheMeta): Promise<void> {
  await fsp.mkdir(resolveCacheDir(), { recursive: true });
  const tmp = metaPath() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf-8');
  await fsp.rename(tmp, metaPath());
}

// ─── 索引构建 ──────────────────────────────────────────────────────────────────

function localPathToUrlPath(localRelPath: string): string {
  return localRelPath.replace(/\.mdx?$/i, '').replace(/\\/g, '/');
}

function extractTitle(content: string): string {
  const h1 = content.match(/^#\s+(.+)/m);
  if (h1) return h1[1].trim();
  const side = content.match(/sidebar_label:\s*["']?(.+?)["']?\s*$/m);
  if (side) return side[1].trim();
  return '';
}

function extractKeywords(filePath: string, title: string): string[] {
  const kw = new Set<string>();
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  kw.add(base);
  for (const seg of base.split(/[_\-./]+/)) {
    if (seg.length >= 2) kw.add(seg);
  }
  if (title) {
    for (const word of title.replace(/[（()）|·/\\]/g, ' ').split(/\s+/)) {
      const w = word.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');
      if (w.length >= 2) kw.add(w);
    }
  }
  return [...kw];
}

async function collectMdPathsUnder(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let items: string[];
    try { items = await fsp.readdir(dir); } catch { return; }
    for (const item of items) {
      const full = path.join(dir, item);
      const stat = await fsp.stat(full).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) {
        await walk(full);
      } else if (/\.mdx?$/i.test(item)) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

async function buildIndexFromRoot(root: string): Promise<DocIndex> {
  const paths = await collectMdPathsUnder(root);
  const entries: DocIndexEntry[] = [];

  for (let i = 0; i < paths.length; i += INDEX_READ_CONCURRENCY) {
    const chunk = paths.slice(i, i + INDEX_READ_CONCURRENCY);
    const parts = await Promise.all(
      chunk.map(async (full) => {
        const rel = path.relative(root, full);
        let content = '';
        try { content = await fsp.readFile(full, 'utf-8'); } catch { /* skip */ }
        const title = extractTitle(content);
        return {
          urlPath: localPathToUrlPath(rel),
          localPath: rel,
          title,
          keywords: extractKeywords(rel, title),
        } as DocIndexEntry;
      }),
    );
    entries.push(...parts);
  }

  return { builtAt: Date.now(), entries };
}

async function saveIndex(idx: DocIndex): Promise<void> {
  const tmp = indexPath() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(idx, null, 2), 'utf-8');
  await fsp.rename(tmp, indexPath());
}

async function loadIndex(): Promise<DocIndex | null> {
  try { return JSON.parse(await fsp.readFile(indexPath(), 'utf-8')) as DocIndex; }
  catch { return null; }
}

// ─── GitHub API 下载 ──────────────────────────────────────────────────────────

async function githubFetch(urlPath: string): Promise<any> {
  const url = urlPath.startsWith('http') ? urlPath : `${GITHUB_API_BASE}${urlPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: GITHUB_HEADERS });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 用 Git Trees API（recursive）获取 docs/ 下所有 blob 的 path + sha 列表。
 * 然后批量用 Raw URL 下载内容（比 Blob API 更快，不经过 base64）。
 * 下载到 docs.staging，索引构建完成后与 docs 原子替换，刷新期间旧 docs 仍可被 web_fetch 命中。
 */
async function downloadAllDocs(): Promise<{ treeSha: string; fileCount: number; docIndex: DocIndex }> {
  const stagingDir = docsStagingDir();
  const finalDir = docsDir();
  const backupDir = docsBackupDir();

  try {
    // 1. 获取最新 commit 的 tree SHA
    const branch = await githubFetch(`/repos/${GITHUB_REPO}/branches/${GITHUB_BRANCH}`);
    const commitSha: string = branch.commit.sha;
    const rootTreeSha: string = branch.commit.commit.tree.sha;

    // 2. 获取递归 tree
    const treeData = await githubFetch(`/repos/${GITHUB_REPO}/git/trees/${rootTreeSha}?recursive=1`);
    const allItems: GitTreeItem[] = treeData.tree;

    // 3. 筛选 docs/ 下的 .md/.mdx 文件
    const docBlobs = allItems.filter(
      (item) =>
        item.type === 'blob' &&
        item.path.startsWith('docs/') &&
        /\.mdx?$/i.test(item.path) &&
        (item.size ?? 0) <= MAX_BLOB_SIZE,
    );

    if (docBlobs.length === 0) {
      throw new Error('Git tree 中未找到 docs/*.md 文件');
    }

    // 4. 清空 staging（不动当前 docs/，保证刷新过程中仍可读本地缓存）
    await fsp.rm(stagingDir, { recursive: true, force: true });
    await fsp.mkdir(stagingDir, { recursive: true });

    // 5. 并发下载到 staging
    let fileCount = 0;
    const rawBase = `https://raw.githubusercontent.com/${GITHUB_REPO}/${commitSha}`;

    async function downloadOne(item: GitTreeItem): Promise<void> {
      const relPath = item.path.slice('docs/'.length);
      const outPath = path.join(stagingDir, relPath);

      if (!outPath.startsWith(stagingDir + path.sep) && outPath !== stagingDir) return;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`${rawBase}/${item.path}`, {
          signal: controller.signal,
          headers: { 'User-Agent': 'RDKStudio-DocCache/1.0' },
        });
        if (!res.ok) return;
        const text = await res.text();
        await fsp.mkdir(path.dirname(outPath), { recursive: true });
        await fsp.writeFile(outPath, text, 'utf-8');
        fileCount++;
      } catch {
        /* 单文件失败不中断整体 */
      } finally {
        clearTimeout(timer);
      }
    }

    for (let i = 0; i < docBlobs.length; i += DOWNLOAD_CONCURRENCY) {
      const batch = docBlobs.slice(i, i + DOWNLOAD_CONCURRENCY);
      await Promise.allSettled(batch.map(downloadOne));
    }

    if (fileCount === 0) {
      await fsp.rm(stagingDir, { recursive: true, force: true });
      throw new Error('未下载到任何文档文件');
    }

    const docIndex = await buildIndexFromRoot(stagingDir);

    // 6. 原子替换：final → backup → staging → final，再删 backup
    await fsp.rm(backupDir, { recursive: true, force: true });
    if (fs.existsSync(finalDir)) {
      await fsp.rename(finalDir, backupDir);
    }
    await fsp.rename(stagingDir, finalDir);
    await fsp.rm(backupDir, { recursive: true, force: true }).catch(() => {});

    return { treeSha: rootTreeSha, fileCount, docIndex };
  } catch (err) {
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    // 若已将 docs 挪到 backup 但 staging→docs 失败，恢复旧缓存目录
    if (!fs.existsSync(finalDir) && fs.existsSync(backupDir)) {
      await fsp.rename(backupDir, finalDir).catch(() => {});
    }
    throw err;
  }
}

// ─── 刷新逻辑 ──────────────────────────────────────────────────────────────────

async function doRefresh(force = false): Promise<boolean> {
  if (refreshInProgress) return false;

  if (!force) {
    const meta = await readMeta();
    if (meta && Date.now() - meta.lastUpdatedAt < STALE_THRESHOLD_MS) return false;
  }

  refreshInProgress = true;
  try {
    console.log('[rdk-doc-cache] 开始从 GitHub 拉取 rdk_doc 文档...');
    const { treeSha, fileCount, docIndex } = await downloadAllDocs();
    console.log(`[rdk-doc-cache] 下载完成: ${fileCount} 个文件, tree ${treeSha.slice(0, 10)}`);

    if (fileCount === 0) {
      console.warn('[rdk-doc-cache] 未下载到任何文件，保留旧缓存');
      return false;
    }

    await writeMeta({
      lastUpdatedAt: Date.now(),
      treeSha,
      fileCount,
      version: META_VERSION,
    });

    await saveIndex(docIndex);
    memIndex = docIndex;
    rebuildNormPathLookup(docIndex);
    console.log(`[rdk-doc-cache] 索引构建完成: ${docIndex.entries.length} 条`);
    return true;
  } catch (err) {
    console.error('[rdk-doc-cache] 刷新失败:', err instanceof Error ? err.message : err);
    return false;
  } finally {
    refreshInProgress = false;
  }
}

// ─── 公共 API ──────────────────────────────────────────────────────────────────

/**
 * 初始化文档缓存。在服务启动时调用一次。
 * - 本地缓存已存在且未过期：加载索引到内存。
 * - 过期或不存在：后台拉取，不阻塞启动。
 */
export async function initRdkDocCache(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await fsp.mkdir(resolveCacheDir(), { recursive: true });

  const meta = await readMeta();
  if (meta) {
    const idx = await loadIndex();
    if (idx) {
      memIndex = idx;
      rebuildNormPathLookup(idx);
    }
  }

  const isStale = !meta || Date.now() - meta.lastUpdatedAt >= STALE_THRESHOLD_MS;
  if (isStale) {
    doRefresh(true).catch(() => {});
  }

  if (!refreshTimer) {
    refreshTimer = setInterval(() => { doRefresh(false).catch(() => {}); }, CHECK_INTERVAL_MS);
    if (refreshTimer && typeof refreshTimer === 'object' && 'unref' in refreshTimer) {
      (refreshTimer as NodeJS.Timeout).unref();
    }
  }
}

/**
 * 将 rdk_doc 完整 URL 解析为本地缓存中的绝对文件路径。
 * 返回 null 表示无匹配或缓存不存在。
 */
export function resolveLocalDocPath(url: string): string | null {
  if (!url.startsWith(RDK_DOC_URL_PREFIX)) return null;

  const urlPath = url
    .slice(RDK_DOC_URL_PREFIX.length)
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (!urlPath) return null;

  const root = docsDir();
  const candidates = [
    path.join(root, urlPath + '.md'),
    path.join(root, urlPath + '.mdx'),
    path.join(root, urlPath, 'index.md'),
    path.join(root, urlPath, 'index.mdx'),
  ];

  for (const p of candidates) {
    if (p.startsWith(root) && fs.existsSync(p)) return p;
  }

  // 索引模糊匹配：GitHub 文件路径带数字编号前缀（如 05_Robot_development/03_boxs），
  // 而官网 URL 不带（Robot_development/boxs），需要去除编号后比较。
  if (memIndexByNormPath) {
    const norm = stripNumericPrefixes(urlPath);
    const hit = memIndexByNormPath.get(norm);
    if (hit) {
      const full = path.join(root, hit.localPath);
      if (fs.existsSync(full)) return full;
    }
  }

  return null;
}

/**
 * 从本地缓存读取 rdk_doc URL 对应的 Markdown 内容。
 * 返回 null 表示缓存未命中。
 */
export function readCachedDoc(url: string): string | null {
  const localPath = resolveLocalDocPath(url);
  if (!localPath) return null;
  try { return fs.readFileSync(localPath, 'utf-8'); }
  catch { return null; }
}

/**
 * 先精确命中本地缓存；失败时用语义索引按 URL 路径末段模糊匹配（缓解拼错章节、404 页面无 MD 等情况）。
 */
export function tryReadRdkDocCachedWithFallback(url: string): {
  body: string;
  resolvedUrl: string;
  via: 'direct' | 'fuzzy_index';
} | null {
  const direct = readCachedDoc(url);
  if (direct) return { body: direct, resolvedUrl: url.trim(), via: 'direct' };

  const normalized = url.trim();
  if (!normalized.includes('developer.d-robotics.cc/rdk_doc')) return null;

  const after = normalized.split(/rdk_doc\//i)[1];
  if (!after) return null;
  const urlPath = after.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const segments = urlPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const queries: string[] = [];
  for (let i = segments.length - 1; i >= Math.max(0, segments.length - 3); i--) {
    queries.push(segments.slice(i).join(' '));
    queries.push(segments[i].replace(/_/g, ' '));
  }
  const seen = new Set<string>();
  for (const q of queries) {
    const t = q.trim();
    if (t.length < 2) continue;
    const lk = t.toLowerCase();
    if (seen.has(lk)) continue;
    seen.add(lk);
    const hits = searchDocIndex(t, 10);
    for (const h of hits) {
      const fullUrl = `${RDK_DOC_URL_PREFIX}${h.urlPath.replace(/^\//, '')}`;
      const body = readCachedDoc(fullUrl);
      if (body) return { body, resolvedUrl: fullUrl, via: 'fuzzy_index' };
    }
  }
  return null;
}

/** 获取内存中的文档索引 */
export function getDocIndex(): DocIndex | null {
  return memIndex;
}

/** 按关键词搜索文档索引 */
export function searchDocIndex(query: string, limit = 10): DocIndexEntry[] {
  if (!memIndex) return [];
  const terms = query.toLowerCase().split(/[\s_\-./]+/).filter((t) => t.length >= 2);
  if (terms.length === 0) return [];

  const pool = memIndex.entries.filter((entry) => {
    const lp = entry.urlPath.toLowerCase();
    const tl = entry.title.toLowerCase();
    for (const term of terms) {
      if (lp.includes(term) || tl.includes(term)) return true;
      if (entry.keywords.some((k) => k.includes(term))) return true;
    }
    return false;
  });
  const candidates = pool.length > 0 ? pool : memIndex.entries;

  const scored = candidates
    .map((entry) => {
      let score = 0;
      for (const term of terms) {
        if (entry.keywords.some((k) => k.includes(term))) score += 2;
        if (entry.urlPath.toLowerCase().includes(term)) score += 1;
        if (entry.title.toLowerCase().includes(term)) score += 1;
      }
      return { entry, score };
    })
    .filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

/** 获取缓存状态（诊断用） */
export async function getCacheStatus(): Promise<{
  initialized: boolean;
  cacheDir: string;
  meta: CacheMeta | null;
  indexEntryCount: number;
  isStale: boolean;
  refreshInProgress: boolean;
}> {
  const meta = await readMeta();
  return {
    initialized,
    cacheDir: resolveCacheDir(),
    meta,
    indexEntryCount: memIndex?.entries.length ?? 0,
    isStale: !meta || Date.now() - meta.lastUpdatedAt >= STALE_THRESHOLD_MS,
    refreshInProgress,
  };
}

/** 手动触发刷新 */
export async function forceRefresh(): Promise<boolean> {
  return doRefresh(true);
}

/** 停止定时器（热重载/测试用） */
export function stopRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
