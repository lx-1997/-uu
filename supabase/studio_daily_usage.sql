-- 打开/会话 PV：每次身份验证成功（或访客每次打开）插入一行；同一用户同一天可多条，便于统计打开次数。
-- 在 SQL Editor 中执行一次即可（与 conversation_turns 同一项目即可）
-- 若曾创建过带「每日唯一」约束的旧表，请再执行 studio_daily_usage_migrate_pv.sql

create table if not exists public.studio_daily_usage (
  id uuid primary key default gen_random_uuid(),
  usage_date date not null,
  anonymous_id text not null, -- SSO：登录展示名（与对话归档一致）；访客：浏览器匿名 id
  app_version text,
  created_at timestamptz not null default now()
);

create index if not exists idx_studio_daily_usage_usage_date on public.studio_daily_usage (usage_date);
create index if not exists idx_studio_daily_usage_date_anon on public.studio_daily_usage (usage_date, anonymous_id);

comment on table public.studio_daily_usage is 'RDK Studio 打开 PV；一行一次验证/打开';

-- 示例：某日总 PV、按用户打开次数
-- select count(*) as pv from public.studio_daily_usage where usage_date = current_date;
-- select anonymous_id, count(*) as opens from public.studio_daily_usage where usage_date = current_date group by anonymous_id;
