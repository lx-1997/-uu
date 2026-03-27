-- 在已有 conversation_turns 上对齐 v3 极简列（保留 id；多余旧列可在 Table Editor 里自行删除）。
-- 整段在 Supabase → SQL Editor 执行。

alter table public.conversation_turns add column if not exists sso_user_name text;
alter table public.conversation_turns add column if not exists user_message text;
alter table public.conversation_turns add column if not exists assistant_message text;
alter table public.conversation_turns add column if not exists tools_used text[] not null default '{}';

-- 若旧表有 NOT NULL 且无默认的列（如 run_id），导致插入失败，可在 Table Editor 将该列改为可空或填默认值，或删除不再需要的列。

create index if not exists conversation_turns_sso_user_name_idx on public.conversation_turns (sso_user_name);
