-- Один ввод пользователя = одна строка (для отмены, отладки и учёта расходов на нейросеть)
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users on delete cascade,
  source text not null check (source in ('bot_text', 'bot_voice', 'shortcut', 'miniapp')),
  raw_text text not null,
  parsed jsonb,                  -- ответ парсера после проверки
  status text not null check (status in ('saved', 'needs_clarification', 'failed', 'undone')),
  bot_message_id bigint,         -- сообщение-подтверждение в чате
  llm_model text,
  llm_tokens_in int,
  llm_tokens_out int,
  llm_ms int,
  created_at timestamptz not null default now()
);

-- Последний ввод пользователя (уточнение) и лимит вводов в минуту
create index entries_user_created_at_idx on public.entries (user_id, created_at desc);
-- Потолок вызовов нейросети в сутки на весь сервис
create index entries_created_at_idx on public.entries (created_at);

-- Доступ только через Edge Functions с service role: RLS включён, политик нет
alter table public.entries enable row level security;
revoke all on table public.entries from anon, authenticated;
