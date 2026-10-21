-- Preserve pre-repair values outside the exposed API schema for audit/rollback.
create schema if not exists warehouse_repair_audit;
revoke all on schema warehouse_repair_audit from public, anon, authenticated;
create table warehouse_repair_audit.stock_before_numeric_repair_20261021 as select * from public.stock_items;
revoke all on warehouse_repair_audit.stock_before_numeric_repair_20261021 from public, anon, authenticated;

create or replace function public.erp_number(p_value text)
returns numeric language plpgsql immutable set search_path = public as $$
declare t text := btrim(p_value); accounting boolean;
begin
  if t is null or t='' then return null; end if;
  accounting := t ~ '^\(.*\)$';
  if accounting then t := btrim(substr(t,2,length(t)-2)); end if;
  t := regexp_replace(t, '^(MVR|USD|EUR|GBP|Rf\.?)[[:space:]]*', '', 'i');
  t := regexp_replace(t, '^[$€£][[:space:]]*', '');
  if t !~ '^[+-]?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]+)?$' then return null; end if;
  if accounting then return -abs(replace(t,',','')::numeric); end if;
  return replace(t,',','')::numeric;
end;
$$;

create or replace function public.erp_raw_number(p_raw jsonb,p_names text[])
returns numeric language plpgsql immutable set search_path = public as $$
declare name text; value text;
begin
  foreach name in array p_names loop
    select e.v into value from jsonb_each_text(coalesce(p_raw,'{}')) e(k,v)
    where regexp_replace(lower(e.k),'[^a-z0-9]','','g')=regexp_replace(lower(name),'[^a-z0-9]','','g')
      and btrim(coalesce(e.v,''))<>'' limit 1;
    if found then return public.erp_number(value); end if;
  end loop;
  return null;
end;
$$;

alter table public.stock_items add column is_current_snapshot boolean not null default true;
-- Initial membership is recovered only after checking it matches the completed upload.
do $$
declare expected bigint; actual bigint;
begin
 select (metrics->>'itemCount')::bigint into expected
 from public.weekly_snapshots where metrics->>'kind'='AGEING'
 order by snapshot_date desc,created_at desc limit 1;
 select count(*) into actual from public.stock_items
 where source_updated_at::date=(select max(source_updated_at)::date from public.stock_items);
 if expected is null or actual<>expected then raise exception 'Cannot safely identify the latest stock snapshot'; end if;
 update public.stock_items set is_current_snapshot=(source_updated_at::date=(select max(source_updated_at)::date from public.stock_items));
end;
$$;
update public.stock_items set
 on_hand=coalesce(public.erp_raw_number(raw_source,array['On Hand','On-hand','On-hand quantity','On Hand Quantity','Physical Inventory','Stock']),on_hand),
 available=coalesce(public.erp_raw_number(raw_source,array['On Hand','On-hand','On-hand quantity','On Hand Quantity','Physical Inventory','Stock']),available),
 unit_cost=coalesce(public.erp_raw_number(raw_source,array['Average unit cost','Unit Cost','Cost Price','Cost']),unit_cost),
 stock_value=coalesce(public.erp_raw_number(raw_source,array['On-hand value','On Hand Value']),stock_value)
where raw_source ? 'On-hand quantity';

create or replace view public.stock_items_fast with (security_invoker=true) as
 SELECT item_code,
    item_description,
    unit,
    on_hand,
    reserved,
    available,
    on_order,
    unit_cost,
    stock_value,
    age_band,
    last_transaction_date,
    source_updated_at,
    updated_at,
    jsonb_build_object('Item group', COALESCE((raw_source ->> 'Item group'::text), ''::text), 'Item number', COALESCE((raw_source ->> 'Item number'::text), item_code, ''::text), 'Product name', COALESCE((raw_source ->> 'Product name'::text), item_description, ''::text), 'Inventory unit', COALESCE((raw_source ->> 'Inventory unit'::text), unit, ''::text), 'On-hand quantity', COALESCE((raw_source ->> 'On-hand quantity'::text), (on_hand)::text, ''::text), 'On-hand value', COALESCE((raw_source ->> 'On-hand value'::text), (stock_value)::text, ''::text), 'Inventory value quantity', COALESCE((raw_source ->> 'Inventory value quantity'::text), ''::text), 'Inventory value', COALESCE((raw_source ->> 'Inventory value'::text), ''::text), 'Average unit cost', COALESCE((raw_source ->> 'Average unit cost'::text), (unit_cost)::text, ''::text), 'P1:Quantity', COALESCE((raw_source ->> 'P1:Quantity'::text), ''::text), 'P1:Amount', COALESCE((raw_source ->> 'P1:Amount'::text), ''::text), 'P2:Quantity', COALESCE((raw_source ->> 'P2:Quantity'::text), ''::text), 'P2:Amount', COALESCE((raw_source ->> 'P2:Amount'::text), ''::text), 'P3:Quantity', COALESCE((raw_source ->> 'P3:Quantity'::text), ''::text), 'P3:Amount', COALESCE((raw_source ->> 'P3:Amount'::text), ''::text), 'P4:Quantity', COALESCE((raw_source ->> 'P4:Quantity'::text), ''::text), 'P4:Amount', COALESCE((raw_source ->> 'P4:Amount'::text), ''::text), 'P5:Quantity', COALESCE((raw_source ->> 'P5:Quantity'::text), ''::text), 'P5:Amount', COALESCE((raw_source ->> 'P5:Amount'::text), ''::text)) AS raw_source
   FROM stock_items WHERE is_current_snapshot;
create or replace view public.home_high_consumption_stock with (security_invoker=true) as
 WITH consumption AS (
         SELECT upper(TRIM(BOTH FROM inventory_transactions.item_code)) AS item_code_key,
            max(inventory_transactions.item_code) AS item_code,
            sum(abs(COALESCE(inventory_transactions.quantity, (0)::numeric))) AS consumption_qty,
            sum(abs(COALESCE(inventory_transactions.cost, (0)::numeric))) AS consumption_value
           FROM inventory_transactions
          WHERE ((inventory_transactions.item_code IS NOT NULL) AND (TRIM(BOTH FROM inventory_transactions.item_code) <> ''::text) AND (lower(COALESCE(inventory_transactions.status, ''::text)) = ANY (ARRAY['sold'::text, 'deducted'::text])) AND (inventory_transactions.physical_date >= (date_trunc('year'::text, (CURRENT_DATE)::timestamp with time zone))::date))
          GROUP BY (upper(TRIM(BOTH FROM inventory_transactions.item_code)))
        ), ranked AS (
         SELECT consumption.item_code_key,
            consumption.item_code,
            consumption.consumption_qty,
            consumption.consumption_value,
            row_number() OVER (ORDER BY consumption.consumption_value DESC, consumption.consumption_qty DESC, consumption.item_code_key) AS consumption_rank
           FROM consumption
        )
 SELECT r.item_code,
    COALESCE(s.item_description, ''::text) AS item_description,
    COALESCE(s.on_hand, (0)::numeric) AS on_hand,
    COALESCE(s.available, (0)::numeric) AS available,
    COALESCE(s.stock_value, (0)::numeric) AS stock_value,
    r.consumption_qty,
    r.consumption_value,
    r.consumption_rank
   FROM (ranked r
     LEFT JOIN stock_items_fast s ON ((upper(TRIM(BOTH FROM s.item_code)) = r.item_code_key)))
  WHERE (r.consumption_rank <= 100);
create or replace view public.inventory_presentation_stock_summary with (security_invoker=true) as
 SELECT ( SELECT COALESCE(sum(stock_items.stock_value), (0)::numeric) AS "coalesce"
           FROM stock_items_fast) AS current_inventory_value,
    ( SELECT COALESCE(sum(abs(inventory_transactions.cost)), (0)::numeric) AS "coalesce"
           FROM inventory_transactions
          WHERE ((inventory_transactions.physical_date >= (date_trunc('year'::text, (CURRENT_DATE)::timestamp with time zone))::date) AND (lower(COALESCE(inventory_transactions.status, ''::text)) = ANY (ARRAY['sold'::text, 'deducted'::text])))) AS ytd_consumption_value,
    ( SELECT count(*) AS count
           FROM home_high_consumption_stock
          WHERE ((home_high_consumption_stock.on_hand > (0)::numeric) AND (home_high_consumption_stock.on_hand <= (5)::numeric))) AS high_use_low_stock,
    ( SELECT count(*) AS count
           FROM home_high_consumption_stock
          WHERE (home_high_consumption_stock.on_hand <= (0)::numeric)) AS high_use_out_of_stock;
create or replace view public.stock_ageing_fast with (security_invoker=true) as
 SELECT item_code,
    item_description,
    unit,
    on_hand,
    reserved,
    available,
    on_order,
    unit_cost,
    stock_value,
    age_band,
    last_transaction_date,
    source_updated_at,
    updated_at,
    raw_source,
    COALESCE(public.erp_number(raw_source ->> 'On-hand quantity'), on_hand, (0)::numeric) AS calc_on_hand_qty,
    COALESCE(public.erp_number(raw_source ->> 'On-hand value'), (0)::numeric) AS calc_on_hand_value,
    COALESCE(public.erp_number(raw_source ->> 'Inventory value quantity'), (0)::numeric) AS calc_inventory_value_qty,
    COALESCE(public.erp_number(raw_source ->> 'Inventory value'), (0)::numeric) AS calc_inventory_value,
    COALESCE(public.erp_number(raw_source ->> 'P1:Quantity'), (0)::numeric) AS p1_qty,
    COALESCE(public.erp_number(raw_source ->> 'P1:Amount'), (0)::numeric) AS p1_amt,
    COALESCE(public.erp_number(raw_source ->> 'P2:Quantity'), (0)::numeric) AS p2_qty,
    COALESCE(public.erp_number(raw_source ->> 'P2:Amount'), (0)::numeric) AS p2_amt,
    COALESCE(public.erp_number(raw_source ->> 'P3:Quantity'), (0)::numeric) AS p3_qty,
    COALESCE(public.erp_number(raw_source ->> 'P3:Amount'), (0)::numeric) AS p3_amt,
    COALESCE(public.erp_number(raw_source ->> 'P4:Quantity'), (0)::numeric) AS p4_qty,
    COALESCE(public.erp_number(raw_source ->> 'P4:Amount'), (0)::numeric) AS p4_amt,
    COALESCE(public.erp_number(raw_source ->> 'P5:Quantity'), (0)::numeric) AS p5_qty,
    COALESCE(public.erp_number(raw_source ->> 'P5:Amount'), (0)::numeric) AS p5_amt,
    row_number() OVER (ORDER BY COALESCE(public.erp_number(raw_source ->> 'On-hand value'), (0)::numeric) DESC, item_code) AS high_value_rank
   FROM stock_items_fast s;
create or replace view public.procurement_pr_fast with (security_invoker=true) as
 SELECT id,
    prf_no,
    pr_no,
    po_no,
    section,
    workshop,
    vessel,
    asset,
    sr_wo,
    priority,
    supplier,
    item_code,
    item_description,
    unit,
    qty_requested,
    qty_ordered,
    qty_received,
    balance_qty,
    currency,
    amount,
    pr_date,
    po_date,
    required_date,
    expected_delivery,
    payment_status,
    delivery_status,
    status,
    remarks,
    source_type,
    source_updated_at,
    raw_source,
    created_at,
    updated_at,
    linked_pr_mtr,
    work_order_type,
    purchase_from,
    purchase_type,
    processed_date,
    requested_by,
    modified_by,
    cancel_reject_reason,
    latest_updates,
    COALESCE(pr_date,
        CASE
            WHEN (COALESCE((raw_source ->> 'Submitted Date'::text), ''::text) ~ '^\d{1,2}-[A-Za-z]{3}-\d{2,4}$'::text) THEN to_date((raw_source ->> 'Submitted Date'::text),
            CASE
                WHEN (length(split_part((raw_source ->> 'Submitted Date'::text), '-'::text, 3)) = 2) THEN 'DD-Mon-YY'::text
                ELSE 'DD-Mon-YYYY'::text
            END)
            ELSE NULL::date
        END) AS submitted_date_calc,
        CASE
            WHEN (COALESCE((raw_source ->> 'Received Date'::text), ''::text) ~ '^\d{1,2}-[A-Za-z]{3}-\d{2,4}$'::text) THEN to_date((raw_source ->> 'Received Date'::text),
            CASE
                WHEN (length(split_part((raw_source ->> 'Received Date'::text), '-'::text, 3)) = 2) THEN 'DD-Mon-YY'::text
                ELSE 'DD-Mon-YYYY'::text
            END)
            WHEN (COALESCE((raw_source ->> 'Received Date'::text), ''::text) ~ '^\d{4}-\d{1,2}-\d{1,2}$'::text) THEN ((raw_source ->> 'Received Date'::text))::date
            ELSE NULL::date
        END AS received_date_calc,
    GREATEST(COALESCE(qty_requested, public.erp_raw_number(raw_source,array['Requested Qty','Request Qty','Quantity','PR Qty']),0),0) AS requested_calc,
    GREATEST(COALESCE(qty_received,
 public.erp_raw_number(raw_source,array['Received','Received Qty','Received Quantity','Receipt Qty','PO Received Qty','Total Received Qty','Delivered Qty']),
 case when lower(coalesce(status,'')||' '||coalesce(delivery_status,'')||' '||
 coalesce(raw_source->>'PO ERP Status',raw_source->>'Receipt Status','')) ~ '(receiv|delivered)'
 and lower(coalesce(status,'')||' '||coalesce(delivery_status,'')||' '||
 coalesce(raw_source->>'PO ERP Status',raw_source->>'Receipt Status','')) !~ '(not\s*receiv|pending|awaiting|partial|part\s*receiv|cancel|reject)'
 then coalesce(qty_requested,public.erp_raw_number(raw_source,array['Requested Qty','Request Qty','Quantity','PR Qty']),0) else 0 end),0) AS received_calc,
    COALESCE(NULLIF(amount, (0)::numeric),
        CASE
            WHEN (regexp_replace(COALESCE((raw_source ->> 'PO Value'::text), ''::text), '[^0-9.-]'::text, ''::text, 'g'::text) ~ '^-?[0-9]+(\.[0-9]+)?$'::text) THEN (regexp_replace(COALESCE((raw_source ->> 'PO Value'::text), ''::text), '[^0-9.-]'::text, ''::text, 'g'::text))::numeric
            ELSE (0)::numeric
        END, (0)::numeric) AS amount_calc,
    lower(((((((COALESCE(status, ''::text) || ' '::text) || COALESCE(delivery_status, ''::text)) || ' '::text) || COALESCE((raw_source ->> 'PO ERP Status'::text), ''::text)) || ' '::text) || COALESCE((raw_source ->> 'PO ERP 
Status'::text), ''::text))) AS status_text_calc
   FROM procurement_records p
  WHERE (source_type = 'PR'::text);
create or replace view public.pr_lifecycle_fast with (security_invoker=true) as
 WITH line_agg AS (
         SELECT upper(TRIM(BOTH FROM procurement_records.pr_no)) AS pr_key,
            count(*) AS line_count,
            COALESCE(sum(GREATEST(COALESCE(procurement_records.requested_calc, 0::numeric), 0::numeric)), 0::numeric) AS requested_qty,
            COALESCE(sum(case when procurement_records.requested_calc>0 then least(procurement_records.requested_calc,procurement_records.received_calc) else procurement_records.received_calc end), 0::numeric) AS received_qty,
            count(DISTINCT NULLIF(TRIM(BOTH FROM procurement_records.po_no), ''::text)) AS erp_po_count,
            count(*) FILTER (WHERE lower(COALESCE(procurement_records.priority, ''::text)) ~ '(urgent|critical|high)'::text AND NOT (lower((COALESCE(procurement_records.status, ''::text) || ' '::text) || COALESCE(procurement_records.delivery_status, ''::text)) ~ '(cancel|reject|closed|fully received|completed)'::text OR COALESCE(procurement_records.requested_calc, 0::numeric) > 0::numeric AND COALESCE(procurement_records.received_calc, 0::numeric) >= COALESCE(procurement_records.requested_calc, 0::numeric))) AS urgent_open_lines
           FROM procurement_pr_fast procurement_records
          WHERE procurement_records.source_type = 'PR'::text AND NULLIF(TRIM(BOTH FROM COALESCE(procurement_records.pr_no, ''::text)), ''::text) IS NOT NULL
          GROUP BY (upper(TRIM(BOTH FROM procurement_records.pr_no)))
        ), po_status AS (
         SELECT d_1.purch_req_id,
            string_agg(DISTINCT NULLIF(TRIM(BOTH FROM x.elem ->> 'PurchStatus'::text), ''::text), ' / '::text) AS po_status_text
           FROM erp_pr_details d_1
             LEFT JOIN LATERAL jsonb_array_elements(COALESCE(d_1.purchase_orders, '[]'::jsonb)) x(elem) ON true
          GROUP BY d_1.purch_req_id
        )
 SELECT h.purch_req_id,
    h.description,
    h.created_at,
    h.created_at_raw,
    h.created_by,
    h.site,
    h.status,
    d.current_approver,
    d.current_workflow_status,
    d.rfq_count,
    d.po_count,
    d.receipt_count,
    d.detail_synced_at,
    d.purch_req_id IS NOT NULL AS detail_synced,
    COALESCE(l.line_count, 0::bigint) AS line_count,
    COALESCE(l.requested_qty, 0::numeric) AS requested_qty,
    COALESCE(l.received_qty, 0::numeric) AS received_qty,
    COALESCE(l.erp_po_count, 0::bigint) AS erp_po_count,
    COALESCE(l.urgent_open_lines, 0::bigint) AS urgent_open_lines,
    COALESCE(p.po_status_text, ''::text) AS po_status_text
   FROM erp_pr_headers h
     LEFT JOIN erp_pr_details d ON upper(TRIM(BOTH FROM d.purch_req_id)) = upper(TRIM(BOTH FROM h.purch_req_id))
     LEFT JOIN line_agg l ON l.pr_key = upper(TRIM(BOTH FROM h.purch_req_id))
     LEFT JOIN po_status p ON upper(TRIM(BOTH FROM p.purch_req_id)) = upper(TRIM(BOTH FROM h.purch_req_id));
create or replace view public.inventory_procurement_summary with (security_invoker=true) as
 WITH pr_agg AS (
         SELECT upper(TRIM(BOTH FROM procurement_pr_fast_1.pr_no)) AS pr_key,
            min(procurement_pr_fast_1.submitted_date_calc) AS submitted_date,
            sum(procurement_pr_fast_1.requested_calc) AS requested,
            sum(procurement_pr_fast_1.received_calc) AS received,
            count(*) AS line_count,
            count(*) FILTER (WHERE (procurement_pr_fast_1.status_text_calc !~ '(cancel|reject)'::text)) AS active_lines
           FROM procurement_pr_fast procurement_pr_fast_1
          WHERE (NULLIF(TRIM(BOTH FROM COALESCE(procurement_pr_fast_1.pr_no, ''::text)), ''::text) IS NOT NULL)
          GROUP BY (upper(TRIM(BOTH FROM procurement_pr_fast_1.pr_no)))
        ), open_pr AS (
         SELECT pr_agg.pr_key,
            pr_agg.submitted_date,
            pr_agg.requested,
            pr_agg.received,
            pr_agg.line_count,
            pr_agg.active_lines,
            GREATEST(0, ((current_timestamp at time zone 'Indian/Maldives')::date - pr_agg.submitted_date)) AS age_days
           FROM pr_agg
          WHERE ((pr_agg.active_lines > 0) AND (pr_agg.submitted_date IS NOT NULL) AND (NOT ((pr_agg.requested > (0)::numeric) AND (pr_agg.received >= pr_agg.requested))))
        ), current_week AS (
         SELECT (((current_timestamp at time zone 'Indian/Maldives')::date - ((((EXTRACT(dow FROM (current_timestamp at time zone 'Indian/Maldives')::date))::integer - 3) + 7) % 7)) - 7) AS week_start
        ), receipt_line AS (
         SELECT procurement_pr_fast_1.id,
            procurement_pr_fast_1.prf_no,
            procurement_pr_fast_1.pr_no,
            procurement_pr_fast_1.po_no,
            procurement_pr_fast_1.section,
            procurement_pr_fast_1.workshop,
            procurement_pr_fast_1.vessel,
            procurement_pr_fast_1.asset,
            procurement_pr_fast_1.sr_wo,
            procurement_pr_fast_1.priority,
            procurement_pr_fast_1.supplier,
            procurement_pr_fast_1.item_code,
            procurement_pr_fast_1.item_description,
            procurement_pr_fast_1.unit,
            procurement_pr_fast_1.qty_requested,
            procurement_pr_fast_1.qty_ordered,
            procurement_pr_fast_1.qty_received,
            procurement_pr_fast_1.balance_qty,
            procurement_pr_fast_1.currency,
            procurement_pr_fast_1.amount,
            procurement_pr_fast_1.pr_date,
            procurement_pr_fast_1.po_date,
            procurement_pr_fast_1.required_date,
            procurement_pr_fast_1.expected_delivery,
            procurement_pr_fast_1.payment_status,
            procurement_pr_fast_1.delivery_status,
            procurement_pr_fast_1.status,
            procurement_pr_fast_1.remarks,
            procurement_pr_fast_1.source_type,
            procurement_pr_fast_1.source_updated_at,
            procurement_pr_fast_1.raw_source,
            procurement_pr_fast_1.created_at,
            procurement_pr_fast_1.updated_at,
            procurement_pr_fast_1.linked_pr_mtr,
            procurement_pr_fast_1.work_order_type,
            procurement_pr_fast_1.purchase_from,
            procurement_pr_fast_1.purchase_type,
            procurement_pr_fast_1.processed_date,
            procurement_pr_fast_1.requested_by,
            procurement_pr_fast_1.modified_by,
            procurement_pr_fast_1.cancel_reject_reason,
            procurement_pr_fast_1.latest_updates,
            procurement_pr_fast_1.submitted_date_calc,
            procurement_pr_fast_1.received_date_calc,
            procurement_pr_fast_1.requested_calc,
            procurement_pr_fast_1.received_calc,
            procurement_pr_fast_1.amount_calc,
            procurement_pr_fast_1.status_text_calc,
                CASE
                    WHEN (procurement_pr_fast_1.requested_calc > (0)::numeric) THEN (procurement_pr_fast_1.amount_calc * LEAST((1)::numeric, (procurement_pr_fast_1.received_calc / procurement_pr_fast_1.requested_calc)))
                    ELSE procurement_pr_fast_1.amount_calc
                END AS received_value_calc
           FROM procurement_pr_fast procurement_pr_fast_1
          WHERE ((procurement_pr_fast_1.received_date_calc IS NOT NULL) AND (procurement_pr_fast_1.received_calc > (0)::numeric))
        ), current_receipts AS (
         SELECT r.id,
            r.prf_no,
            r.pr_no,
            r.po_no,
            r.section,
            r.workshop,
            r.vessel,
            r.asset,
            r.sr_wo,
            r.priority,
            r.supplier,
            r.item_code,
            r.item_description,
            r.unit,
            r.qty_requested,
            r.qty_ordered,
            r.qty_received,
            r.balance_qty,
            r.currency,
            r.amount,
            r.pr_date,
            r.po_date,
            r.required_date,
            r.expected_delivery,
            r.payment_status,
            r.delivery_status,
            r.status,
            r.remarks,
            r.source_type,
            r.source_updated_at,
            r.raw_source,
            r.created_at,
            r.updated_at,
            r.linked_pr_mtr,
            r.work_order_type,
            r.purchase_from,
            r.purchase_type,
            r.processed_date,
            r.requested_by,
            r.modified_by,
            r.cancel_reject_reason,
            r.latest_updates,
            r.submitted_date_calc,
            r.received_date_calc,
            r.requested_calc,
            r.received_calc,
            r.amount_calc,
            r.status_text_calc,
            r.received_value_calc
           FROM receipt_line r,
            current_week w
          WHERE ((r.received_date_calc >= w.week_start) AND (r.received_date_calc <= (w.week_start + 6)))
        ), previous_receipts AS (
         SELECT r.id,
            r.prf_no,
            r.pr_no,
            r.po_no,
            r.section,
            r.workshop,
            r.vessel,
            r.asset,
            r.sr_wo,
            r.priority,
            r.supplier,
            r.item_code,
            r.item_description,
            r.unit,
            r.qty_requested,
            r.qty_ordered,
            r.qty_received,
            r.balance_qty,
            r.currency,
            r.amount,
            r.pr_date,
            r.po_date,
            r.required_date,
            r.expected_delivery,
            r.payment_status,
            r.delivery_status,
            r.status,
            r.remarks,
            r.source_type,
            r.source_updated_at,
            r.raw_source,
            r.created_at,
            r.updated_at,
            r.linked_pr_mtr,
            r.work_order_type,
            r.purchase_from,
            r.purchase_type,
            r.processed_date,
            r.requested_by,
            r.modified_by,
            r.cancel_reject_reason,
            r.latest_updates,
            r.submitted_date_calc,
            r.received_date_calc,
            r.requested_calc,
            r.received_calc,
            r.amount_calc,
            r.status_text_calc,
            r.received_value_calc
           FROM receipt_line r,
            current_week w
          WHERE ((r.received_date_calc >= (w.week_start - 7)) AND (r.received_date_calc <= (w.week_start - 1)))
        ), month_receipts AS (
         SELECT receipt_line.id,
            receipt_line.prf_no,
            receipt_line.pr_no,
            receipt_line.po_no,
            receipt_line.section,
            receipt_line.workshop,
            receipt_line.vessel,
            receipt_line.asset,
            receipt_line.sr_wo,
            receipt_line.priority,
            receipt_line.supplier,
            receipt_line.item_code,
            receipt_line.item_description,
            receipt_line.unit,
            receipt_line.qty_requested,
            receipt_line.qty_ordered,
            receipt_line.qty_received,
            receipt_line.balance_qty,
            receipt_line.currency,
            receipt_line.amount,
            receipt_line.pr_date,
            receipt_line.po_date,
            receipt_line.required_date,
            receipt_line.expected_delivery,
            receipt_line.payment_status,
            receipt_line.delivery_status,
            receipt_line.status,
            receipt_line.remarks,
            receipt_line.source_type,
            receipt_line.source_updated_at,
            receipt_line.raw_source,
            receipt_line.created_at,
            receipt_line.updated_at,
            receipt_line.linked_pr_mtr,
            receipt_line.work_order_type,
            receipt_line.purchase_from,
            receipt_line.purchase_type,
            receipt_line.processed_date,
            receipt_line.requested_by,
            receipt_line.modified_by,
            receipt_line.cancel_reject_reason,
            receipt_line.latest_updates,
            receipt_line.submitted_date_calc,
            receipt_line.received_date_calc,
            receipt_line.requested_calc,
            receipt_line.received_calc,
            receipt_line.amount_calc,
            receipt_line.status_text_calc,
            receipt_line.received_value_calc
           FROM receipt_line
          WHERE ((receipt_line.received_date_calc >= (date_trunc('month'::text, ((current_timestamp at time zone 'Indian/Maldives')::date)::timestamp with time zone))::date) AND (receipt_line.received_date_calc <= (current_timestamp at time zone 'Indian/Maldives')::date))
        ), current_received_prs AS (
         SELECT DISTINCT upper(TRIM(BOTH FROM current_receipts.pr_no)) AS pr_key
           FROM current_receipts
          WHERE (NULLIF(TRIM(BOTH FROM COALESCE(current_receipts.pr_no, ''::text)), ''::text) IS NOT NULL)
        ), current_pr_state AS (
         SELECT a.pr_key,
            a.submitted_date,
            a.requested,
            a.received,
            a.line_count,
            a.active_lines
           FROM (pr_agg a
             JOIN current_received_prs c USING (pr_key))
        )
 SELECT (select count(distinct upper(trim(purch_req_id))) from public.erp_pr_headers
 where (created_at at time zone 'Indian/Maldives')::date between date_trunc('month',(current_timestamp at time zone 'Indian/Maldives')::date)::date and (current_timestamp at time zone 'Indian/Maldives')::date) AS submitted_this_month,
    count(DISTINCT upper(TRIM(BOTH FROM po_no))) FILTER (WHERE ((NULLIF(TRIM(BOTH FROM COALESCE(po_no, ''::text)), ''::text) IS NOT NULL) AND (TRIM(BOTH FROM po_no) !~ '^0(?:\.0+)?$'::text) AND (status_text_calc !~ '(cancel|reject)'::text) AND (received_calc <= (0)::numeric))) AS receipt_pending_pos,
    count(DISTINCT upper(TRIM(BOTH FROM pr_no))) FILTER (WHERE ((lower(COALESCE(priority, ''::text)) ~ '(urgent|critical|high)'::text) AND (status_text_calc !~ '(closed|complete|completed|received|delivered|cancel|reject)'::text) AND (NOT ((requested_calc > (0)::numeric) AND (received_calc >= requested_calc))) AND (NULLIF(TRIM(BOTH FROM COALESCE(pr_no, ''::text)), ''::text) IS NOT NULL))) AS urgent_pending_prs,
    ( SELECT count(*) AS count
           FROM open_pr
          WHERE ((open_pr.age_days >= 91) AND (open_pr.age_days <= 183))) AS aged_three_to_six,
    ( SELECT count(*) AS count
           FROM open_pr
          WHERE (open_pr.age_days >= 184)) AS aged_six_plus,
    COALESCE(( SELECT max(open_pr.age_days) AS max
           FROM open_pr), 0) AS oldest_open_days,
    ( SELECT count(*) AS count
           FROM current_pending_payment_records) AS payment_pending_pos,
    ( SELECT current_week.week_start
           FROM current_week) AS receipt_week_start,
    ( SELECT count(DISTINCT NULLIF(TRIM(BOTH FROM current_receipts.pr_no), ''::text)) AS count
           FROM current_receipts) AS current_receipt_prs,
    ( SELECT count(*) AS count
           FROM current_receipts) AS current_receipt_lines,
    COALESCE(( SELECT sum(current_receipts.received_calc) AS sum
           FROM current_receipts), (0)::numeric) AS current_receipt_qty,
    COALESCE(( SELECT sum(current_receipts.received_value_calc) AS sum
           FROM current_receipts), (0)::numeric) AS current_receipt_value,
    ( SELECT count(DISTINCT NULLIF(TRIM(BOTH FROM previous_receipts.pr_no), ''::text)) AS count
           FROM previous_receipts) AS previous_receipt_prs,
    ( SELECT count(*) AS count
           FROM previous_receipts) AS previous_receipt_lines,
    COALESCE(( SELECT sum(previous_receipts.received_calc) AS sum
           FROM previous_receipts), (0)::numeric) AS previous_receipt_qty,
    COALESCE(( SELECT sum(previous_receipts.received_value_calc) AS sum
           FROM previous_receipts), (0)::numeric) AS previous_receipt_value,
    ( SELECT count(*) AS count
           FROM current_pr_state
          WHERE ((current_pr_state.requested > (0)::numeric) AND (current_pr_state.received >= current_pr_state.requested))) AS fully_received_prs,
    ( SELECT count(*) AS count
           FROM current_pr_state
          WHERE ((current_pr_state.received > (0)::numeric) AND (NOT ((current_pr_state.requested > (0)::numeric) AND (current_pr_state.received >= current_pr_state.requested))))) AS part_received_prs,
    ( SELECT count(DISTINCT NULLIF(TRIM(BOTH FROM month_receipts.pr_no), ''::text)) AS count
           FROM month_receipts) AS month_received_prs,
    COALESCE(( SELECT sum(month_receipts.received_calc) AS sum
           FROM month_receipts), (0)::numeric) AS month_received_qty,
    COALESCE(( SELECT sum(month_receipts.received_value_calc) AS sum
           FROM month_receipts), (0)::numeric) AS month_received_value
   FROM procurement_pr_fast;
create or replace view public.portal_home_summary with (security_invoker=true) as
with p as (
 select count(*) filter(where source_type='PRF') as prf_count,
 count(*) filter(where source_type in ('PR','PO') and lower(coalesce(status,'')||' '||coalesce(delivery_status,'')) !~ '(closed|complete|completed|received|delivered|cancelled|canceled)') as pending_count
 from public.procurement_records
), m as (
 select count(distinct coalesce(nullif(btrim(raw_source->>'ID'),''),id::text)) filter(where document_type='MRN') as mrn_count
 from public.material_records
)
select p.prf_count,m.mrn_count,p.pending_count,a.on_hand_value as stock_value,a.aged_over_365 as aged_value
from p cross join m cross join public.stock_ageing_summary a;

CREATE OR REPLACE FUNCTION public.overview_material_issue_summary(p_from date, p_to date)
 RETURNS TABLE(mtrs bigint, mrns bigint, pending_mrns bigint, issue_records bigint, issue_qty numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
      with material_period as (
        select
          document_type,
          document_no,
          coalesce(nullif(raw_source->>'ID',''), id::text) as source_id,
          coalesce(nullif(raw_source->>'Issued Status',''),'NOT ISSUED') as issued_status
        from public.material_records
        where document_date between p_from and p_to
          and document_type in ('MTR','MRN')
      ),
      issue_period as (
        select quantity
        from public.sr_issue_records
        where requested_receipt_date between p_from and p_to
      )
      select
        count(distinct document_no) filter (where document_type='MTR')::bigint,
        count(distinct source_id) filter (where document_type='MRN')::bigint,
        count(distinct source_id) filter (
          where document_type='MRN'
            and upper(trim(issued_status)) in ('NOT ISSUED','BLANK')
        )::bigint,
        (select count(*)::bigint from issue_period),
        coalesce((select sum(abs(coalesce(quantity,0))) from issue_period),0)::numeric
      from material_period;
    $function$



-- RLS remains in force; this function deliberately uses invoker privileges.
create or replace function public.commit_stock_snapshot(p_rows jsonb,p_snapshot jsonb default null)
returns bigint language plpgsql set search_path = public as $$
declare v_count bigint; v_expected bigint; v_snapshot_id bigint;
begin
 if not exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>'email') and a.active and a.role in ('admin','editor')) then
   raise exception 'Not authorized to import stock';
 end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then
   raise exception 'Stock snapshot must contain rows';
 end if;
 select count(distinct btrim(e->>'item_code')) into v_expected from jsonb_array_elements(p_rows) e where nullif(btrim(e->>'item_code'),'') is not null;
 if v_expected<>jsonb_array_length(p_rows) then raise exception 'Stock snapshot contains duplicate or empty item codes'; end if;
 if p_snapshot is not null and (p_snapshot->'metrics'->>'kind' is distinct from 'AGEING' or (p_snapshot->'metrics'->>'itemCount')::bigint is distinct from v_expected) then
   raise exception 'Stock snapshot metrics do not match rows';
 end if;
 -- Serialize complete imports; failed validation/writes roll back the entire snapshot.
 perform pg_advisory_xact_lock(730214);
 update public.stock_items set is_current_snapshot=false where is_current_snapshot;
 insert into public.stock_items(item_code,item_description,unit,on_hand,reserved,available,on_order,unit_cost,stock_value,age_band,last_transaction_date,source_updated_at,raw_source,updated_at,is_current_snapshot)
 select btrim(x.item_code),x.item_description,x.unit,x.on_hand,coalesce(x.reserved,0),x.available,coalesce(x.on_order,0),x.unit_cost,x.stock_value,x.age_band,x.last_transaction_date,x.source_updated_at,x.raw_source,x.updated_at,true
 from jsonb_populate_recordset(null::public.stock_items,p_rows) x
 on conflict(item_code) do update set
 item_description=excluded.item_description,unit=excluded.unit,on_hand=excluded.on_hand,
 reserved=excluded.reserved,available=excluded.available,on_order=excluded.on_order,unit_cost=excluded.unit_cost,
 stock_value=excluded.stock_value,age_band=excluded.age_band,last_transaction_date=excluded.last_transaction_date,
 source_updated_at=excluded.source_updated_at,raw_source=excluded.raw_source,updated_at=excluded.updated_at,is_current_snapshot=true;
 get diagnostics v_count=row_count;
 if v_count<>v_expected then raise exception 'Incomplete stock snapshot'; end if;
 if p_snapshot is not null then
   select id into v_snapshot_id from public.weekly_snapshots
   where snapshot_date=(p_snapshot->>'snapshot_date')::date and metrics->>'kind'='AGEING'
   order by created_at desc limit 1;
   if v_snapshot_id is null then
     insert into public.weekly_snapshots(snapshot_date,label,metrics,priority_cases,created_by)
     values((p_snapshot->>'snapshot_date')::date,p_snapshot->>'label',p_snapshot->'metrics','[]',p_snapshot->>'created_by');
   else
     update public.weekly_snapshots set label=p_snapshot->>'label',metrics=p_snapshot->'metrics',created_by=p_snapshot->>'created_by'
     where id=v_snapshot_id;
   end if;
 end if;
 return v_count;
end;
$$;
revoke all on function public.commit_stock_snapshot(jsonb,jsonb) from public,anon;
grant execute on function public.commit_stock_snapshot(jsonb,jsonb) to authenticated;
