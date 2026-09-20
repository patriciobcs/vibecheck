# Deploying the public demo

Two deployments: the VibeCheck app at `seamlessux.patriciobcs.com` (Vercel, Next.js) and the
instrumented Excalidraw clone at `excalidraw.patriciobcs.com` (Vercel, static Vite build). Both are
plain Vercel projects; nothing here needs a long-running server. Cloudflare Pages/Workers is the
fallback (notes at the end), but Vercel needs no adapter for Next 16.

## 1. Database and storage: a hosted Supabase project

1. Create a project at supabase.com (any region). Note the **database password**.
2. Project settings → Database → Connection string → **Transaction pooler** (port 6543). This is
   `DATABASE_URL`; keep `?sslmode=require`. The app already uses `prepare: false`, which the pooler needs.
3. Project settings → API: `SUPABASE_URL` (project URL) and `SUPABASE_SERVICE_ROLE_KEY`.
4. Storage needs no manual step: the seed creates the private `session-media` bucket (or
   `SUPABASE_STORAGE_BUCKET`) through the service role key.

Apply migrations and seed from your machine (the seed creates the demo tenant, the Excalidraw
product with its publishable key, the demo study, the owner, the tester and the storage bucket):

```sh
cd apps/web
cp .env.production.example .env.production.local   # fill in the Supabase values; the file is gitignored
pnpm db:migrate:prod && pnpm db:seed:prod          # prints the Excalidraw publishable key: keep it for step 3
```

`.env.local` stays your local development config; `.env.production.local` is only read by the two
`:prod` scripts and never by `pnpm dev`.

## 2. VibeCheck on Vercel

Create a Vercel project from this repository with **Root Directory** `apps/web` (keep "Include files
outside the root directory" on; it is a pnpm workspace). Framework preset: Next.js. Build command
`pnpm build`, install command `pnpm install --frozen-lockfile` (Vercel detects pnpm from the lockfile).

Environment variables (Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `PUBLIC_WEBHOOK_BASE_URL` | `https://seamlessux.patriciobcs.com` |
| `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | from step 1 |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` |
| `DEMO_MODE` | `true` (enables "Enter as product owner / tester"; also hides developer copy) |
| `SEED_OWNER_EMAIL`, `DEMO_TESTER_EMAIL` | the same values used in the seed |
| `EXCALIDRAW_DEMO_URL` | `https://excalidraw.patriciobcs.com/` |
| `INLINE_JOBS` | `true` (jobs run right after the request that queued them; there is no worker) |
| `CRON_SECRET` | `openssl rand -hex 32` (Vercel Cron sends it; also protects `/api/internal/drain`) |
| `VONAGE_APPLICATION_ID`, `VONAGE_PRIVATE_KEY_BASE64`, `VONAGE_ARCHIVE_SIGNATURE_SECRET` | from `.env.local` |
| `SLNG_API_KEY`, `JEV_API_KEY`, `DEVIN_API_KEY` (optional) | from `.env.local` |
| `EMAIL_MODE` | `test_inbox` (no email provider; demo sign-in never needs one) |

`apps/web/vercel.json` schedules `/api/internal/drain` once a day (the Hobby plan's cron limit): it
sweeps idle journeys, retries deferred evaluations and runs any job the inline path missed. Inline
execution handles the demo flow on its own; for a per-minute sweep either use `* * * * *` on the Pro
plan or point a free scheduler (cron-job.org) at
`GET https://seamlessux.patriciobcs.com/api/internal/drain` with `Authorization: Bearer <CRON_SECRET>`.

Archive callbacks are optional: after a recording stops, an `archive.reconcile` job asks Vonage for
the archive's status every few seconds (inside the same `after()` window) and queues the download as
soon as it is available; the live board's polling and the drain endpoint also nudge the queue. The
Vonage callback still works when it arrives (same dedupe key), it is just not required.

Function limits: inline jobs run inside the request's `after()` window (60 s on Hobby, 300 s on Pro).
Archive download + transcription of a short demo recording fits; a Devin discovery run does not and
stays for `pnpm worker` locally (the fixture provider is instant and is the demo default).

Domain (done for `patriciobcs.com`): in Cloudflare DNS add `CNAME vibecheck → cname.vercel-dns.com`
with the proxy **off** (DNS only), then add the domain to the project. Because the apex is not a
Vercel-owned domain, `vercel domains add` answers 403 `domain_not_owned`; use the project-domains API
instead, which returns a verification record:

```sh
curl -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/domains?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"seamlessux.patriciobcs.com"}'
```

Add the returned `vc-domain-verify=…` value as a TXT record at `_vercel` (one per subdomain; they
coexist), then `POST .../domains/<name>/verify`. TLS is issued once the CNAME is unproxied.

Point the Vonage archive callback at the deployment once (uses the account key/secret in `.env.local`):

```sh
cd apps/web && pnpm vonage:callback https://seamlessux.patriciobcs.com
```

## 3. Excalidraw clone on Vercel

The clone lives in `~/Projects/excalidraw` on branch `vibecheck-demo`. It has no remote yet: create a
repository (`gh repo create seamlessux/excalidraw-seamlessux --private --source . --push`, or push to
a fork) and import it into Vercel. `vercel.json` in the repo root already sets install/build/output
(`yarn install`, `yarn build:app`, `excalidraw-app/build`).

Environment variables (Production):

| Variable | Value |
|---|---|
| `VITE_APP_VIBECHECK_ORIGIN` | `https://seamlessux.patriciobcs.com` |
| `VITE_APP_VIBECHECK_KEY` | the `pk_excalidraw_…` key printed by the seed in step 1 |

Domain: same procedure as the app, with `CNAME excalidraw → cname.vercel-dns.com` (DNS only) and its
own `_vercel` TXT record. The seed already lists this origin as permitted for the product, so the SDK
toast, passive observation and the participant dialog work from it.

## 4. Check

- `https://seamlessux.patriciobcs.com/api/health` shows the configured providers.
- `https://seamlessux.patriciobcs.com/` → "Enter as product owner" lands on Products; "Enter as
  tester" lands on Studies. Both are seeded accounts; nobody types an email.
- `https://excalidraw.patriciobcs.com/` shows the study toast after a few seconds; the live console at
  `/products/product_excalidraw_local/monitoring/live` follows the session.

Both domains are live. A macOS resolver that cached the name before the record existed keeps failing
to resolve it while `dig` succeeds; `sudo dscacheutil -flushcache` fixes that locally.

## Cloudflare instead of Vercel

The clone is static and deploys to Cloudflare Pages unchanged (build `yarn build:app`, output
`excalidraw-app/build`). The Next app would need the OpenNext Cloudflare adapter and a Worker cron in
place of Vercel Cron; the code paths are the same (`INLINE_JOBS`, `/api/internal/drain`). Not set up.
