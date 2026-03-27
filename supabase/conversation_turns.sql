-- ⚠️ 仅复制本文件中的 SQL 到 Supabase → SQL Editor 执行（不要混入 JS）。
-- 归档：用户名、问题、回复、时间、工具、渠道、结果（成功/取消/错误等）、可选错误摘要
--
-- 若已有旧表结构，请先执行 conversation_turns_migrate_to_v3_minimal.sql 与 conversation_turns_migrate_v4_channel_outcome.sql

create table if not exists public.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  recorded_at timestamptz not null,
  sso_user_name text,
  user_message text not null default '',
  assistant_message text not null default '',
  tools_used text[] not null default '{}',
  channel text not null default 'studio',
  outcome text not null default 'completed',
  error_detail text
);

create index if not exists conversation_turns_recorded_at_idx on public.conversation_turns (recorded_at desc);
create index if not exists conversation_turns_sso_user_name_idx on public.conversation_turns (sso_user_name);
create index if not exists conversation_turns_channel_idx on public.conversation_turns (channel);
create index if not exists conversation_turns_outcome_idx on public.conversation_turns (outcome);

alter table public.conversation_turns enable row level security;
