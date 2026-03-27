-- ⚠️ 仅复制本文件中的 SQL 到 Supabase → SQL Editor 执行（不要混入 JS）。
-- 极简 5 列：用户名、用户问题、AI 回复、时间、工具列表
--
-- 若已有旧表结构，请先执行 conversation_turns_migrate_to_v3_minimal.sql

create table if not exists public.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  recorded_at timestamptz not null,
  sso_user_name text,
  user_message text not null default '',
  assistant_message text not null default '',
  tools_used text[] not null default '{}'
);

create index if not exists conversation_turns_recorded_at_idx on public.conversation_turns (recorded_at desc);
create index if not exists conversation_turns_sso_user_name_idx on public.conversation_turns (sso_user_name);

alter table public.conversation_turns enable row level security;
