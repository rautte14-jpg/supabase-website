-- Run only after database_security_cleanup.sql. All test changes roll back.
begin;

-- Test-only setup. This entire preflight is deliberately rolled back.
select set_config('hardening.expected_counts', (select jsonb_object_agg(t,c)::text from (
select 'case_notes' t,count(*) c from public."case_notes"
union all
select 'erp_pr_details' t,count(*) c from public."erp_pr_details"
union all
select 'erp_pr_headers' t,count(*) c from public."erp_pr_headers"
union all
select 'inventory_transactions' t,count(*) c from public."inventory_transactions"
union all
select 'lld_updates' t,count(*) c from public."lld_updates"
union all
select 'material_records' t,count(*) c from public."material_records"
union all
select 'pending_payment_records' t,count(*) c from public."pending_payment_records"
union all
select 'procurement_records' t,count(*) c from public."procurement_records"
union all
select 'source_updates' t,count(*) c from public."source_updates"
union all
select 'sr_issue_records' t,count(*) c from public."sr_issue_records"
union all
select 'stock_items' t,count(*) c from public."stock_items"
union all
select 'weekly_snapshots' t,count(*) c from public."weekly_snapshots"
) counts),true);

insert into public.portal_access(email,role,active) values
 ('hardening-viewer-test@invalid.example','viewer',true),
 ('hardening-editor-test@invalid.example','editor',true);

select set_config('request.jwt.claims','{"email":"hardening-viewer-test@invalid.example","role":"authenticated"}',true);
set local role authenticated;
do $test$
declare t text; actual bigint; expected jsonb := current_setting('hardening.expected_counts')::jsonb; affected bigint;
begin
 for t in select jsonb_object_keys(expected) loop
   execute format('select count(*) from public.%I',t) into actual;
   if actual <> (expected->>t)::bigint then raise exception 'Viewer read regression in %',t; end if;
 end loop;
 update public.stock_items set on_hand=on_hand where item_code='1-0064116';
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Viewer unexpectedly updated stock'; end if;
 begin
   perform public.finalize_sr_issue_import(gen_random_uuid());
   raise exception 'Viewer unexpectedly finalized import';
 exception when raise_exception then
   if sqlerrm <> 'Not authorized to replace SR issue data' then raise; end if;
 end;
end;
$test$;
reset role;

select set_config('request.jwt.claims','{"email":"hardening-nonmember-test@invalid.example","role":"authenticated"}',true);
set local role authenticated;
do $test$
declare t text; actual bigint;
begin
 for t in select jsonb_object_keys(current_setting('hardening.expected_counts')::jsonb) loop
   execute format('select count(*) from public.%I',t) into actual;
   if actual<>0 then raise exception 'Nonmember can read %',t; end if;
 end loop;
 begin
   perform public.finalize_sr_issue_import(gen_random_uuid());
   raise exception 'Nonmember unexpectedly finalized import';
 exception when raise_exception then
   if sqlerrm <> 'Not authorized to replace SR issue data' then raise; end if;
 end;
end;
$test$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $test$
begin
 begin
   perform public.finalize_sr_issue_import(gen_random_uuid());
   raise exception 'Anonymous finalizer execution was allowed';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
reset role;

select set_config('hardening.import_id',gen_random_uuid()::text,true);

insert into public.sr_issue_import_stage(import_id,project_id,requested_receipt_date,sales_order,line_number,item_code,warehouse,item_description,location,quantity,unit,customer_reference,customer_requisition,delivery_name,line_status,issue_state,created_by,service_order,category,workshop,sr_no,wo_no,mrn_no,source_updated_at,raw_source)
select current_setting('hardening.import_id')::uuid,project_id,requested_receipt_date,sales_order,line_number,item_code,warehouse,item_description,location,quantity,unit,customer_reference,customer_requisition,delivery_name,line_status,issue_state,created_by,service_order,category,workshop,sr_no,wo_no,mrn_no,source_updated_at,raw_source from public.sr_issue_records order by id limit 2;
select set_config('request.jwt.claims','{"email":"hardening-editor-test@invalid.example","role":"authenticated"}',true);
set local role authenticated;
do $test$
declare imported bigint; affected bigint;
begin
 update public.stock_items set on_hand=on_hand where item_code='1-0064116';
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'Editor stock update denied'; end if;
 imported := public.finalize_sr_issue_import(current_setting('hardening.import_id')::uuid);
 if imported<>2 or (select count(*) from public.sr_issue_records)<>2 then raise exception 'Editor SR import failed'; end if;
 if (select count(*) from public.sr_issue_import_stage where import_id=current_setting('hardening.import_id')::uuid)<>0 then raise exception 'Stage cleanup failed'; end if;
 perform (public.search_vessel_sr('SR'));
 perform (public.prf_tracker_data(null,'ALL','',1));
 perform (public.mtr_tracker_summary(null));
 if (select count(*) from public.stock_items_fast)<>6025 then raise exception 'Stock scope regression'; end if;
end;
$test$;
reset role;


-- Force an INSERT-policy failure after the DELETE and verify subtransaction rollback restores all rows.
insert into public.sr_issue_import_stage(import_id,project_id,requested_receipt_date,sales_order,line_number,item_code,warehouse,item_description,location,quantity,unit,customer_reference,customer_requisition,delivery_name,line_status,issue_state,created_by,service_order,category,workshop,sr_no,wo_no,mrn_no,source_updated_at,raw_source)
select current_setting('hardening.import_id')::uuid,project_id,requested_receipt_date,sales_order,line_number,item_code,warehouse,item_description,location,quantity,unit,customer_reference,customer_requisition,delivery_name,line_status,issue_state,created_by,service_order,category,workshop,sr_no,wo_no,mrn_no,source_updated_at,raw_source from public.sr_issue_records order by id limit 2;
drop policy sr_issue_records_editor_insert on public.sr_issue_records;
set local role authenticated;
do $test$
declare before_count bigint := (select count(*) from public.sr_issue_records);
begin
 begin
   perform public.finalize_sr_issue_import(current_setting('hardening.import_id')::uuid);
   raise exception 'Expected INSERT policy failure did not occur';
 exception when insufficient_privilege then
   if (select count(*) from public.sr_issue_records)<>before_count then raise exception 'Failed import lost prior rows'; end if;
   if (select count(*) from public.sr_issue_import_stage where import_id=current_setting('hardening.import_id')::uuid)<>2 then raise exception 'Failed import lost staging rows'; end if;
 end;
end;
$test$;
reset role;
create policy sr_issue_records_editor_insert on public.sr_issue_records for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

do $test$
begin
 if (select prosecdef from pg_proc where oid='public.finalize_sr_issue_import(uuid)'::regprocedure) then raise exception 'Finalizer still SECURITY DEFINER'; end if;
 if has_function_privilege('anon','public.finalize_sr_issue_import(uuid)','EXECUTE') then raise exception 'Anonymous execute grant remains'; end if;
 if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm' and n.nspname='extensions') then raise exception 'Extension not relocated'; end if;
 if to_regclass('public.idx_erp_pr_headers_created_at') is not null then raise exception 'Duplicate index remains'; end if;
 if to_regclass('public.tasks_user_id_idx') is null then raise exception 'Foreign key index missing'; end if;
 raise notice 'HARDENING_ACCESS_TESTS_PASSED';
end;
$test$;

rollback;

