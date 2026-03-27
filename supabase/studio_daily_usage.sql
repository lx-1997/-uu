-- 匿名日活：每个匿名 ID 每个 UTC 日最多一行，便于在 Supabase 中统计「每日使用人数」
-- 在 SQL Editor 中执行一次即可（与 conversation_turns 同一项目即可）

create table if not exists public.studio_daily_usage (
  id uuid primary key default gen_random_uuid(),
  usage_date date not null,
  anonymous_id text not null,
  app_version text,
  created_at timestamptz not null default now(),
  constraint studio_daily_usage_date_anon unique (usage_date, anonymous_id)
);

create index if not exists idx_studio_daily_usage_usage_date on public.studio_daily_usage (usage_date);

comment on table public.studio_daily_usage is 'RDK Studio 匿名日活；不含用户身份与聊天内容';

-- 示例：按日去重人数
-- select usage_date::text, count(*) as dau from public.studio_daily_usage group by usage_date order by usage_date desc;
