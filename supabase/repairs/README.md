# Inventory and report reconciliation

Status: prepared; production migration was declined by the approval system and has **not** run. Do not deploy the new stock importer until the migration succeeds.

Apply `inventory_report_reconciliation.sql` once using the Supabase migration API, then deploy the associated frontend commit. It retains all stock rows and raw exports, backs up pre-repair stock in an unexposed audit schema, repairs normalized quantities/costs/values, marks current-snapshot membership, and makes subsequent stock imports transactional under the existing editor RLS policies.

The initial membership repair checks the newest completed ageing snapshot's item count before changing any stock data. It aborts on a mismatch rather than guessing after a newer upload. Views retain invoker security. No procurement quantities are overwritten or inferred from receipt-document counts. Report fallback uses ERP receipt status only when an explicit quantity is absent; an explicit zero remains authoritative.

Checks on 21 October 2026 before migration (read-only queries):

| Metric | Corrected source result |
| --- | ---: |
| Current ageing items | 6,025 |
| Archived rows retained | 31 |
| Current on-hand quantity | 344,873.94 |
| Current on-hand value (MVR) | 38,712,069.48 |
| PRF register rows | 777 |
| MRNs, 1–21 October | 281 |
| Synced PR submissions, 1–21 October | 61 |
| October receipt quantity using the shared ERP-status fallback | 25,399 |

Receipt difference: PR102147 has no numeric receipt quantity and has ERP delivery status `Received All` for 100 units. The previous SQL report excluded those units while the frontend included them. The same fallback is now used in both places.

Validation: `node --test tests/*.test.mjs`; `npm run build`; `git diff --check`. Production SQL execution, transaction/RLS behavior, performance, and browser verification remain pending approval of the migration. After applying it, verify the summary views agree, compare PR102176 (30 requested / 20 received / 10 balance; Part Received) and PR103085 (no ERP lines; quantities unavailable), exercise an import in a rollback-only database test, rerun Supabase advisors, deploy, and check the signed-in screens. Do not call a test stock import against production without an enclosing rollback.

If rollback is needed, retain the audit backup, restore prior view definitions from Supabase migration history, and restore only the repaired numeric stock fields from the audit table after checking no later import would be overwritten. Do not drop archived stock rows.
