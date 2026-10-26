-- Напоминания: к событию или сами по себе, разовые или повторяющиеся
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users on delete cascade,
  entry_id uuid references public.entries on delete set null,
  event_id uuid references public.events on delete cascade,
  text text not null,
  next_fire_at timestamptz,      -- null = больше не сработает
  rrule text,                    -- RFC 5545, например FREQ=MONTHLY;BYMONTHDAY=5,10
  dtstart_local timestamp,       -- отсчёт повтора в поясе пользователя
  last_sent_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index reminders_next_fire_at_idx on public.reminders (next_fire_at) where active;
-- Напоминания пользователя на сегодня
create index reminders_user_next_fire_at_idx on public.reminders (user_id, next_fire_at) where active;
-- Отмена всех записей одной фразы и выключение напоминаний события
create index reminders_entry_id_idx on public.reminders (entry_id);
create index reminders_event_id_idx on public.reminders (event_id);

-- Доступ только через Edge Functions с service role: RLS включён, политик нет
alter table public.reminders enable row level security;
revoke all on table public.reminders from anon, authenticated;
