# Atomic source-file uploads

Covers PRF, PR, PO, MTR, MRN, pending payments and inventory transactions. Stock/ageing and SR issue uploads retain their existing transactional importers.

The browser first declares a private upload manifest, then uploads indexed batches without changing live records. The finalizer verifies complete contiguous rows, converts every row to its destination type, checks source scope/payment uniqueness and verifies that no newer upload has replaced this source. It replaces the selected dataset and writes source history in the same transaction. A failure at any point rolls back live data and history together.

Manifests and staged payloads are isolated to their creator through RLS; active editor/admin membership is required. Functions use invoker privileges. Parent row locks prevent late batches racing finalization or cancellation. A source-specific advisory lock serializes replacements. Committed manifests and a unique history reference make retries safe after a lost response. Failed batches settle before cancellation; an uncertain finalization outcome is reported as uncertain, not as guaranteed failure. Only the uploader's abandoned, uncommitted stages older than seven days are removed when they next begin an upload.

Finalization/cancellation have a function-specific 60-second REST timeout; global and role timeouts are unchanged. See https://supabase.com/docs/guides/database/postgres/timeouts. Files must be complete exports for the selected source. The source picker and file input are disabled while uploading. A refresh failure after a successful commit is reported as a saved update with a refresh problem.

Validation before application:
- 14 Node regression tests and production build pass, including failed batches, lost responses and unknown commit outcomes.
- The full SQL migration plus `supabase/tests/atomic_file_uploads.sql` passes under authenticated editor/viewer/other-editor and anonymous roles, ending with the intentional `ATOMIC_UPLOAD_PREFLIGHT_PASSED_ROLLED_BACK` exception. It tests all seven sources, unchanged sibling sources, typed validation, missing batches, cross-source rows, audit failure rollback, stale-upload rejection, private staging and idempotent finalization.
- A separate rollback-only test stages and finalizes all 23,683 existing inventory-transaction rows. Business-content fingerprints match. Database staging took 5,133 ms and finalization 5,338 ms in this run; these timings exclude browser/network transfer and are not a future performance guarantee.
- No ERP values or upload-history rows were committed by tests. Rolled-back identity allocations can leave harmless internal ID gaps.

Before application: procurement 3,145 rows; material 15,667; pending payments 44; transactions 23,683 with quantity sum -11,201.38 and cost sum 5,402,118.64; source history 38 rows. Apply the schema migration before deploying the frontend, compare these totals and run Supabase advisors after application.

Recovery: revert the frontend first if needed; retain the additive upload schema/history links until no new frontend uses them. Never run the old delete-first importer as a way to recover an interrupted upload. Investigate history and the committed manifest to distinguish a lost response from a failed transaction.
