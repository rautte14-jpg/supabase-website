-- Preserve physical stock and ageing reports as independent sources.
create table public.stock_ageing_items (like public.stock_items including defaults including constraints including indexes);
alter table public.stock_ageing_items enable row level security;
create table public.inventory_snapshot_archives (
  source_type text not null check(source_type in ('STOCK','AGEING')),
  snapshot_date date not null,
  source_file text,
  item_count bigint not null check(item_count>=0),
  metrics jsonb not null default '{}'::jsonb,
  rows jsonb,
  details_complete boolean not null default false,
  imported_at timestamptz not null default now(),
  imported_by text,
  primary key(source_type,snapshot_date),
  check(not details_complete or (jsonb_typeof(rows)='array' and jsonb_array_length(rows)=item_count))
);
alter table public.inventory_snapshot_archives enable row level security;
revoke all on public.stock_ageing_items,public.inventory_snapshot_archives from anon;
grant select,insert,update on public.stock_ageing_items,public.inventory_snapshot_archives to authenticated;
grant all on public.stock_ageing_items,public.inventory_snapshot_archives to service_role;
do $policies$
declare t text;
begin
 foreach t in array array['stock_ageing_items','inventory_snapshot_archives'] loop
  execute format('create policy portal_member_read on public.%I for select to authenticated using (exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>''email'') and a.active))',t);
  execute format('create policy portal_editor_write on public.%I for all to authenticated using (exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>''email'') and a.active and a.role in (''admin'',''editor''))) with check (exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>''email'') and a.active and a.role in (''admin'',''editor'')))',t);
 end loop;
end $policies$;
-- Only the aggregate ageing history survived the old destructive upload.
insert into public.inventory_snapshot_archives(source_type,snapshot_date,source_file,item_count,metrics,details_complete,imported_at,imported_by)
select distinct on(s.snapshot_date) 'AGEING',s.snapshot_date,coalesce(s.metrics->>'sourceFile',s.label),(s.metrics->>'itemCount')::bigint,s.metrics,false,s.created_at,s.created_by
from public.weekly_snapshots s where s.metrics->>'kind'='AGEING' order by s.snapshot_date,s.created_at desc;
insert into public.inventory_snapshot_archives(source_type,snapshot_date,source_file,item_count,metrics,rows,details_complete,imported_at,imported_by)
select 'STOCK',coalesce(u.source_date,(u.imported_at at time zone 'Indian/Maldives')::date),u.file_name,count(*),jsonb_build_object('kind','STOCK','itemCount',count(*)),jsonb_agg(to_jsonb(s) order by s.item_code),true,u.imported_at,u.imported_by
from public.stock_items s cross join lateral(select * from public.source_updates where source_type='STOCK' order by imported_at desc limit 1)u
where s.is_current_snapshot group by u.source_date,u.file_name,u.imported_at,u.imported_by;
update public.weekly_snapshots set metrics=metrics||'{"itemDetailsAvailable":false}'::jsonb
where metrics->>'kind'='AGEING' and snapshot_date=(select max(snapshot_date) from public.weekly_snapshots where metrics->>'kind'='AGEING');
-- Keep the current column contract; only change its independent backing table.
do $ageview$
declare v text;
begin
 select pg_get_viewdef('public.stock_ageing_fast'::regclass,true) into v;
 if strpos(v,'FROM stock_items_fast s')=0 then raise exception 'Unexpected ageing view definition'; end if;
 v:=replace(v,'FROM stock_items_fast s','FROM public.stock_ageing_items s WHERE s.is_current_snapshot');
 execute 'create or replace view public.stock_ageing_fast with (security_invoker=true) as '||v;
end $ageview$;
create or replace view public.stock_ageing_summary with (security_invoker=true) as
with d as(select count(*) item_count,sum(calc_on_hand_qty) on_hand_qty,sum(calc_on_hand_value) on_hand_value,sum(calc_inventory_value_qty) inventory_value_qty,sum(calc_inventory_value) inventory_value,sum(p1_amt) p1,sum(p2_amt) p2,sum(p3_amt) p3,sum(p4_amt) p4,sum(p5_amt) p5,sum(p2_amt+p3_amt+p4_amt+p5_amt) aged_over_365,count(*) filter(where calc_on_hand_value>0 and high_value_rank<=100) high100_count,sum(calc_on_hand_value) filter(where calc_on_hand_value>0 and high_value_rank<=100) high100_value from public.stock_ageing_fast),
s as(select snapshot_date,metrics from public.weekly_snapshots where metrics->>'kind'='AGEING' order by snapshot_date desc,created_at desc limit 1),
a as(select snapshot_date,details_complete from public.inventory_snapshot_archives where source_type='AGEING' order by snapshot_date desc limit 1)
select coalesce((s.metrics->>'itemCount')::bigint,d.item_count) item_count,
coalesce((s.metrics->>'onHandQty')::numeric,d.on_hand_qty) on_hand_qty,
coalesce((s.metrics->>'onHandValue')::numeric,d.on_hand_value) on_hand_value,
case when a.details_complete then d.inventory_value_qty else null::numeric end inventory_value_qty,
coalesce((s.metrics->>'inventoryValue')::numeric,d.inventory_value) inventory_value,
coalesce((s.metrics->>'p1')::numeric,d.p1) p1,coalesce((s.metrics->>'p2')::numeric,d.p2) p2,coalesce((s.metrics->>'p3')::numeric,d.p3) p3,coalesce((s.metrics->>'p4')::numeric,d.p4) p4,coalesce((s.metrics->>'p5')::numeric,d.p5) p5,
coalesce((s.metrics->>'over1')::numeric,d.aged_over_365) aged_over_365,
case when a.details_complete then d.high100_count else null::bigint end high100_count,
case when a.details_complete then coalesce(d.high100_value,0) else null::numeric end high100_value,
s.snapshot_date,coalesce(a.details_complete and a.snapshot_date=s.snapshot_date,false) details_available,d.item_count detail_item_count
from d left join s on true left join a on true;
create or replace view public.inventory_presentation_stock_summary with (security_invoker=true) as
select (select on_hand_value from public.stock_ageing_summary) current_inventory_value,
(select coalesce(sum(abs(cost)),0)::numeric from public.inventory_transactions where physical_date>=date_trunc('year',current_date)::date and lower(coalesce(status,'')) in ('sold','deducted')) ytd_consumption_value,
(select count(*) from public.home_high_consumption_stock where on_hand>0 and on_hand<=5) high_use_low_stock,
(select count(*) from public.home_high_consumption_stock where on_hand<=0) high_use_out_of_stock;
create or replace function public.commit_stock_snapshot(p_rows jsonb,p_snapshot jsonb default null)
returns bigint language plpgsql set search_path=public as $function$
declare
 v_kind text:=case when p_snapshot is null then 'STOCK' else upper(coalesce(p_snapshot->'metrics'->>'kind','AGEING')) end;
 v_date date:=coalesce((p_snapshot->>'snapshot_date')::date,(now() at time zone 'Indian/Maldives')::date);
 v_email text:=(select auth.jwt())->>'email'; v_expected bigint; v_count bigint; v_metrics jsonb; v_id bigint; v_target text; v_file text;
begin
 if not exists(select 1 from public.portal_access a where lower(a.email)=lower(v_email) and a.active and a.role in ('admin','editor')) then raise exception 'Not authorized to import stock'; end if;
 if v_kind not in ('STOCK','AGEING') or v_date>(now() at time zone 'Indian/Maldives')::date then raise exception 'Invalid stock source or report date'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception 'Stock snapshot must contain rows'; end if;
 select count(distinct btrim(e->>'item_code')) into v_expected from jsonb_array_elements(p_rows)e where nullif(btrim(e->>'item_code'),'') is not null;
 if v_expected<>jsonb_array_length(p_rows) then raise exception 'Duplicate or empty stock item codes'; end if;
 if p_snapshot is not null and (p_snapshot->'metrics'->>'itemCount')::bigint is distinct from v_expected then raise exception 'Snapshot metrics do not match row count'; end if;
 if v_kind='AGEING' then
  if not exists(select 1 from jsonb_array_elements(p_rows)e where e->'raw_source' ? 'P1:Amount') then raise exception 'Ageing bucket columns are missing. Choose the Inventory Ageing export.'; end if;
  select jsonb_build_object('kind','AGEING','itemCount',count(*),'onHandQty',sum(coalesce(public.erp_number(e->'raw_source'->>'On-hand quantity'),0)),'onHandValue',sum(coalesce(public.erp_number(e->'raw_source'->>'On-hand value'),0)),'inventoryValue',sum(coalesce(public.erp_number(e->'raw_source'->>'Inventory value'),0)),'p1',sum(coalesce(public.erp_number(e->'raw_source'->>'P1:Amount'),0)),'p2',sum(coalesce(public.erp_number(e->'raw_source'->>'P2:Amount'),0)),'p3',sum(coalesce(public.erp_number(e->'raw_source'->>'P3:Amount'),0)),'p4',sum(coalesce(public.erp_number(e->'raw_source'->>'P4:Amount'),0)),'p5',sum(coalesce(public.erp_number(e->'raw_source'->>'P5:Amount'),0))) into v_metrics from jsonb_array_elements(p_rows)e;
  v_metrics:=coalesce(p_snapshot->'metrics','{}')||v_metrics;
  v_metrics:=v_metrics||jsonb_build_object('over1',(v_metrics->>'p2')::numeric+(v_metrics->>'p3')::numeric+(v_metrics->>'p4')::numeric+(v_metrics->>'p5')::numeric,'itemDetailsAvailable',true);
  if p_snapshot->'metrics' ? 'onHandValue' and abs((p_snapshot->'metrics'->>'onHandValue')::numeric-(v_metrics->>'onHandValue')::numeric)>0.01 then raise exception 'Ageing value does not reconcile to item rows'; end if;
 else v_metrics:=jsonb_build_object('kind','STOCK','itemCount',v_expected); end if;
 v_file:=coalesce(nullif(p_snapshot->>'source_file',''),nullif(p_snapshot->'metrics'->>'sourceFile',''),nullif(p_snapshot->>'label',''),case when v_kind='STOCK' then 'On-hand export' else 'Inventory ageing export' end);
 perform pg_advisory_xact_lock(730214);
 insert into public.inventory_snapshot_archives(source_type,snapshot_date,source_file,item_count,metrics,rows,details_complete,imported_by)
 values(v_kind,v_date,v_file,v_expected,v_metrics,p_rows,true,v_email)
 on conflict(source_type,snapshot_date) do update set source_file=excluded.source_file,item_count=excluded.item_count,metrics=excluded.metrics,rows=excluded.rows,details_complete=true,imported_at=now(),imported_by=excluded.imported_by;
 -- Historical imports are archived but never displace a newer source of the same type.
 if v_date=(select max(snapshot_date) from public.inventory_snapshot_archives where source_type=v_kind) then
  v_target:=case when v_kind='AGEING' then 'stock_ageing_items' else 'stock_items' end;
  execute format('update public.%I set is_current_snapshot=false where is_current_snapshot',v_target);
  execute format('insert into public.%I(item_code,item_description,unit,on_hand,reserved,available,on_order,unit_cost,stock_value,age_band,last_transaction_date,source_updated_at,raw_source,updated_at,is_current_snapshot) select btrim(x.item_code),x.item_description,x.unit,x.on_hand,coalesce(x.reserved,0),x.available,coalesce(x.on_order,0),x.unit_cost,x.stock_value,x.age_band,x.last_transaction_date,x.source_updated_at,x.raw_source,now(),true from jsonb_populate_recordset(null::public.stock_items,$1)x on conflict(item_code) do update set item_description=excluded.item_description,unit=excluded.unit,on_hand=excluded.on_hand,reserved=excluded.reserved,available=excluded.available,on_order=excluded.on_order,unit_cost=excluded.unit_cost,stock_value=excluded.stock_value,age_band=excluded.age_band,last_transaction_date=excluded.last_transaction_date,source_updated_at=excluded.source_updated_at,raw_source=excluded.raw_source,updated_at=excluded.updated_at,is_current_snapshot=true',v_target) using p_rows;
  get diagnostics v_count=row_count;
  if v_count<>v_expected then raise exception 'Incomplete stock import'; end if;
 end if;
 if v_kind='AGEING' then
  select id into v_id from public.weekly_snapshots where snapshot_date=v_date and metrics->>'kind'='AGEING' order by created_at desc limit 1;
  if v_id is null then insert into public.weekly_snapshots(snapshot_date,label,metrics,priority_cases,created_by) values(v_date,'Inventory Ageing — '||v_file,v_metrics,'[]',v_email);
  else update public.weekly_snapshots set label='Inventory Ageing — '||v_file,metrics=v_metrics,created_by=v_email where id=v_id; end if;
 end if;
 return v_expected;
end $function$;
revoke all on function public.commit_stock_snapshot(jsonb,jsonb) from public,anon;
grant execute on function public.commit_stock_snapshot(jsonb,jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
