# Production Simplix PR item-line sync

The standalone PR-line sync uses the confirmed production GraphQL operation `purchaseRequisitionLines`. It reads requested quantities, product IDs, unit prices, line amounts and currency codes, then upserts records into **public.erp_pr_line_items** by PR number + line identifier.

This is a separate dataset. It does **not** change the existing PR header/receipt sync, `procurement_records`, tracker imports, or presentation calculations. Requested quantity and PR-line amount do **not** establish actual goods received or product-receipt value.

## Pilot: Windows laptop with portable Node.js

Save both `scripts/sync-simplix-pr-lines.mjs` and `scripts/run-simplix-pr-lines.bat` to the existing `scripts` folder. Your existing `node_modules` and `portable-node` folders remain unchanged.

Double-click `run-simplix-pr-lines.bat`. Without arguments, it runs **only PR104021**. Enter a fresh authorized production Simplix bearer token and your SRD Warehouse System portal email/password privately when asked.

It shows number of PR item lines saved. We can then verify via Supabase:

```sql
select purch_req_id, item_code, requested_qty, unit_price, line_amount, currency_code, synced_at
from public.erp_pr_line_items where purch_req_id='PR104021'
order by line_key;
```

### Additional opt-in modes

From the repository root using the existing Node executable, run:

```
scripts\run-simplix-pr-lines.bat --dry-run --pr=PR104021
scripts\run-simplix-pr-lines.bat --limit=25 --year=2026
scripts\run-simplix-pr-lines.bat --limit=500 --year=2026
```

The pilot requires the Supabase email/password because the command uses RLS and editor permissions. The test token is kept in memory; never share tokens or paste them into ChatGPT. Do not run bulk mode until the pilot is verified.

Important limitations:
- An empty result could mean no lines or authorization filtering; verify before treating it as a zero-line PR.
- PR lines are paginated in groups of 100 and capped at 5,000 per PR. If the cap is reached, that PR is skipped rather than silently truncating data.
- Lines removed from ERP are not automatically deleted in Supabase; data is upserted idempotently and tagged with `synced_at`.
- This operation does not return PO line quantities or actual goods-received values.
- No scheduled, background, or automatic sync is configured yet. This is a manually run, authenticated module.
