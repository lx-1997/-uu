-- v4：增加 channel / outcome / error_detail（在 Supabase SQL Editor 执行）

alter table public.conversation_turns add column if not exists channel text not null default 'studio';
alter table public.conversation_turns add column if not exists outcome text not null default 'completed';
alter table public.conversation_turns add column if not exists error_detail text;

create index if not exists conversation_turns_channel_idx on public.conversation_turns (channel);
create index if not exists conversation_turns_outcome_idx on public.conversation_turns (outcome);
