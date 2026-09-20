# Supabase + GitHub + Cloudflare Pages starter

A React/Vite starter with Supabase Auth, Postgres, Row Level Security and Realtime.

## 1. Supabase

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. In Project Settings / API, copy your Project URL and publishable key.
4. Copy `.env.example` to `.env.local` and fill in the values.
5. Never put a Supabase `service_role` / secret key in browser code.

## 2. Run locally

```bash
npm install
npm run dev
```

## 3. Cloudflare Pages

1. Cloudflare Dashboard -> Workers & Pages -> Create application -> Pages.
2. Import this GitHub repository.
3. Production branch: `main`
4. Build command: `npm run build`
5. Build output directory: `dist`
6. Add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
7. Deploy.

Browser -> Cloudflare Pages -> Supabase


<!-- Cloudflare rebuild trigger after API token setup -->
