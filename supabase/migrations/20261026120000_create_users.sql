-- Пользователи бота
create table public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  first_name text,
  username text,
  timezone text not null default 'Europe/Moscow',  -- IANA
  currency text not null default 'RUB',
  digest_enabled boolean not null default true,
  digest_time time not null default '08:00',       -- локальное время пользователя
  plan text not null default 'free' check (plan in ('free', 'pro')),
  pro_until timestamptz,
  shortcut_token_hash text unique,                 -- sha256 личного токена для iPhone
  is_blocked boolean not null default false,       -- пользователь заблокировал бота
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

-- Доступ только через Edge Functions с service role: RLS включён, политик нет
alter table public.users enable row level security;
revoke all on table public.users from anon, authenticated;
