-- Защита от повторной обработки апдейтов Telegram
create table public.processed_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

-- Для чистки записей старше 7 дней
create index processed_updates_created_at_idx on public.processed_updates (created_at);

-- Доступ только через Edge Functions с service role: RLS включён, политик нет
alter table public.processed_updates enable row level security;
revoke all on table public.processed_updates from anon, authenticated;
