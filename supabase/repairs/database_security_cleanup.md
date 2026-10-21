# Database security and policy cleanup

This change keeps portal members' read access and editors' write access while removing redundant policy evaluation. It does not change ERP quantities or require a frontend change.

- Replace the editor ALL policy on 12 portal tables with INSERT, UPDATE and DELETE policies. Existing read predicates remain intact. Restrict the remaining PUBLIC portal/staging policies to the authenticated role.
- Make `finalize_sr_issue_import(uuid)` SECURITY INVOKER. Replace its elevated TRUNCATE with a transaction-protected DELETE subject to editor RLS, serialize finalization, and verify inserted row count. Revoke anonymous/PUBLIC execution and explicitly grant authenticated execution; the existing active admin/editor check remains.
- Retain `erp_pr_headers_created_at_idx` and remove its exact duplicate `idx_erp_pr_headers_created_at`. Add the missing `tasks(user_id)` foreign-key index. Retain unused indexes because lack of recent usage alone does not establish that they are unnecessary.
- Move the relocatable pg_trgm extension into the existing extensions schema. Existing trigram indexes keep their operator-class OIDs. Inspection found no application SQL/plpgsql functions calling public-qualified trigram functions.

Preflight: the entire migration and `supabase/tests/database_security_cleanup.sql` were run in one transaction that ended with the intentional `HARDENING_PREFLIGHT_PASSED_ROLLED_BACK` exception. Assertions passed for viewer reads on all 12 tables, viewer write denial, nonmember read denial, anonymous RPC denial, editor update/import/staging cleanup, invoker security, extension placement, indexes and representative RPCs. A forced insert-policy failure verified that the SR replacement and stage cleanup roll back together. The test portal-access rows and SR replacements were rolled back. Identity sequences can advance during rollback tests; business record IDs are not reset by the new importer.

Before-change reference totals: 45,915 SR issue rows, quantity sum 5,531,398.79; 6,056 stock rows; 4,799 PR headers. After applying, verify these are unchanged and rerun both Supabase advisors.

Leaked-password protection remains unavailable: the connected organization is on the Free plan and Supabase documents this feature as Pro-plan-or-higher. No subscription or billing change is included. See https://supabase.com/docs/guides/auth/password-security.

Recovery: use prior Supabase migration definitions if a rollback is required; restore the exact original policy predicates/roles, original SR finalizer and duplicate index definition. Extension relocation is reversible with ALTER EXTENSION pg_trgm SET SCHEMA public. Avoid removing the new foreign-key index unless a concrete regression is established.
