-- Existing Supabase project schema for Excel PR/PO item mappings.
-- Run once on a new environment; already applied in the SRD Supabase project.
create table if not exists public.erp_po_excel_batches (
  id uuid primary key,
  source_file text not null,
  source_row_count integer not null check (source_row_count >= 0),
  status text not null default 'staging' check(status in ('staging','complete')),
  uploaded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table if not exists public.erp_po_excel_rows (
  batch_id uuid not null references public.erp_po_excel_batches(id) on delete cascade,
  source_row integer not null check (source_row >= 3),
  pr_no text,
  po_no text,
  item_code text not null,
  item_description text,
  source_qty numeric,
  received_qty numeric,
  balance_qty numeric,
  excel_received_date text,
  unit text,
  supplier text,
  excel_delivery_status text,
  excel_po_status text,
  source_raw jsonb,
  primary key (batch_id,source_row)
);
create index if not exists erp_po_excel_rows_pr_idx on public.erp_po_excel_rows(batch_id,pr_no,item_code);
create index if not exists erp_po_excel_rows_po_idx on public.erp_po_excel_rows(batch_id,po_no);
create index if not exists erp_po_excel_batches_latest_idx on public.erp_po_excel_batches(completed_at desc) where status='complete';

alter table public.erp_po_excel_batches enable row level security;
alter table public.erp_po_excel_rows enable row level security;
revoke all on public.erp_po_excel_batches,public.erp_po_excel_rows from anon,authenticated;
grant select,insert,update on public.erp_po_excel_batches to authenticated;
grant select,insert on public.erp_po_excel_rows to authenticated;

drop policy if exists po_excel_batches_read on public.erp_po_excel_batches;
create policy po_excel_batches_read on public.erp_po_excel_batches for select to authenticated
  using (auth.uid() is not null and (status='complete' or uploaded_by=auth.uid()));
drop policy if exists po_excel_batches_insert on public.erp_po_excel_batches;
create policy po_excel_batches_insert on public.erp_po_excel_batches for insert to authenticated
  with check(uploaded_by=auth.uid() and status='staging');
drop policy if exists po_excel_batches_update on public.erp_po_excel_batches;
create policy po_excel_batches_update on public.erp_po_excel_batches for update to authenticated
  using(uploaded_by=auth.uid() and status='staging')
  with check(uploaded_by=auth.uid() and status in ('staging','complete'));
drop policy if exists po_excel_rows_read on public.erp_po_excel_rows;
create policy po_excel_rows_read on public.erp_po_excel_rows for select to authenticated
  using(exists(select 1 from public.erp_po_excel_batches b where b.id=batch_id and (b.status='complete' or b.uploaded_by=auth.uid())));
drop policy if exists po_excel_rows_insert on public.erp_po_excel_rows;
create policy po_excel_rows_insert on public.erp_po_excel_rows for insert to authenticated
  with check(exists(select 1 from public.erp_po_excel_batches b where b.id=batch_id and b.uploaded_by=auth.uid() and b.status='staging'));

create or replace function public.complete_po_excel_batch(p_batch uuid)
returns integer language plpgsql security invoker set search_path = public
as $$
declare n integer; expected integer;
begin
  select source_row_count into expected
    from public.erp_po_excel_batches
    where id=p_batch and uploaded_by=auth.uid() and status='staging' for update;
  if not found then raise exception 'Batch is not available for completion'; end if;
  select count(*) into n from public.erp_po_excel_rows where batch_id=p_batch;
  if n <> expected then raise exception 'Incomplete Excel import: expected %, found %',expected,n; end if;
  update public.erp_po_excel_batches set status='complete',completed_at=now() where id=p_batch;
  return n;
end $$;
revoke all on function public.complete_po_excel_batch(uuid) from public,anon;
grant execute on function public.complete_po_excel_batch(uuid) to authenticated;

-- Safe upgrade for existing imports; reupload the workbook to populate this field.
alter table public.erp_po_excel_rows add column if not exists excel_received_date text;
