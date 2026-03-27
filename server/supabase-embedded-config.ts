/**
 * 打包发行：默认从下方「发版凭证」读取 Supabase，无需每版复制 JSON。
 * 优先级：环境变量（本地调试用）> 发版凭证常量 > 可选 JSON 文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type EmbeddedJson = {
  url?: string;
  secretKey?: string;
  secret_key?: string;
  serviceRoleKey?: string;
  publishableKey?: string;
  table?: string;
};

/**
 * 发版凭证（写死即可）：在此填入 Supabase 项目 URL 与 secret（推荐 Dashboard → API → service_role）。
 * 填一次后正常 `npm run build` / 桌面打包即带上，无需再维护 `config/supabase-conversation.embedded.json`。
 * 本地若需指向别的库，可用 .env 的 SUPABASE_URL / SUPABASE_SECRET_KEY 覆盖（优先级更高）。
 */
const SUPABASE_SHIPPING_DEFAULTS = {
  url: 'https://pbqmhihtdwhsjaavhzqs.supabase.co',
  secretKey: 'sb_secret_iWKfgP3zhSRcHvZ655z9VQ__3pvBBLJ',
  table: '',
} as const;

function projectRootFromDistServer(): string {
  return path.resolve(__dirname, '..', '..');
}

function tryParseEmbeddedJson(filePath: string): EmbeddedJson | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const j = JSON.parse(raw) as EmbeddedJson;
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

function pickKeyFromJson(j: EmbeddedJson): string {
  return String(
    j.secretKey
      ?? j.secret_key
      ?? j.serviceRoleKey
      ?? j.publishableKey
      ?? '',
  ).trim();
}

let cachedJson: EmbeddedJson | null | undefined;

function loadEmbeddedJsonOnce(): EmbeddedJson | null {
  if (cachedJson !== undefined) return cachedJson;
  const candidates: string[] = [];
  const dataDir = String(process.env.RDK_DATA_DIR || '').trim();
  if (dataDir) {
    candidates.push(path.join(dataDir, 'supabase-conversation.embedded.json'));
  }
  candidates.push(
    path.join(process.cwd(), 'config', 'supabase-conversation.embedded.json'),
    path.join(projectRootFromDistServer(), 'config', 'supabase-conversation.embedded.json'),
  );
  for (const p of candidates) {
    const j = tryParseEmbeddedJson(p);
    if (j && String(j.url || '').trim() && pickKeyFromJson(j)) {
      cachedJson = j;
      return cachedJson;
    }
  }
  cachedJson = null;
  return null;
}

export function getResolvedSupabaseUrl(): string {
  const env = String(process.env.SUPABASE_URL ?? '').trim();
  if (env) return env;
  const inline = String(SUPABASE_SHIPPING_DEFAULTS.url || '').trim();
  if (inline) return inline;
  const j = loadEmbeddedJsonOnce();
  if (j && String(j.url || '').trim()) return String(j.url).trim();
  return '';
}

export function getResolvedSupabaseKey(): string {
  const env = String(
    process.env.SUPABASE_SECRET_KEY
      ?? process.env.SUPABASE_SERVICE_ROLE_KEY
      ?? process.env.SUPABASE_PUBLISHABLE_KEY
      ?? '',
  ).trim();
  if (env) return env;
  const inline = String(SUPABASE_SHIPPING_DEFAULTS.secretKey || '').trim();
  if (inline) return inline;
  const j = loadEmbeddedJsonOnce();
  return j ? pickKeyFromJson(j) : '';
}

export function getResolvedSupabaseTable(): string {
  const env = String(process.env.SUPABASE_CONVERSATION_TABLE ?? '').trim();
  if (env) return env;
  const inline = String(SUPABASE_SHIPPING_DEFAULTS.table || '').trim();
  if (inline) return inline;
  const j = loadEmbeddedJsonOnce();
  const t = j && String(j.table || '').trim();
  if (t) return t;
  return 'conversation_turns';
}
