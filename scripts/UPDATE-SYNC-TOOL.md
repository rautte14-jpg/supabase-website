# Updating the Windows PR sync tool

1. Close the old sync window.
2. Download and extract this repository's ZIP.
3. Copy these four files from its `scripts` folder into the `scripts` folder of your existing tool, replacing files when asked:
   - `run-simplix-sync.bat`
   - `sync-simplix-prs.mjs`
   - `simplix-pr-details.mjs`
   - `simplix-http.mjs` (new)
4. Keep your existing portable-node, node_modules and environment configuration.
5. Run `scripts/run-simplix-sync.bat` as usual.

Temporary timeouts and HTTP 408/429/500/502/503/504 responses get up to four attempts with backoff. Requests time out after 45 seconds. A persistently unavailable PR is deferred while other PRs continue, then retried in a final pass. Unfinished PRs are listed explicitly and the program exits with a failure status instead of claiming completion. Authentication and database errors still stop the run; these are not silently skipped.

Each successful PR is saved separately. On restart, the tool reads saved sync timestamps and prioritizes missing details. Counters restart for each batch; this does not delete saved progress. Recently synced records are skipped until their refresh interval expires (6 hours for active PRs, 168 hours for historical PRs).

The terminal stays open after the run. Type `exit` to close it. Tokens are kept in memory only; enter a fresh token on a new run or when the ERP explicitly rejects authentication. Never send tokens or passwords in chat.
