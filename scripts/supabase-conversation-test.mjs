/**
 * 一次性测试：按 conversation_turns 表结构向 Supabase 插入一行。
 * 用法（PowerShell）：
 *   $env:SUPABASE_URL="https://xxx.supabase.co"
 *   $env:SUPABASE_SECRET_KEY="sb_secret_..."   # 推荐 service_role
 *   node scripts/supabase-conversation-test.mjs
 * 或依赖项目根目录 .env 中的同名变量。
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const url = String(process.env.SUPABASE_URL ?? '').trim();
const key = String(
  process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.SUPABASE_PUBLISHABLE_KEY
    ?? '',
).trim();
const table = String(process.env.SUPABASE_CONVERSATION_TABLE ?? 'conversation_turns').trim() || 'conversation_turns';

if (!url || !key) {
  console.error('缺少环境变量：请设置 SUPABASE_URL 以及 SUPABASE_SECRET_KEY（或 SERVICE_ROLE / PUBLISHABLE）');
  process.exit(1);
}

if (key.startsWith('sb_publishable_')) {
  console.warn(
    '当前为 publishable（anon）。若插入被 RLS 拒绝：请改用 Dashboard「secret / service_role」填入 SUPABASE_SECRET_KEY，\n' +
      '或执行 supabase/conversation_turns_rls_anon_insert.sql（仅建议内网/测试）。\n',
  );
}

const now = Date.now();
const row = {
  recorded_at: new Date(now).toISOString(),
  sso_user_name: '连通性测试用户',
  user_message: '【连通性测试】用户消息',
  assistant_message: '【连通性测试】助手回复',
  tools_used: ['memory_search', 'device_exec'],
  channel: 'studio',
  outcome: 'completed',
  error_detail: null,
};

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await sb.from(table).insert(row).select('id').maybeSingle();

if (error) {
  console.error('插入失败:', error.message);
  if (error.message.includes('row-level security')) {
    console.error(
      'RLS 拒绝：请确认 SUPABASE_SECRET_KEY 为 Dashboard「secret / service_role」（非 publishable），\n' +
        '或已在 SQL Editor 执行 supabase/conversation_turns_rls_anon_insert.sql（不推荐生产）。',
    );
  } else {
    console.error('提示：若表不存在请先执行 supabase/conversation_turns.sql。');
  }
  process.exit(1);
}

console.log('插入成功, id:', data?.id ?? '(no return)');
process.exit(0);
