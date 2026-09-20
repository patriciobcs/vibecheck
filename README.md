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

*VibeCheck is under development.*

## Specifications

See [specs/README.md](specs/README.md) for the workflow specifications, shared contracts, and change policy.

## Running locally

```bash
docker compose up -d
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
npm run worker
```

Set `ALLOW_LOCAL_TARGETS=true` for localhost demo targets. Set a non-empty
`DEV_API_KEY` in `.env` before running the seed; the seed refuses to run when
it is missing, and the same key authenticates the UI. Run the worker in a
second terminal. Database-backed tests require `DATABASE_URL`.
Set `DISCOVERY_PROVIDER=devin` and `DEVIN_API_KEY` to use the Devin provider.
VC-04 defaults to fixture repair, validation, and preview adapters:
`REPAIR_PROVIDER=fixture`, `VALIDATOR=fixture`, and `PREVIEW_PROVIDER=fixture`.
The fixture repair pipeline creates no branches, pull requests, or deployments.
Set `REPAIR_PROVIDER=devin` only when Devin credentials and an authorized
repository are configured. Independent checks remain platform-owned.

The fixture discovery provider returns clearly labelled sample output from the
VC-07 demo target. It is not agent inference or human research evidence.

## VC-03 evidence analysis

The fixture evidence source is selected with `EVIDENCE_SOURCE=fixture` and uses
the simulated session `sample_session_capture_ideas`. Analysis reads semantic
events and transcript text only; media references are passed as references and
the Devin provider is not told that it watched recordings. GitHub issue
publication uses a GitHub App installation token when `GITHUB_APP_ID` and
`GITHUB_APP_PRIVATE_KEY` are configured; the PEM may contain `\n`-escaped
newlines. `GITHUB_ISSUES_TOKEN` remains a development/test fallback, and
`APP_BASE_URL` is used for dashboard links only when it is a public URL;
localhost, private hosts and an unset value omit the link. Set
`ISSUE_PUBLISHER=memory` for local in-process publication tests. Live GitHub
publication targets the configured GitHub binding. The VC-02 evidence source
will replace the fixture source when its owner API is available.

The VC-03 demo binds the seeded product to the plain-copy GitHub repository
`minasrc/excalidraw-demo`, configured by `DEMO_TARGET_REPO_OWNER` and
`DEMO_TARGET_REPO_NAME`. It is not a fork, so the upstream Excalidraw issue
tracker is never touched. Findings remain in the VibeCheck dashboard and
sanitized issues are published only to that demo repository. A `local` binding
is the no-GitHub path and records `github_disconnected` while retaining the
finding. The local clone at `/Users/devin/repos/excalidraw` remains the source
for future VC-04 work.

## VC-04 repair pipeline

Findings from `draft_pr` and `prototype_and_retest` studies enqueue one
tenant-scoped `RepairRun` per finding. The durable worker persists each state
transition, validates candidate paths with the selected validator, and records
checks, draft PRs, and previews. `issues_only` findings stop after issue
publication and never enqueue repair work. Fixture adapters are explicitly
simulated and are intended for local tests and the repair workflow skeleton;
they do not claim a code change, human evidence, or a deployed application.
