# Daily production Simplix synchronization — SRD Warehouse System

## One command, both ERP syncs

Run this from the project root in Windows CMD (or double-click the BAT):

```bat
scripts\run-simplix-daily.bat
```

The launcher finds the already installed portable Node.js and runs **two stages sequentially**:

1. `scripts/sync-simplix-prs.mjs` — new/updated PR headers and stale PR detail records: approvals, RFQs, PO workflows and references, goods-receiving references/dates.
2. `scripts/sync-simplix-pr-lines.mjs` — all new PR item lines and rechecks saved PR item lines from the most recent **120 days** if they were last synchronized **20+ hours** ago.

The requested quantity, price and line amount are requisition quantities and values, **not** PO goods-received quantities or receipt values. This process does not change Excel PO-item mappings or receipt quantity data.

## Authentication and failures

The command requests the production Simplix bearer token and the SRD portal email/password once, then passes them to child Node processes **in memory** (not in files or command arguments). When a Simplix bearer token expires during a stage, the existing script prompts for a new one and shares it with the other stage. Do not paste tokens into issue trackers or screenshots.

If PR details fail, stage 2 does not run and the launcher returns a failure status. If PR item lines fail, the output distinguishes the two stages. Successfully committed PR detail or line records are preserved in Supabase; rerun to retry a failure. The console stays open until a key is pressed.

## Optional commands

```bat
:: Run both syncs for a different year
scripts\run-simplix-daily.bat --year=2025

:: Occasionally force a full historical PR detail refresh
scripts\run-simplix-daily.bat --year=2026 --refresh-all-details

:: Occasionally force a full PR item-line refresh (more ERP requests)
scripts\run-simplix-daily.bat --year=2026 --refresh-all-lines

:: Change the daily recent item-line window/stale threshold
scripts\run-simplix-daily.bat --year=2026 --line-recent-days=90 --line-stale-hours=20
```

No daily historical full refresh is required. Once an ERP year is over, its PRs are not included unless explicitly selected.

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
