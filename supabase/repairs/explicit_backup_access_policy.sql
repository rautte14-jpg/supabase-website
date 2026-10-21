-- The repair backup is admin-only: no client role may read or modify its rows.
create policy stock_repair_backup_deny_clients
on warehouse_repair_audit.stock_before_numeric_repair_20261021
as restrictive for all to anon, authenticated
using (false) with check (false);

