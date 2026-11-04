-- Receipt metadata is synced from ERP, not the PR line spreadsheet.
-- Invoker rights preserve the existing ERP table RLS policies.
create or replace function public.warehouse_receipt_summary(p_today date)
returns jsonb language sql stable security invoker set search_path = '' as $$
with bounds as (
  select p_today as today,
    p_today - ((extract(isodow from p_today)::int + 4) % 7) - 7 as week_start,
    date_trunc('month', p_today)::date as month_start
), raw as materialized (
  select d.purch_req_id as pr_no, r->>'po' as po_no,
    r->>'productReciept' as receipt_no,
    coalesce(nullif(r->>'recId',''), nullif(r->>'id',''), r->>'productReciept') as receipt_id,
    case
      when r->>'createdAt' ~ '^\d{1,2}/\d{1,2}/\d{4}( |$)' then
        split_part(split_part(r->>'createdAt',' ',1),'/',3) || '-' ||
        lpad(split_part(r->>'createdAt','/',1),2,'0') || '-' ||
        lpad(split_part(r->>'createdAt','/',2),2,'0')
      when r->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}' then left(r->>'createdAt',10)
      else null
    end as date_text
  from public.erp_pr_details d
  cross join lateral jsonb_array_elements(case when jsonb_typeof(d.product_receipts) = 'array' then d.product_receipts else '[]'::jsonb end) r
), dated as materialized (
  select *, case when pg_input_is_valid(date_text, 'date') then date_text::date end as received_date from raw
), receipts as materialized (
  select distinct pr_no, po_no, receipt_no, receipt_id, received_date from dated
  where received_date between (select least(week_start - 7, month_start) from bounds) and p_today
), periods as (
  select 'current' as name, week_start as start_date, week_start + 6 as end_date from bounds
  union all select 'previous', week_start - 7, week_start - 1 from bounds
  union all select 'month', month_start, today from bounds
), totals as (
  select p.name, jsonb_build_object('prs', count(distinct nullif(r.pr_no,'')),
    'entries', count(r.received_date)) as summary
  from periods p left join receipts r on r.received_date between p.start_date and p.end_date
  group by p.name
)
select jsonb_build_object(
  'periods', (select jsonb_object_agg(name, summary) from totals),
  'rows', coalesce((select jsonb_agg(to_jsonb(x) order by received_date desc,pr_no,receipt_id) from (
    select r.* from receipts r, bounds b where r.received_date between b.week_start and b.week_start + 6
    order by received_date desc,pr_no,receipt_id limit 200
  ) x), '[]'::jsonb),
  'invalid_dates', (select count(*) from dated where received_date is null),
  'synced_at', (select max(detail_synced_at) from public.erp_pr_details),
  'week_start', (select week_start from bounds),
  'today', p_today
);
$$;
revoke all on function public.warehouse_receipt_summary(date) from public, anon;
grant execute on function public.warehouse_receipt_summary(date) to authenticated, service_role;
