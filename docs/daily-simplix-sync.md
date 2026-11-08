# Daily production Simplix synchronization — SRD Warehouse System

## One command, both ERP syncs

Run this from the project root in Windows CMD (or double-click the BAT):

```bat
scripts\run-simplix-daily.bat
```

The launcher finds the already installed portable Node.js and runs **two stages sequentially**:

1. `scripts/sync-simplix-prs.mjs` — all PR headers and **every** 2026 PR detail: approvals, RFQs, PO workflows, PO status/references and goods-receiving references/dates.
2. `scripts/sync-simplix-pr-lines.mjs` — **every** 2026 PR item line: item code/description, requested quantities, prices and PR line statuses.

**Daily runs use full refresh by default** because statuses, purchase orders and receipts can change on older PRs at any time. This is more API work than an incremental sync; expect the output to process all eligible PRs. An optional `--incremental` mode limits this when you only need a faster catch-up.

The requested quantity, price and line amount are requisition quantities and values, **not** PO goods-received quantities or receipt values. This process does not change Excel PO-item mappings or receipt quantity data.

## Authentication and failures

The command requests the production Simplix bearer token and the SRD portal email/password once, then passes them to child Node processes **in memory** (not in files or command arguments). When a Simplix bearer token expires during a stage, the existing script prompts for a new one and shares it with the other stage. Do not paste tokens into issue trackers or screenshots.

If PR details fail, stage 2 does not run and the launcher returns a failure status. If PR item lines fail, the output distinguishes the two stages. Successfully committed PR detail or line records are preserved in Supabase; rerun to retry a failure. The console stays open until a key is pressed.

## Optional commands

```bat
:: Run both syncs for a different year
scripts\run-simplix-daily.bat --year=2025

:: Optional faster catch-up: skip PR details that are not due and
:: only refresh recent item lines when their stale threshold is reached
scripts\run-simplix-daily.bat --year=2026 --incremental

:: Customize the limited incremental refresh window
scripts\run-simplix-daily.bat --year=2026 --incremental --line-recent-days=90 --line-stale-hours=20
```

A full historical refresh **is the default daily behavior** for the selected year, so all statuses and item changes can be captured. Once an ERP year is over, its PRs are not included unless explicitly selected. A run that is interrupted preserves records already saved, but because full-refresh mode intentionally checks every PR again, the next full run also revisits already-synced records.

This remains **manual daily execution** because the Simplix bearer token and portal credentials are interactive. No unattended Windows scheduled task is installed or implied.

## Updating local scripts

To use the new launcher on the existing portable-Node laptop, copy the latest files from GitHub main:

```bat
curl.exe -fL "https://raw.githubusercontent.com/rautte14-jpg/supabase-website/main/scripts/sync-simplix-daily.mjs" -o "scripts\sync-simplix-daily.mjs"
curl.exe -fL "https://raw.githubusercontent.com/rautte14-jpg/supabase-website/main/scripts/run-simplix-daily.bat" -o "scripts\run-simplix-daily.bat"
curl.exe -fL "https://raw.githubusercontent.com/rautte14-jpg/supabase-website/main/scripts/sync-simplix-prs.mjs" -o "scripts\sync-simplix-prs.mjs"
curl.exe -fL "https://raw.githubusercontent.com/rautte14-jpg/supabase-website/main/scripts/simplix-pr-details.mjs" -o "scripts\simplix-pr-details.mjs"
curl.exe -fL "https://raw.githubusercontent.com/rautte14-jpg/supabase-website/main/scripts/sync-simplix-pr-lines.mjs" -o "scripts\sync-simplix-pr-lines.mjs"
```

Run the CMD in the project root, not inside the scripts folder.
