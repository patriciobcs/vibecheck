# VibeCheck

**Real people. Honest feedback. Tested improvements.**

VibeCheck helps founders and product teams discover where users struggle—and turn those findings into working design alternatives.

## How it works

1. **Connect your app.** Add the embedded library and connect your repository.
2. **Identify what to test.** The UX research agent uses product events, feedback, and release context to propose focused studies.
3. **Bring in real people.** Invite your users or friends, or recruit through the testing marketplace.
4. **Capture the evidence.** Record sessions, transcribe feedback, and connect findings to actual interactions.
5. **Build and retest.** Devin creates an alternative, independent checks verify functionality, and fresh testers try the preview.

## Who it’s for

- Solo founders who need their first testers.
- Startups that want continuous UX research.
- Product teams testing with existing users or external participants.

## MVP scope

A connected web app, recorded task-based testing, evidence-backed findings, and an automated code-change-to-preview loop.

Changes run in isolated test environments. Human retesting evaluates usability; automated checks verify functionality.

## Development

```bash
pnpm install
pnpm db:start            # local Supabase (Postgres 54332, API 54331, Studio 54333)
cp .env.example apps/web/.env.local   # fill Vonage + SLNG values; local Supabase keys from `supabase status`
pnpm db:migrate && pnpm db:seed       # applies migrations, seeds a labeled sample study
pnpm dev                 # http://localhost:3000
pnpm worker              # archive fetch, transcription, monitoring scans, Jev evaluations, Devin jobs (separate terminal; restart after pulling)
pnpm check && pnpm test  # Biome + `next typegen` + tsc, unit/integration tests (isolated vibecheck_test database;
#   .env.test carries dummy non-secret values so this works from a clean checkout; CI runs the same)
pnpm test:e2e            # Playwright; starts its own dev server on :3100
E2E_BASE_URL=http://localhost:3000 pnpm test:e2e   # or reuse a running `pnpm dev` (stop `pnpm worker` first:
#   the browser tests drain jobs inline by type and stub the evaluation; a live worker would race them)
LIVE_PROVIDERS=1 E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/live-session.spec.ts
#   ^ simulated full session against real Vonage + SLNG: fake mic plays e2e/fixtures/speech.wav,
#     waits for the archive callback (needs `pnpm tunnel`) and asserts the transcript text
LIVE_PROVIDERS=1 E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/live-monitoring.spec.ts
#   ^ real Jev screening of a help request on the instrumented Excalidraw clone (needs JEV_API_KEY, worker, :3200)
#     Devin detector authoring: POST /api/owner/products/:id/detectors {"mode":"generate","provider":"devin",...}
pnpm db:reset-sample     # clears assignments on the sample studies so they recruit again
```

### Excalidraw demo target

The participant dialog runs inside the product page through the SDK. A local Excalidraw clone
(`../excalidraw`, branch `vibecheck-demo`) carries the script tag:

```bash
cd ../excalidraw && yarn install
# .env.development.local: VITE_APP_PORT=3200 and VITE_APP_VIBECHECK_KEY=<excalidraw key from pnpm db:seed>
yarn --cwd ./excalidraw-app vite --port 3200
```

Open http://localhost:3200. After a few seconds the invitation toast appears; "See the task" opens the
dialog over the canvas. Direct links and marketplace claims land on the product page with the
assignment handed off in a URL fragment, which the SDK consumes.

Sign in with the seed owner email (`SEED_OWNER_EMAIL`) and open the link from `/dev/inbox`.

The Vonage archive callback must reach the dev server from the internet. `pnpm tunnel` (requires `cloudflared`) opens a quick tunnel, writes `PUBLIC_WEBHOOK_BASE_URL` into `.env.local`, and, when `VONAGE_API_KEY`/`VONAGE_API_SECRET` are set, updates the application's archive-status webhook address for you. Enable the signature secret once in the Vonage dashboard and paste it into `VONAGE_ARCHIVE_SIGNATURE_SECRET`; quick-tunnel hostnames change on every restart, but the secret does not.

*VibeCheck is under development.*

## Passive monitoring (VC-02/03 continuous discovery)

Products can enable passive semantic telemetry (off by default) at `/products/:id/monitoring`. The SDK
collects allowlisted journey events only when the host reports a granted collection permission
(`data-collection-permission="granted"` on the script tag, or `VibeCheck.setCollectionPermission`), and
emits them with `VibeCheck.track(type, payload)`. Deterministic triggers build bounded windows that Jev
screens (`JEV_API_KEY`); results become research candidates the owner can dismiss or turn into neutral
task proposals through discovery. Run `pnpm worker` for scans, sweeps and evaluations.

## Specifications

See [specs/README.md](specs/README.md) for the workflow specifications, shared contracts, and change policy.

## Discovery (VC-01)

Discovery runs through a provider adapter: `fixture` returns labeled sample proposals for local
development and tests; `devin` starts a Devin analysis session (`DEVIN_API_KEY`, `DISCOVERY_PROVIDER=devin`).
A remote agent cannot reach `localhost`, so Devin discovery needs a publicly reachable target URL.
Set `ALLOW_LOCAL_TARGETS=true` to accept loopback product URLs in development. Programmatic access to
the product/discovery/study endpoints uses `Authorization: Bearer <api key>` (hashed at rest, seeded
from `DEV_API_KEY`); the owner UI uses the signed-in session.
