-- Preserve the existing member-read/editor-write predicates while removing duplicate SELECT evaluation.
set local lock_timeout = '5s';

drop policy "Portal editors write notes" on public."case_notes";
create policy "case_notes_editor_insert" on public."case_notes" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "case_notes_editor_update" on public."case_notes" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "case_notes_editor_delete" on public."case_notes" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

drop policy "portal editors can manage erp pr details" on public."erp_pr_details";
create policy "erp_pr_details_editor_insert" on public."erp_pr_details" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access pa
  WHERE ((lower(pa.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND (pa.active = true) AND (pa.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "erp_pr_details_editor_update" on public."erp_pr_details" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access pa
  WHERE ((lower(pa.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND (pa.active = true) AND (pa.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access pa
  WHERE ((lower(pa.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND (pa.active = true) AND (pa.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "erp_pr_details_editor_delete" on public."erp_pr_details" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access pa
  WHERE ((lower(pa.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND (pa.active = true) AND (pa.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

drop policy "portal editors can manage erp pr headers" on public."erp_pr_headers";
create policy "erp_pr_headers_editor_insert" on public."erp_pr_headers" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access pa
  WHERE ((lower(pa.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND (pa.active = true) AND (pa.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "erp_pr_headers_editor_update" on public."erp_pr_headers" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access pa
  WHERE ((lower(pa.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND (pa.active = true) AND (pa.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access pa
  WHERE ((lower(pa.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND (pa.active = true) AND (pa.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "erp_pr_headers_editor_delete" on public."erp_pr_headers" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access pa
  WHERE ((lower(pa.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND (pa.active = true) AND (pa.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

drop policy "Portal editors write transactions" on public."inventory_transactions";
create policy "inventory_transactions_editor_insert" on public."inventory_transactions" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "inventory_transactions_editor_update" on public."inventory_transactions" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "inventory_transactions_editor_delete" on public."inventory_transactions" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

drop policy "Portal editors write lld" on public."lld_updates";
create policy "lld_updates_editor_insert" on public."lld_updates" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "lld_updates_editor_update" on public."lld_updates" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "lld_updates_editor_delete" on public."lld_updates" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

drop policy "Portal editors write material" on public."material_records";
create policy "material_records_editor_insert" on public."material_records" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "material_records_editor_update" on public."material_records" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "material_records_editor_delete" on public."material_records" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

drop policy "Portal editors write pending payments" on public."pending_payment_records";
create policy "pending_payment_records_editor_insert" on public."pending_payment_records" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "pending_payment_records_editor_update" on public."pending_payment_records" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "pending_payment_records_editor_delete" on public."pending_payment_records" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
alter policy "Portal members read pending payments" on public."pending_payment_records" to authenticated;

drop policy "Portal editors write procurement" on public."procurement_records";
create policy "procurement_records_editor_insert" on public."procurement_records" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "procurement_records_editor_update" on public."procurement_records" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "procurement_records_editor_delete" on public."procurement_records" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

drop policy "Portal editors write source updates" on public."source_updates";
create policy "source_updates_editor_insert" on public."source_updates" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "source_updates_editor_update" on public."source_updates" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "source_updates_editor_delete" on public."source_updates" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

drop policy "Portal editors write SR issues" on public."sr_issue_records";
create policy "sr_issue_records_editor_insert" on public."sr_issue_records" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "sr_issue_records_editor_update" on public."sr_issue_records" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "sr_issue_records_editor_delete" on public."sr_issue_records" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
alter policy "Portal members read SR issues" on public."sr_issue_records" to authenticated;

drop policy "Portal editors write stock" on public."stock_items";
create policy "stock_items_editor_insert" on public."stock_items" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "stock_items_editor_update" on public."stock_items" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "stock_items_editor_delete" on public."stock_items" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

drop policy "Portal editors write snapshots" on public."weekly_snapshots";
create policy "weekly_snapshots_editor_insert" on public."weekly_snapshots" for insert to authenticated with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "weekly_snapshots_editor_update" on public."weekly_snapshots" for update to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text]))))) with check (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));
create policy "weekly_snapshots_editor_delete" on public."weekly_snapshots" for delete to authenticated using (EXISTS ( SELECT 1
   FROM portal_access a
  WHERE ((lower(a.email) = lower((( SELECT auth.jwt() AS jwt) ->> 'email'::text))) AND a.active AND (a.role = ANY (ARRAY['admin'::text, 'editor'::text])))));

alter policy "Portal editors stage SR issues" on public.sr_issue_import_stage to authenticated;

CREATE OR REPLACE FUNCTION public.finalize_sr_issue_import(p_import_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
    declare
      v_count bigint;
      v_inserted bigint;
      v_email text := lower((select auth.jwt())->>'email');
    begin
      if not exists (
        select 1
        from public.portal_access a
        where lower(a.email)=v_email
          and a.active
          and a.role in ('admin','editor')
      ) then
        raise exception 'Not authorized to replace SR issue data';
      end if;

      perform pg_advisory_xact_lock(730215);

      select count(*) into v_count
      from public.sr_issue_import_stage
      where import_id=p_import_id;

      if v_count <= 0 then
        raise exception 'No staged SR issue rows found';
      end if;

      delete from public.sr_issue_records where true;

      insert into public.sr_issue_records (
        project_id,
        requested_receipt_date,
        sales_order,
        line_number,
        item_code,
        warehouse,
        item_description,
        location,
        quantity,
        unit,
        customer_reference,
        customer_requisition,
        delivery_name,
        line_status,
        issue_state,
        created_by,
        service_order,
        category,
        workshop,
        sr_no,
        wo_no,
        mrn_no,
        source_updated_at,
        raw_source
      )
      select
        project_id,
        requested_receipt_date,
        sales_order,
        line_number,
        item_code,
        warehouse,
        item_description,
        location,
        quantity,
        unit,
        customer_reference,
        customer_requisition,
        delivery_name,
        line_status,
        issue_state,
        created_by,
        service_order,
        category,
        workshop,
        sr_no,
        wo_no,
        mrn_no,
        source_updated_at,
        raw_source
      from public.sr_issue_import_stage
      where import_id=p_import_id
      order by stage_id;

      get diagnostics v_inserted = row_count;
      if v_inserted <> v_count then raise exception 'SR issue import count mismatch'; end if;

      delete from public.sr_issue_import_stage
      where import_id=p_import_id;

      return v_count;
    end;
    $function$;

revoke all on function public.finalize_sr_issue_import(uuid) from public, anon;
grant execute on function public.finalize_sr_issue_import(uuid) to authenticated;

-- Both existing created_at indexes have the same btree keys/order and are not constraints.
drop index public.idx_erp_pr_headers_created_at;
create index tasks_user_id_idx on public.tasks(user_id);

-- Existing trigram indexes retain their operator-class OIDs after relocation.
alter extension pg_trgm set schema extensions;

