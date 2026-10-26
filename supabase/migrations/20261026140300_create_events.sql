-- Планер
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users on delete cascade,
  entry_id uuid references public.entries on delete set null,
  title text not null,
  note text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index events_user_starts_at_idx on public.events (user_id, starts_at);
-- Отмена всех записей одной фразы
create index events_entry_id_idx on public.events (entry_id);

-- Доступ только через Edge Functions с service role: RLS включён, политик нет
alter table public.events enable row level security;
revoke all on table public.events from anon, authenticated;
