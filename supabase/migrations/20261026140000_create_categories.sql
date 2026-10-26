-- Категории: общие (user_id is null) и свои
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  name text not null,
  emoji text,
  sort int not null default 0,
  archived boolean not null default false
);

-- Одно имя на вид: среди общих и среди своих у каждого пользователя
create unique index categories_global_kind_name_key
  on public.categories (kind, name) where user_id is null;
create unique index categories_user_kind_name_key
  on public.categories (user_id, kind, name) where user_id is not null;

-- Доступ только через Edge Functions с service role: RLS включён, политик нет
alter table public.categories enable row level security;
revoke all on table public.categories from anon, authenticated;
