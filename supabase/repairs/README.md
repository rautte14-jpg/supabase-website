# Inventory and report reconciliation

Status: production migration applied successfully on 21 October 2026. Summary values and a rollback-only import of all 6,025 active rows under the authenticated editor role passed. Supabase remains set to Always ask at the user’s request.

`inventory_report_reconciliation.sql` was applied once using the Supabase migration API. `inventory_repair_backup_constraints.sql` adds a primary key and RLS to the private repair backup. Do not reapply these completed repairs. It retains all stock rows and raw exports, backs up pre-repair stock in an unexposed audit schema, repairs normalized quantities/costs/values, marks current-snapshot membership, and makes subsequent stock imports transactional under the existing editor RLS policies.

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

Validation: `node --test tests/*.test.mjs`; `npm run build`; `git diff --check`. Production queries verified matching summary totals, PR102176 (30 requested / 20 received / 10 balance), PR103085 (no ERP lines), and preservation of all 6,056 stock rows. A 6,025-row authenticated import completed successfully inside an explicitly rolled-back transaction. Security advisors show no new findings; the backup-table primary-key advisory is addressed by the follow-up migration. Deployment and signed-in browser results are tracked in PR #5. Do not call a test stock import against production without an enclosing rollback.

If rollback is needed, retain the audit backup, restore prior view definitions from Supabase migration history, and restore only the repaired numeric stock fields from the audit table after checking no later import would be overwritten. Do not drop archived stock rows.
