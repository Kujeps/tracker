-- Деньги: траты и доходы в копейках
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users on delete cascade,
  entry_id uuid references public.entries on delete set null,
  kind text not null check (kind in ('expense', 'income')),
  amount_minor bigint not null check (amount_minor > 0),  -- копейки
  currency text not null default 'RUB',
  category_id uuid references public.categories,
  note text,
  occurred_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index transactions_user_occurred_at_idx
  on public.transactions (user_id, occurred_at desc);
-- Отмена всех записей одной фразы
create index transactions_entry_id_idx on public.transactions (entry_id);

-- Доступ только через Edge Functions с service role: RLS включён, политик нет
alter table public.transactions enable row level security;
revoke all on table public.transactions from anon, authenticated;
