# Seamless UX

[![CI](https://github.com/patriciobcs/vibecheck/actions/workflows/ci.yml/badge.svg)](https://github.com/patriciobcs/vibecheck/actions/workflows/ci.yml)

**Your users are already telling you what is broken.**

Seamless UX helps founders and product teams discover where users struggle, and turns those findings into working design alternatives — backed by real usability sessions, not just analytics.

> **Status:** under active development. See [Project status](#project-status) for what is implemented, stubbed, or unverified.

## Table of contents

- [How it works](#how-it-works)
- [Who it's for](#who-its-for)
- [Project status](#project-status)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Demo mode and the recorded demo](#demo-mode-and-the-recorded-demo)
- [Excalidraw demo target](#excalidraw-demo-target)
- [Passive monitoring (VC-02/03 continuous discovery)](#passive-monitoring-vc-0203-continuous-discovery)
- [Discovery (VC-01)](#discovery-vc-01)
- [GitHub issue publication (VC-03)](#github-issue-publication-vc-03)
- [Repair pipeline (VC-04)](#repair-pipeline-vc-04)
- [Specifications](#specifications)
- [Contributing](#contributing)
- [License](#license)

## How it works

1. **Connect your app.** Add the embedded library and connect your repository.
2. **Identify what to test.** The UX research agent uses product events, feedback, and release context to propose focused studies.
3. **Bring in real people.** Invite your users or friends, or recruit through the testing marketplace.
4. **Capture the evidence.** Record sessions, transcribe feedback, and connect findings to actual interactions.
5. **Build and retest.** Devin creates an alternative, independent checks verify functionality, and fresh testers try the preview.

## Who it's for

- Solo founders who need their first testers.
- Startups that want continuous UX research.
- Product teams testing with existing users or external participants.

## Project status

**MVP scope:** a connected web app, recorded task-based testing, evidence-backed findings, and an automated code-change-to-preview loop. Changes run in isolated test environments; human retesting evaluates usability while automated checks verify functionality. Payments, complex reputation, generalized repo setup, native app capture, production rollout, and enterprise identity are explicitly deferred — see [specs/README.md](specs/README.md#mvp-and-exclusions).

Verified vs. unverified pieces, honestly:

- **VC-02 (test delivery and recording)** is implemented and verified end-to-end against real Vonage and SLNG with a simulated session (`LIVE_PROVIDERS=1`).
- **VC-01 (discovery)** output is stand-in sample data seeded with provenance `sample`; the `fixture` provider is what local development and CI exercise.
- **Jev screening** is implemented and tested with stubbed answers; real-call accuracy is unverified until `JEV_API_KEY` is supplied.
- **Devin** integration (planning, analysis, implementation) is unverified end-to-end pending a real account/API check.

See [Open decisions](specs/README.md#open-decisions) in the specs for the current list of unresolved items.

## Architecture

Monorepo managed with pnpm workspaces:

| Path | Description |
| --- | --- |
| `apps/web` | Next.js app: owner dashboard, API routes, auth, and the durable job worker. |
| `packages/contracts` | Zod schemas shared by every producer/consumer (events, study plans, embed messages). |
| `packages/sdk` | Embedded script that product pages load to run the participant dialog and passive telemetry. |
| `specs` | Workflow specifications, shared contracts, and product decisions (see [Specifications](#specifications)). |
| `supabase` | Local Supabase config and migrations (Postgres, Storage). |

**Stack:** Next.js, Supabase (Postgres + Storage), Drizzle ORM, Better Auth, Biome (lint/format), Vitest (unit/integration), Playwright (e2e). External providers: Vonage (session media), SLNG (speech-to-text), Devin (planning/analysis/implementation), Jev (semantic screening).

## Getting started

### Prerequisites

- Node.js >= 22
- pnpm 12.4.2 (see `packageManager` in `package.json`)
- [Supabase CLI](https://supabase.com/docs/guides/cli) for the local Postgres/Storage stack
- `cloudflared`, only if you need `pnpm tunnel` for provider webhooks

### Quickstart

```bash
pnpm install
pnpm db:start            # local Supabase (Postgres 54332, API 54331, Studio 54333)
cp .env.example apps/web/.env.local   # fill Vonage + SLNG values; local Supabase keys from `supabase status`
pnpm db:migrate && pnpm db:seed       # applies migrations, seeds a labeled sample study
pnpm dev                 # http://localhost:3000
pnpm worker              # archive fetch, transcription, monitoring scans, Jev evaluations, Devin jobs (separate terminal; restart after pulling)
```

`pnpm db:reset-sample` clears assignments on the sample studies so they recruit again.

## Testing

```bash
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
```

Live demo: open `/products/product_excalidraw_local/monitoring/live` in a second window; it polls persisted state every second (waiting state → session tabs → signals, screening, Jev, candidates).

CI (`.github/workflows/ci.yml`) runs `pnpm check`, `pnpm test`, and a production build without provider secrets on every push to `main` and every pull request.

## Demo mode and the recorded demo

Set `DEMO_MODE=true` in `apps/web/.env.local` (ignored in production). The app then hides developer copy (seed hints, SDK snippets, the test inbox), labels sample material "Demo data", and the landing and sign-in pages offer "Enter the demo", a one-click sign-in as the seed owner.

`pnpm demo:record` (in `apps/web`) records the two-window demo as `demo-recordings/demo.mp4`: the visitor on the Excalidraw clone on the left, the owner's live analysis on the right. It drives the real pipeline (fake microphone → passive screening with Jev → audio-only study → transcript) and composes the halves with ffmpeg, mixing in synthesized voices (macOS `say`, see `apps/web/scripts/voice`): the participant's think-aloud goes through the fake microphone and ends up in the real transcript, narrator clips are placed at the recorded phase times. Needs `pnpm dev` with demo mode, `pnpm tunnel`, the clone on :3200, and real provider keys.

## Excalidraw demo target

The participant dialog runs inside the product page through the SDK. A local Excalidraw clone (`../excalidraw`, branch `vibecheck-demo`) carries the script tag:

```bash
cd ../excalidraw && yarn install
# .env.development.local: VITE_APP_PORT=3200 and VITE_APP_VIBECHECK_KEY=<excalidraw key from pnpm db:seed>
yarn --cwd ./excalidraw-app vite --port 3200
```

Open http://localhost:3200. After a few seconds the invitation toast appears; "See the task" opens the dialog over the canvas. Direct links and marketplace claims land on the product page with the assignment handed off in a URL fragment, which the SDK consumes.

Sign in with the seed owner email (`SEED_OWNER_EMAIL`) and open the link from `/dev/inbox`.

The Vonage archive callback must reach the dev server from the internet. `pnpm tunnel` (requires `cloudflared`) opens a quick tunnel, writes `PUBLIC_WEBHOOK_BASE_URL` into `.env.local`, and, when `VONAGE_API_KEY`/`VONAGE_API_SECRET` are set, updates the application's archive-status webhook address for you. Enable the signature secret once in the Vonage dashboard and paste it into `VONAGE_ARCHIVE_SIGNATURE_SECRET`; quick-tunnel hostnames change on every restart, but the secret does not.

## Passive monitoring (VC-02/03 continuous discovery)

Products can enable passive semantic telemetry (off by default) at `/products/:id/monitoring`. The SDK collects allowlisted journey events only when the host reports a granted collection permission (`data-collection-permission="granted"` on the script tag, or `VibeCheck.setCollectionPermission`), and emits them with `VibeCheck.track(type, payload)`. Deterministic triggers build bounded windows that Jev screens (`JEV_API_KEY`); results become research candidates the owner can dismiss or turn into neutral task proposals through discovery. Run `pnpm worker` for scans, sweeps, and evaluations.

## Discovery (VC-01)

Founder onboarding asks for project name and a GitHub repository link. A live app/preview URL can be added later from the project page and is required before discovery or studies. A saved repository link does not authorize GitHub access; issues and code changes stay off. Apply migrations with `pnpm db:migrate` before running the updated app (`0012_github_onboarding.sql` makes the live URL nullable).

Discovery runs through a provider adapter: `fixture` returns labeled sample proposals for local development and tests; `devin` starts a Devin analysis session (`DEVIN_API_KEY`, `DISCOVERY_PROVIDER=devin`). A remote agent cannot reach `localhost`, so Devin discovery needs a publicly reachable target URL. Set `ALLOW_LOCAL_TARGETS=true` to accept loopback product URLs in development. Programmatic access to the product/discovery/study endpoints uses `Authorization: Bearer <api key>` (hashed at rest, seeded from `DEV_API_KEY`); the owner UI uses the signed-in session.

## Account sign-in

Local development uses `EMAIL_MODE=test_inbox`: links appear in `/dev/inbox`; no email is sent. To enable email sign-in on a deployment, set `EMAIL_MODE=resend`, create a sending key at [Resend API keys](https://resend.com/api-keys), and set `EMAIL_FROM` to an address on a [verified domain](https://resend.com/domains). Store the key in deployment secrets. Without configured delivery, production hides the email form and rejects email-link requests. `DEMO_MODE=true` adds an explicit shared-demo alternative, which sends no real email and grants access only to the seeded demo accounts. Already-signed-in users continue directly to their requested page.

## GitHub issue publication (VC-03)

Analysis can publish sanitized findings through a GitHub App installation. Set `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` for bot-authored issues; `GITHUB_ISSUES_TOKEN` is a development/test fallback. Set `APP_BASE_URL` to a public deployment URL for the dashboard link to appear in issue bodies; localhost, `.local`, loopback, and private-network URLs are omitted.

## Repair pipeline (VC-04)

Repair runs default to deterministic local adapters. Set `REPAIR_PROVIDER`, `VALIDATOR`, and `PREVIEW_PROVIDER` to `fixture` for local development; the Devin repair adapter requires `REPAIR_PROVIDER=devin` and the existing Devin credentials.

## Specifications

See [specs/README.md](specs/README.md) for the workflow specifications (VC-01 through VC-07), shared event/entity contracts, and the policy for keeping specs in sync with implementation.

## Contributing

See [AGENTS.md](AGENTS.md) for repository conventions and the required process for changes that affect product behavior, interfaces, data models, or scope: update the relevant spec in `specs/` in the same change as the implementation, record unresolved choices under Open decisions, and reference the affected spec IDs in the commit or PR description.

## License

No public license is granted; this repository is private (`"private": true` in `package.json`) while Seamless UX is under development.
