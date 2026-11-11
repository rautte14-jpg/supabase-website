CREATE OR REPLACE FUNCTION public.warehouse_po_receipt_links(p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with raw as materialized (
  select d.purch_req_id as pr_no,
         upper(trim(r->>'po')) as po_no,
         coalesce(nullif(r->>'recId',''),nullif(r->>'id',''),r->>'productReciept') as receipt_id,
         case
           when r->>'createdAt' ~ '^\d{1,2}/\d{1,2}/\d{4}( |$)'
           then split_part(split_part(r->>'createdAt',' ',1),'/',3)||'-'||
             lpad(split_part(r->>'createdAt','/',1),2,'0')||'-'||
             lpad(split_part(r->>'createdAt','/',2),2,'0')
           when r->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}'
           then left(r->>'createdAt',10)
         end as date_text
  from public.erp_pr_details d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.product_receipts)='array' then d.product_receipts else '[]'::jsonb end
  ) r
), dated as (
 select pr_no,po_no,receipt_id,
        case when pg_input_is_valid(date_text,'date') then date_text::date end as received_date
 from raw
), per_po as (
 select pr_no,po_no,
        count(distinct (receipt_id,received_date)) filter(where received_date is not null) as receipt_events,
        array_agg(distinct received_date order by received_date) filter(where received_date is not null) as receipt_dates
 from dated where po_no is not null and po_no<>'' and pr_no is not null
 group by pr_no,po_no
)
select coalesce(jsonb_agg(jsonb_build_object(
 'pr_no',pr_no,'po_no',po_no,'receipt_events',receipt_events,'receipt_dates',receipt_dates
) order by pr_no,po_no),'[]'::jsonb)
from per_po
where receipt_dates[array_length(receipt_dates,1)] >= p_today - 120
$function$

revoke all on function public.warehouse_po_receipt_links(date) from public, anon;
grant execute on function public.warehouse_po_receipt_links(date) to authenticated;
