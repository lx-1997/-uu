/**
 * 从 ~/.rdkstudio/rdk-doc-cache/index.json（或 RDK_DOC_CACHE_DIR）读取
 * 与 rdk_doc 官网 MD 同步的 title，生成 server/rdkclaw/rdk-doc-titles.generated.json
 *
 * 用法：先保证已拉取文档缓存（启动过 Studio 或 rdk-doc 缓存任务），再执行：
 *   node scripts/extract-rdk-doc-titles.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'server', 'rdkclaw', 'rdk-doc-titles.generated.json');

/** 与 server/rdkclaw/rdk-doc-local-cache.ts 一致 */
function stripNumericPrefixes(p) {
  return p
    .split('/')
    .map((seg) => seg.replace(/^\d+_/, '').toLowerCase())
    .join('/');
}

function resolveIndexPath() {
  const env = String(process.env.RDK_DOC_CACHE_DIR || '').trim();
  if (env) return join(env, 'index.json');
  return join(homedir(), '.rdkstudio', 'rdk-doc-cache', 'index.json');
}

function main() {
  const indexPath = resolveIndexPath();
  let raw;
  try {
    raw = readFileSync(indexPath, 'utf-8');
  } catch {
    console.error(
      '[extract-rdk-doc-titles] 未找到',
      indexPath,
      '\n请先启动 RDK Studio 拉取 rdk_doc 缓存，或设置 RDK_DOC_CACHE_DIR 指向含 index.json 的目录。',
    );
    process.exit(1);
  }

  const { entries } = JSON.parse(raw);
  const norm = Object.create(null);
  for (const e of entries) {
    const t = String(e.title || '').trim();
    if (!t) continue;
    const key = stripNumericPrefixes(String(e.urlPath || '').replace(/\\/g, '/'));
    if (!key) continue;
    const lastSeg = key.split('/').pop() || '';
    const slugLike =
      t === lastSeg ||
      t.replace(/_/g, '').toLowerCase() === lastSeg.replace(/_/g, '').toLowerCase();
    if (slugLike) continue;
    if (!norm[key]) norm[key] = t;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceIndex: indexPath,
    entryCount: Object.keys(norm).length,
    /** 键：stripNumericPrefixes 后的路径（无 /rdk_doc 前缀，无首尾斜杠） */
    normToTitle: norm,
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf-8');
  console.error('[extract-rdk-doc-titles] Wrote', OUT, 'keys', payload.entryCount);
}

main();
