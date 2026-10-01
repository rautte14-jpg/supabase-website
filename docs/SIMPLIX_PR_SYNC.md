# Simplix PR Sync (Local Prototype)

This tool synchronizes PR header/status data from the Simplix GraphQL API into the SRD Warehouse Supabase database.

## What it does

- Uses your current Simplix bearer token only in memory.
- Logs into the SRD portal with your normal portal account.
- Reads PRs from the Simplix `GetPRs` GraphQL operation.
- Follows cursor pagination until all matching PRs are collected.
- Upserts them into `public.erp_pr_headers`.
- Does not overwrite the existing line-level PR/PO import data.

## Requirements

- Node.js 18 or newer.
- You must already have access to Simplix.
- Your SRD portal account must be an `admin` or `editor`.

## Run it

From the project folder:

```powershell
npm install
npm run sync:simplix-prs
```

The tool will ask for:

1. Your current Simplix bearer token.
2. Your SRD portal email.
3. Your SRD portal password.

The Simplix token is not saved to disk or committed to GitHub.

By default it pulls only site `EDD`.

## Dry-run test

Use this first if you want to verify the Simplix connection without writing anything to Supabase:

```powershell
npm run sync:simplix-prs -- --dry-run --max-pages=1
```

## Optional arguments

```text
--site=EDD
--site=
--search=PR101499
--page-size=100
--max-pages=1
--dry-run
```

Examples:

Pull one test page for EDD:

```powershell
npm run sync:simplix-prs -- --dry-run --site=EDD --max-pages=1
```

Search a specific PR:

```powershell
npm run sync:simplix-prs -- --search=PR101499 --max-pages=1
```

Pull all sites:

```powershell
npm run sync:simplix-prs -- --site=
```

## Where to get the Simplix token

While logged into Simplix:

1. Press F12.
2. Open **Network**.
3. Select the `graphql` request with operation `GetPRs`.
4. Open **Headers**.
5. Under **Request Headers**, find `Authorization: Bearer ...`.
6. Copy the bearer value only when you are about to run the local sync.

Treat the bearer token like a password. Do not paste it into chat, source code, GitHub, screenshots, or shared documents.

## Important limitation

This is a local prototype. Simplix/Microsoft tokens expire. When the token expires, run the tool again with a fresh token.

A fully unattended production sync would require an approved Microsoft/Entra service identity.
