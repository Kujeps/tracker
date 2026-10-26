-- Суммы операций за период по категориям и валютам: ответы на вопросы, /stats, /today.
-- Период полуоткрытый: p_from <= occurred_at < p_to. Удалённые не считаются.
create function public.transaction_totals(
  p_user_id uuid,
  p_kind text,
  p_from timestamptz,
  p_to timestamptz,
  p_category_id uuid default null
)
returns table (category_id uuid, currency text, total_minor bigint, tx_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.category_id, t.currency, sum(t.amount_minor)::bigint, count(*)
  from public.transactions t
  where t.user_id = p_user_id
    and t.kind = p_kind
    and t.deleted_at is null
    and t.occurred_at >= p_from
    and t.occurred_at < p_to
    and (p_category_id is null or t.category_id = p_category_id)
  group by t.category_id, t.currency
$$;

-- Функции в Postgres по умолчанию доступны всем: оставляем только service role
revoke all on function public.transaction_totals(uuid, text, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.transaction_totals(uuid, text, timestamptz, timestamptz, uuid)
  to service_role;
