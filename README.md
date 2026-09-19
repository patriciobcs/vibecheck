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
pnpm worker              # archive fetch + transcription jobs (separate terminal)
pnpm check && pnpm test  # Biome + typecheck, unit/integration tests (isolated vibecheck_test database)
pnpm test:e2e            # Playwright; starts its own dev server on :3100
E2E_BASE_URL=http://localhost:3000 pnpm test:e2e   # or reuse a running `pnpm dev`
LIVE_PROVIDERS=1 E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/live-session.spec.ts
#   ^ simulated full session against real Vonage + SLNG: fake mic plays e2e/fixtures/speech.wav,
#     waits for the archive callback (needs `pnpm tunnel`) and asserts the transcript text
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

## Specifications

See [specs/README.md](specs/README.md) for the workflow specifications, shared contracts, and change policy.
