-- Read-only production regression assertions: counts, boundaries, details and grants.
do $$
declare result jsonb; expected_prs int; expected_entries int;
begin
  result := public.warehouse_receipt_summary('2026-11-04');
  select count(distinct d.purch_req_id),count(*) into expected_prs,expected_entries
  from public.erp_pr_details d cross join lateral jsonb_array_elements(d.product_receipts) r
  where split_part(r->>'createdAt',' ',1) in ('10/28/2026','10/29/2026','10/30/2026','10/31/2026','11/1/2026','11/2/2026','11/3/2026');
  assert (result#>>'{periods,current,prs}')::int = expected_prs, 'Wrong distinct PR count';
  assert (result#>>'{periods,current,entries}')::int = expected_entries, 'Wrong receipt count';
  assert result->>'week_start' = '2026-10-28', 'Wrong Wednesday boundary';
  assert public.warehouse_receipt_summary('2026-11-03')->>'week_start' = '2026-10-21', 'Tuesday boundary failed';
  assert not exists(select 1 from jsonb_array_elements(result->'rows') r where (r->>'received_date')::date not between '2026-10-28'::date and '2026-11-03'::date), 'Detail outside period';
  assert not has_function_privilege('anon','public.warehouse_receipt_summary(date)','execute'), 'Anonymous access allowed';
  assert not (select prosecdef from pg_proc where oid='public.warehouse_receipt_summary(date)'::regprocedure), 'RLS bypass';
end $$;
