# Simplix production PR-line probe (read-only)

This optional diagnostic tests whether the authenticated **production** Simplix API returns item-level lines for a single PR.

## Run

From the repository folder in a terminal where Node.js is available:

```sh
npm run test:simplix-pr-lines -- --pr=PR104021
```

Or, for portable Node on Windows, from the repo folder:

```powershell
& "C:\path\to\node.exe" .\scripts\test-simplix-pr-lines.mjs --pr=PR104021
```

It prompts for your existing authorized Simplix bearer token **without echoing it**. You may alternatively supply `SIMPLIX_BEARER_TOKEN` as an environment variable in your own terminal; never commit, screenshot, log, or share tokens.

This command performs one read-only GraphQL request. It does **not** upload data, change the regular ERP sync, modify Supabase, or write output files.

If it succeeds, it displays PR item number, description, requested quantity, price, line amount, currency, and status. This does **not** establish actual product-receipt quantities or received values. An HTTP 401 / GraphQL `UNAUTHENTICATED` means the token is missing/invalid; a 403 / `FORBIDDEN` means the authorization is insufficient. Do not try to bypass authorization; ask the authorized integration owner.

## Next stage (not enabled)

After a successful authorized test and source field validation, a separate production sync implementation can store item-level lines in a dedicated table, reconcile with receipt events, and preserve existing warehouse reporting during the transition.
