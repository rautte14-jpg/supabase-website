-- Every upload is isolated by its creator. Only active portal editors may stage or commit.
create table public.file_imports (
 import_id uuid primary key,
 owner_id uuid not null default auth.uid(),
 source_type text not null check(source_type in ('PRF','PR','PO','MTR','MRN','PENDING_PAYMENTS','TRANSACTIONS')),
 expected_rows integer not null check(expected_rows between 1 and 500000),
 original_rows integer not null check(original_rows>=expected_rows),
 file_name text not null,
 source_date date,
 base_update_id bigint,
 status text not null default 'staging' check(status in ('staging','committed')),
 committed_rows integer,
 created_at timestamptz not null default now(),
 committed_at timestamptz,
 check ((status='staging' and committed_rows is null and committed_at is null)
     or (status='committed' and committed_rows=expected_rows and committed_at is not null))
);
create index file_imports_owner_created_idx on public.file_imports(owner_id,created_at desc);
create table public.file_import_rows (
 import_id uuid not null references public.file_imports(import_id) on delete cascade,
 row_index integer not null check(row_index>=0),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 primary key(import_id,row_index)
);
alter table public.source_updates add column file_import_id uuid unique references public.file_imports(import_id);
alter table public.file_imports enable row level security;
alter table public.file_import_rows enable row level security;
grant select,insert,update,delete on public.file_imports,public.file_import_rows to authenticated;
revoke all on public.file_imports,public.file_import_rows from anon;

create policy file_imports_select on public.file_imports for select to authenticated using (owner_id=(select auth.uid()) and exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>'email') and a.active and a.role in ('admin','editor')));
create policy file_imports_insert on public.file_imports for insert to authenticated with check ((owner_id=(select auth.uid()) and exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>'email') and a.active and a.role in ('admin','editor'))) and status='staging');
create policy file_imports_update on public.file_imports for update to authenticated using (owner_id=(select auth.uid()) and exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>'email') and a.active and a.role in ('admin','editor'))) with check (owner_id=(select auth.uid()) and exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>'email') and a.active and a.role in ('admin','editor')));
create policy file_imports_delete on public.file_imports for delete to authenticated using ((owner_id=(select auth.uid()) and exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>'email') and a.active and a.role in ('admin','editor'))) and status='staging');
create policy file_import_rows_select on public.file_import_rows for select to authenticated using (exists(select 1 from public.file_imports f where f.import_id=file_import_rows.import_id and f.owner_id=(select auth.uid())));
create policy file_import_rows_insert on public.file_import_rows for insert to authenticated with check (exists(select 1 from public.file_imports f where f.import_id=file_import_rows.import_id and f.owner_id=(select auth.uid())) and exists(select 1 from public.file_imports f where f.import_id=file_import_rows.import_id and f.status='staging'));
create policy file_import_rows_update on public.file_import_rows for update to authenticated using (exists(select 1 from public.file_imports f where f.import_id=file_import_rows.import_id and f.owner_id=(select auth.uid())) and exists(select 1 from public.file_imports f where f.import_id=file_import_rows.import_id and f.status='staging')) with check (exists(select 1 from public.file_imports f where f.import_id=file_import_rows.import_id and f.owner_id=(select auth.uid())) and exists(select 1 from public.file_imports f where f.import_id=file_import_rows.import_id and f.status='staging'));
create policy file_import_rows_delete on public.file_import_rows for delete to authenticated using (exists(select 1 from public.file_imports f where f.import_id=file_import_rows.import_id and f.owner_id=(select auth.uid())));

-- A shared parent-row lock prevents a late batch from racing finalization/cancellation.
create function public.guard_file_import_row() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_op='UPDATE' and (new.import_id<>old.import_id or new.row_index<>old.row_index) then
   raise exception 'Upload row identity cannot change';
 end if;
 perform 1 from public.file_imports f
 where f.import_id=new.import_id and f.owner_id=(select auth.uid()) and f.status='staging'
 for share;
 if not found then raise exception 'Upload is no longer accepting rows'; end if;
 return new;
end;
$$;
create trigger file_import_rows_guard before insert or update on public.file_import_rows
for each row execute function public.guard_file_import_row();

create function public.begin_file_import(
 p_import_id uuid,p_source text,p_expected_rows integer,p_original_rows integer,
 p_file_name text,p_source_date date default null
) returns jsonb language plpgsql set search_path=public as $$
declare f public.file_imports%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>'email') and a.active and a.role in ('admin','editor')) then
   raise exception 'Not authorized to upload source data';
 end if;
 if p_source not in ('PRF','PR','PO','MTR','MRN','PENDING_PAYMENTS','TRANSACTIONS')
 or p_expected_rows is null or p_expected_rows<1 or p_expected_rows>500000
 or p_original_rows is null or p_original_rows<p_expected_rows or p_import_id is null then
   raise exception 'Invalid upload source or row count';
 end if;
 -- Discard only this editor's abandoned, uncommitted temporary uploads.
 delete from public.file_imports where owner_id=auth.uid() and status='staging'
 and created_at<now()-interval '7 days' and import_id<>p_import_id;
 insert into public.file_imports(import_id,owner_id,source_type,expected_rows,original_rows,file_name,source_date,base_update_id)
 values(p_import_id,auth.uid(),p_source,p_expected_rows,p_original_rows,coalesce(p_file_name,''),p_source_date,
 (select max(id) from public.source_updates where source_type=p_source))
 on conflict(import_id) do nothing;
 select * into f from public.file_imports where import_id=p_import_id for update;
 if not found then raise exception 'Upload is not available to this user'; end if;
 if f.owner_id<>auth.uid() or f.source_type<>p_source or f.expected_rows<>p_expected_rows
 or f.original_rows<>p_original_rows or f.file_name<>coalesce(p_file_name,'') or f.source_date is distinct from p_source_date then
   raise exception 'Upload metadata does not match the original request';
 end if;
 return jsonb_build_object('status',f.status,'row_count',f.committed_rows);
end;
$$;

create function public.finalize_file_import(p_import_id uuid)
returns bigint language plpgsql set search_path=public set statement_timeout='60s' as $$
declare f public.file_imports%rowtype; actual bigint; first_index integer; last_index integer; inserted bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.portal_access a where lower(a.email)=lower((select auth.jwt())->>'email') and a.active and a.role in ('admin','editor')) then
   raise exception 'Not authorized to upload source data';
 end if;
 select * into f from public.file_imports where import_id=p_import_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Staged upload not found; upload the file again'; end if;
 if f.status='committed' then
   if not exists(select 1 from public.source_updates where file_import_id=p_import_id and new_count=f.committed_rows) then
     raise exception 'Upload confirmation is inconsistent; review upload history';
   end if;
   return f.committed_rows;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('portal-file-upload:'||f.source_type,0));
 if f.base_update_id is distinct from (select max(id) from public.source_updates where source_type=f.source_type) then
   raise exception 'This source changed while your file was uploading. Review the latest data and upload again';
 end if;
 select count(*),min(row_index),max(row_index) into actual,first_index,last_index
 from public.file_import_rows where import_id=p_import_id;
 if actual<>f.expected_rows or first_index<>0 or last_index<>f.expected_rows-1 then
   raise exception 'Upload is incomplete: expected % rows, found %',f.expected_rows,actual;
 end if;

 -- Validate every typed row before touching live data, then replace only the selected source.
 case f.source_type
 when 'PRF','PR','PO' then
   if exists(select 1 from public.file_import_rows s where s.import_id=p_import_id and (s.payload->>'source_type' is distinct from f.source_type)) then raise exception 'Staged rows do not match source %',f.source_type; end if;
   perform r from public.file_import_rows s cross join lateral jsonb_populate_record(null::public.procurement_records,s.payload-'id'-'created_at'-'updated_at') r where s.import_id=p_import_id;
   delete from public.procurement_records where source_type=f.source_type;
   insert into public.procurement_records("prf_no","pr_no","po_no","section","workshop","vessel","asset","sr_wo","priority","supplier","item_code","item_description","unit","qty_requested","qty_ordered","qty_received","balance_qty","currency","amount","pr_date","po_date","required_date","expected_delivery","payment_status","delivery_status","status","remarks","source_type","source_updated_at","raw_source","linked_pr_mtr","work_order_type","purchase_from","purchase_type","processed_date","requested_by","modified_by","cancel_reject_reason","latest_updates")
   select r."prf_no",r."pr_no",r."po_no",r."section",r."workshop",r."vessel",r."asset",r."sr_wo",r."priority",r."supplier",r."item_code",r."item_description",r."unit",r."qty_requested",r."qty_ordered",r."qty_received",r."balance_qty",r."currency",r."amount",r."pr_date",r."po_date",r."required_date",r."expected_delivery",r."payment_status",r."delivery_status",r."status",r."remarks",r."source_type",coalesce(r."source_updated_at",now()),coalesce(r."raw_source",'{}'::jsonb),r."linked_pr_mtr",r."work_order_type",r."purchase_from",r."purchase_type",r."processed_date",r."requested_by",r."modified_by",r."cancel_reject_reason",r."latest_updates"
   from public.file_import_rows s cross join lateral jsonb_populate_record(null::public.procurement_records,s.payload-'id'-'created_at'-'updated_at') r where s.import_id=p_import_id order by s.row_index;
   get diagnostics inserted=row_count;
 when 'MTR','MRN' then
   if exists(select 1 from public.file_import_rows s where s.import_id=p_import_id and (s.payload->>'document_type' is distinct from f.source_type)) then raise exception 'Staged rows do not match source %',f.source_type; end if;
   perform r from public.file_import_rows s cross join lateral jsonb_populate_record(null::public.material_records,s.payload-'id'-'created_at'-'updated_at') r where s.import_id=p_import_id;
   delete from public.material_records where document_type=f.source_type;
   insert into public.material_records("document_type","document_no","document_date","workshop","vessel","asset","sr_wo","item_code","item_description","unit","requested_qty","transferred_qty","issued_qty","remaining_qty","status","remarks","source_updated_at","raw_source","prf_no","approved_date","from_warehouse","on_hand_srd","delivery_status_erp","line_no","priority")
   select r."document_type",r."document_no",r."document_date",r."workshop",r."vessel",r."asset",r."sr_wo",r."item_code",r."item_description",r."unit",r."requested_qty",r."transferred_qty",r."issued_qty",r."remaining_qty",r."status",r."remarks",coalesce(r."source_updated_at",now()),coalesce(r."raw_source",'{}'::jsonb),r."prf_no",r."approved_date",r."from_warehouse",r."on_hand_srd",r."delivery_status_erp",r."line_no",r."priority"
   from public.file_import_rows s cross join lateral jsonb_populate_record(null::public.material_records,s.payload-'id'-'created_at'-'updated_at') r where s.import_id=p_import_id order by s.row_index;
   get diagnostics inserted=row_count;
 when 'PENDING_PAYMENTS' then
   if exists(select 1 from public.file_import_rows s where s.import_id=p_import_id and (nullif(btrim(coalesce(s.payload->>'po_no','')),'') is null)) then raise exception 'Staged rows do not match source %',f.source_type; end if;
   perform r from public.file_import_rows s cross join lateral jsonb_populate_record(null::public.pending_payment_records,s.payload-'id'-'created_at'-'updated_at') r where s.import_id=p_import_id;
   if (select count(distinct payload->>'po_no') from public.file_import_rows where import_id=p_import_id)<>actual then raise exception 'Duplicate PO numbers in payment upload'; end if;
   delete from public.pending_payment_records where true;
   insert into public.pending_payment_records("po_no","po_date","supplier","status","priority","po_value","raw_source","source_updated_at")
   select r."po_no",r."po_date",r."supplier",r."status",r."priority",r."po_value",coalesce(r."raw_source",'{}'::jsonb),coalesce(r."source_updated_at",now())
   from public.file_import_rows s cross join lateral jsonb_populate_record(null::public.pending_payment_records,s.payload-'id'-'created_at'-'updated_at') r where s.import_id=p_import_id order by s.row_index;
   get diagnostics inserted=row_count;
 when 'TRANSACTIONS' then
   perform r from public.file_import_rows s cross join lateral jsonb_populate_record(null::public.inventory_transactions,s.payload-'id'-'created_at'-'updated_at') r where s.import_id=p_import_id;
   delete from public.inventory_transactions where true;
   insert into public.inventory_transactions("physical_date","transaction_type","item_code","item_description","quantity","unit","cost","po_no","sales_order","journal_no","delivery_name","vessel","sr_wo","status","raw_source")
   select r."physical_date",r."transaction_type",r."item_code",r."item_description",r."quantity",r."unit",r."cost",r."po_no",r."sales_order",r."journal_no",r."delivery_name",r."vessel",r."sr_wo",r."status",coalesce(r."raw_source",'{}'::jsonb)
   from public.file_import_rows s cross join lateral jsonb_populate_record(null::public.inventory_transactions,s.payload-'id'-'created_at'-'updated_at') r where s.import_id=p_import_id order by s.row_index;
   get diagnostics inserted=row_count;

 else raise exception 'Unsupported source type';
 end case;
 if inserted<>f.expected_rows then raise exception 'Upload row count mismatch'; end if;
 -- Audit history and live rows commit together; a history failure rolls back the replacement.
 insert into public.source_updates(source_type,file_name,source_date,row_count,new_count,changed_count,unchanged_count,unmatched_count,imported_by,file_import_id)
 values(f.source_type,f.file_name,f.source_date,f.original_rows,inserted,0,
 greatest(0,f.original_rows-inserted),greatest(0,f.original_rows-inserted),
 lower((select auth.jwt())->>'email'),p_import_id);
 delete from public.file_import_rows where import_id=p_import_id;
 update public.file_imports set status='committed',committed_rows=inserted,committed_at=now() where import_id=p_import_id;
 return inserted;
end;
$$;

create function public.cancel_file_import(p_import_id uuid)
returns jsonb language plpgsql set search_path=public set statement_timeout='60s' as $$
declare f public.file_imports%rowtype;
begin
 select * into f from public.file_imports where import_id=p_import_id and owner_id=auth.uid() for update;
 if not found then return jsonb_build_object('status','missing'); end if;
 if f.status='committed' then return jsonb_build_object('status','committed','row_count',f.committed_rows); end if;
 delete from public.file_imports where import_id=p_import_id and owner_id=auth.uid() and status='staging';
 return jsonb_build_object('status','cancelled');
end;
$$;
revoke all on function public.guard_file_import_row() from public,anon;
revoke all on function public.begin_file_import(uuid,text,integer,integer,text,date) from public,anon;
revoke all on function public.finalize_file_import(uuid) from public,anon;
revoke all on function public.cancel_file_import(uuid) from public,anon;
grant execute on function public.guard_file_import_row() to authenticated;
grant execute on function public.begin_file_import(uuid,text,integer,integer,text,date) to authenticated;
grant execute on function public.finalize_file_import(uuid) to authenticated;
grant execute on function public.cancel_file_import(uuid) to authenticated;

