-- Apply the upload schema first. This test deliberately ends in an exception to roll back every test change.

-- Transaction-only regression tests; synthetic users and dataset replacements never commit.
select set_config('upload.editor_id',gen_random_uuid()::text,true);
select set_config('upload.other_id',gen_random_uuid()::text,true);
insert into public.portal_access(email,role,active) values
 ('upload-editor-test@invalid.example','editor',true),
 ('upload-other-test@invalid.example','editor',true),
 ('upload-viewer-test@invalid.example','viewer',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('upload.editor_id'),'email','upload-editor-test@invalid.example','role','authenticated')::text,true);
set local role authenticated;
do $test$
declare source text; table_name text; scope text; fixtures jsonb; one jsonb; v_test_id uuid; n bigint; before_other bigint; before_count bigint; before_history bigint; fail_id uuid; old_id uuid; new_id uuid; before_signature numeric; after_signature numeric;
begin
 foreach source in array array['PRF','PR','PO','MTR','MRN','PENDING_PAYMENTS','TRANSACTIONS'] loop
  table_name := case when source in ('PRF','PR','PO') then 'procurement_records' when source in ('MTR','MRN') then 'material_records' when source='PENDING_PAYMENTS' then 'pending_payment_records' else 'inventory_transactions' end;
  scope := case when source in ('PRF','PR','PO') then format('source_type=%L',source) when source in ('MTR','MRN') then format('document_type=%L',source) else 'true' end;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)-''id''-''created_at''-''updated_at''),''[]''::jsonb) from (select * from public.%I where %s limit 2) x',table_name,scope) into fixtures;
  while jsonb_array_length(fixtures)<2 loop
    one := case when source in ('PRF','PR','PO') then jsonb_build_object('source_type',source,'pr_no','UPLOAD-TEST-'||jsonb_array_length(fixtures),'prf_no','UPLOAD-TEST','po_no','UPLOAD-PO')
      when source in ('MTR','MRN') then jsonb_build_object('document_type',source,'document_no','UPLOAD-TEST-'||jsonb_array_length(fixtures))
      when source='PENDING_PAYMENTS' then jsonb_build_object('po_no','UPLOAD-TEST-'||jsonb_array_length(fixtures))
      else jsonb_build_object('item_code','UPLOAD-TEST','quantity',1) end;
    fixtures := fixtures || jsonb_build_array(one);
  end loop;
  execute format('select count(*) from public.%I where not (%s)',table_name,scope) into before_other;
  v_test_id:=gen_random_uuid();
  perform public.begin_file_import(v_test_id,source,2,2,'test.csv',null);
  insert into public.file_import_rows(import_id,row_index,payload)
  select v_test_id,(ordinality-1)::int,value from jsonb_array_elements(fixtures) with ordinality;
  n := public.finalize_file_import(v_test_id);
  if n<>2 then raise exception 'Wrong imported count for %',source; end if;
  execute format('select count(*) from public.%I where %s',table_name,scope) into n;
  if n<>2 then raise exception 'Wrong live count for %',source; end if;
  execute format('select count(*) from public.%I where not (%s)',table_name,scope) into n;
  if n<>before_other then raise exception 'Other source changed for %',source; end if;
  if (select count(*) from public.source_updates u where u.file_import_id=v_test_id)<>1 then raise exception 'History did not commit for %',source; end if;
  if (select count(*) from public.file_import_rows r where r.import_id=v_test_id)<>0 then raise exception 'Staging rows remain for %',source; end if;
  -- A repeated finalization/lost-response recovery must not replace data or duplicate history.
  if public.finalize_file_import(v_test_id)<>2 then raise exception 'Idempotency failed for %',source; end if;
  if (public.cancel_file_import(v_test_id)->>'status')<>'committed' then raise exception 'Committed cancellation unsafe for %',source; end if;
  if (select count(*) from public.source_updates u where u.file_import_id=v_test_id)<>1 then raise exception 'Duplicate history for %',source; end if;
  begin
    insert into public.file_import_rows(import_id,row_index,payload) values(v_test_id,0,fixtures->0);
    raise exception 'Late batch accepted';
  exception when raise_exception then
    if sqlerrm<>'Upload is no longer accepting rows' then raise; end if;
  end;
 end loop;
 -- Missing batch and malformed typed fields are rejected before data replacement.
 fail_id:=gen_random_uuid();
 perform public.begin_file_import(fail_id,'PR',2,2,'bad.csv',null);
 insert into public.file_import_rows values(fail_id,0,jsonb_build_object('source_type','PR','pr_no','TEST'));
 select count(*) into before_count from public.procurement_records where source_type='PR';
 select count(*) into before_history from public.source_updates;
 begin
   perform public.finalize_file_import(fail_id);
   raise exception 'Incomplete upload accepted';
 exception when raise_exception then
   if sqlerrm not like 'Upload is incomplete:%' then raise; end if;
 end;
 insert into public.file_import_rows values(fail_id,1,jsonb_build_object('source_type','PR','pr_date','bad-date'));
 begin
   perform public.finalize_file_import(fail_id);
   raise exception 'Invalid date accepted';
 exception when invalid_datetime_format or datetime_field_overflow then null;
 end;
 update public.file_import_rows set payload=jsonb_build_object('source_type','PO','pr_no','TEST') where file_import_rows.import_id=fail_id and row_index=1;
 begin
   perform public.finalize_file_import(fail_id);
   raise exception 'Wrong source accepted';
 exception when raise_exception then
   if sqlerrm not like 'Staged rows do not match source%' then raise; end if;
 end;
 if (select count(*) from public.procurement_records where source_type='PR')<>before_count or (select count(*) from public.source_updates)<>before_history then raise exception 'Failed upload changed live rows/history'; end if;
 perform public.cancel_file_import(fail_id);
 if exists(select 1 from public.file_imports f where f.import_id=fail_id) or exists(select 1 from public.file_import_rows r where r.import_id=fail_id) then raise exception 'Cancelled staging remains'; end if;

 -- A newer import wins; an older file must not silently overwrite it.
 old_id:=gen_random_uuid();new_id:=gen_random_uuid();
 perform public.begin_file_import(old_id,'PR',1,1,'old.csv',null);
 perform public.begin_file_import(new_id,'PR',1,1,'new.csv',null);
 insert into public.file_import_rows values(old_id,0,'{"source_type":"PR","pr_no":"OLDER"}');
 insert into public.file_import_rows values(new_id,0,'{"source_type":"PR","pr_no":"NEWER"}');
 perform public.finalize_file_import(new_id);
 begin
   perform public.finalize_file_import(old_id);
   raise exception 'Stale upload accepted';
 exception when raise_exception then
   if sqlerrm not like 'This source changed while your file was uploading.%' then raise; end if;
 end;
 if (select pr_no from public.procurement_records where source_type='PR')<>'NEWER' then raise exception 'Newer import lost'; end if;
 perform public.cancel_file_import(old_id);
 -- Prepare an owned upload for isolation and history-failure tests below.
 perform public.begin_file_import('00000000-0000-4000-8000-000000000101','PR',1,1,'history-failure.csv',null);
 insert into public.file_import_rows values('00000000-0000-4000-8000-000000000101',0,'{"source_type":"PR","pr_no":"MUST-ROLL-BACK"}');
end;
$test$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('upload.other_id'),'email','upload-other-test@invalid.example','role','authenticated')::text,true);
set local role authenticated;
do $test$
begin
 if exists(select 1 from public.file_imports) or exists(select 1 from public.file_import_rows) then raise exception 'Other editor can read staged uploads'; end if;
 if (public.cancel_file_import('00000000-0000-4000-8000-000000000101')->>'status')<>'missing' then raise exception 'Other editor can cancel upload'; end if;
 begin
   insert into public.file_import_rows values('00000000-0000-4000-8000-000000000101',1,'{}');
   raise exception 'Other editor can modify staging';
 exception when raise_exception or insufficient_privilege then
   if sqlstate='P0001' and sqlerrm<>'Upload is no longer accepting rows' then raise; end if;
 end;
end;
$test$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email','upload-viewer-test@invalid.example','role','authenticated')::text,true);
set local role authenticated;
do $test$
begin
 begin
   perform public.begin_file_import(gen_random_uuid(),'PR',1,1,'viewer.csv',null);
   raise exception 'Viewer upload allowed';
 exception when raise_exception then
   if sqlerrm<>'Not authorized to upload source data' then raise; end if;
 end;
 if exists(select 1 from public.file_imports) then raise exception 'Viewer can inspect private upload metadata'; end if;
end;
$test$;
reset role;

-- Force the audit INSERT to fail after replacement, proving both roll back together.
drop policy source_updates_editor_insert on public.source_updates;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('upload.editor_id'),'email','upload-editor-test@invalid.example','role','authenticated')::text,true);
set local role authenticated;
do $test$
begin
 begin
   perform public.finalize_file_import('00000000-0000-4000-8000-000000000101');
   raise exception 'Missing history permission did not fail';
 exception when insufficient_privilege then null;
 end;
 if (select pr_no from public.procurement_records where source_type='PR')<>'NEWER' then raise exception 'History failure lost live data'; end if;
 if (select status from public.file_imports where import_id='00000000-0000-4000-8000-000000000101')<>'staging' then raise exception 'Failed upload marked committed'; end if;
 if not exists(select 1 from public.file_import_rows where import_id='00000000-0000-4000-8000-000000000101') then raise exception 'History failure lost staging'; end if;
end;
$test$;
reset role;
create policy source_updates_editor_insert on public.source_updates for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

select set_config('request.jwt.claims','{}',true);
set local role anon;
do $test$
begin
 begin
  perform public.finalize_file_import(gen_random_uuid());
  raise exception 'Anonymous finalization allowed';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
reset role;
do $test$
begin raise exception 'ATOMIC_UPLOAD_PREFLIGHT_PASSED_ROLLED_BACK'; end;
$test$;

