-- 若已按旧版执行过 studio_daily_usage.sql（含每日每用户唯一约束），执行本脚本改为 PV：
-- 同一用户同一天可有多行，便于统计「打开次数」。
-- 在 Supabase SQL Editor 中执行一次即可。

alter table public.studio_daily_usage
  drop constraint if exists studio_daily_usage_date_anon;

comment on table public.studio_daily_usage is 'RDK Studio 打开/会话 PV（SSO 为登录展示名）；一行一次打开或验证';

-- 可选：按日+用户查次数
-- select usage_date::text, anonymous_id, count(*) as opens
-- from public.studio_daily_usage
-- group by usage_date, anonymous_id
-- order by usage_date desc, opens desc;
