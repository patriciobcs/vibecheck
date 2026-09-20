# VC-06 · Owner dashboard and durable orchestration

Status: Draft
Depends on: [shared contracts](README.md) and VC-01 through VC-05

## Goal

Give owners a coherent view of research and implementation progress, configurable autonomy, and access to evidence. The dashboard must explain real backend state, not merely play an animation of an ideal workflow.

## Information architecture

### Product overview

Show product URL, repository binding and connection health, experiments (studies) by stage, findings needing attention, open issues and draft PRs, the latest experiment summary and a Signals panel. Empty states give one clear next action: connect product, run discovery or publish an experiment. Avoid fabricated ROI, participation counts or generic honesty/UX scores; numbers come from persisted rows with denominators.

### Signals

Continuous activity tracking and its analysis by Jev are built by the spec-2 team. The dashboard receives their flags through `POST /api/products/:id/signals` (contract below), stores them as `Signal` rows and lists them per product with source, severity, semantic target and time. A signal is a hint, not a finding: it has no session evidence and is never published as an issue or fed to repair. "Propose an experiment from this signal" (feeding VC-01 discovery with the signal as a labeled input) is an open decision.

```json
{
  "schema_version": "1.0",
  "signal_id": "signal_example",
  "source": "jev",
  "title": "Toolbar: repeated hover without selection",
  "description": "Users hover the shape tools for more than 5s before selecting anything.",
  "severity": "medium",
  "semantic_target": "toolbar.shapes",
  "observed_sessions": 14,
  "window_start": "2026-09-19T00:00:00Z",
  "window_end": "2026-09-19T12:00:00Z",
  "evidence_ref": null
}
```

`severity` ∈ `low`, `medium`, `high`; `observed_sessions` is optional and displayed with the window as its denominator; `evidence_ref` is an opaque reference resolved through the sender, never a URL rendered in the UI. Replays with the same `signal_id` are ignored; the same `signal_id` with a later window updates the row.

### Proposed tests

Cards include participant-facing task, rationale/evidence, audience, duration and proposed success measure. Allow edit, select, publish, dismiss and view discovery provenance. Display an automatic-launch indicator only if that setting is enabled.

### Study detail

Use a clear timeline derived from persisted state: Proposed → Published → Collecting → Summarized → Issues → Draft PR (→ Preview). Stages after Summarized depend on the automation mode: `issues_only` ends successfully at Issues, `draft_pr` at Draft PR, `prototype_and_retest` at Preview (retesting is deferred, VC-05). A mode that stops early ends with a completed label, not an unfinished one. Each stage shows its count (participation funnel, eligible sessions, findings, issues, repair status) and the reason it is waiting (no sessions yet, analysis running, agent running, checks failed, blocked by permissions, paused).

### Evidence review

Synchronized recording player, transcript and event timeline with time-linked findings. Indicate missing channels, prompts/assistance, sample fixtures, recording pauses and redactions. Clicking a finding jumps to its cited range. Access to media is role-controlled and signed URLs expire.

### Findings and alternatives

Each finding separates observation, explanation hypothesis and proposed experiment. Show recurrence counts, uncertainty, GitHub issue mapping, variant previews and independent checks. Original/variant views show build identity and whether human evidence applies to the current commit.

### Settings

Repository/environment connection; owner-selected versus automatic studies; issues-only/draft-PR/retest mode; recruitment source and budget; capture channels; retention; invitation caps; maximum agent attempts/runtime/spend; allowed modification scope; global pause; delete/export data. Implemented first: the tenant-level **global pause** (`Tenant.pausedAt`, set through `POST /api/settings/pause` / `DELETE`), which the worker checks before claiming any job that performs external work (`discovery.run`, `analysis.run`, `publish_issue`, `repair.run`, `summary.generate`); paused jobs stay pending and the dashboard shows the paused banner. Every settings change writes an `AuditEvent`.

Roasty may explain a state in one sentence, but remains optional and never substitutes for accessible status text. No mascot chatter during a participant's task unless it is a logged neutral research prompt.

## Roles and tenant access

- Owner/admin: configure product and integrations, manage studies and members, view authorized evidence, pause jobs.
- Researcher: manage tasks/findings within granted products; cannot change repository credentials or tenant billing policy.
- Viewer: read-only authorized dashboard.
- Participant: only their assignments, consent, submissions and credit history; never other recordings or repository secrets.

Use backend authorization and row-level tenant boundaries; unguessable IDs alone are not access control. Audit settings, external side effects, manual overrides and access revocation. Avoid unnecessary personal attributes in agent context.

## Suggested architecture

Next.js application/API, Postgres (Drizzle ORM, schema in `src/db/schema.ts`, migrations in `drizzle/`) for tenancy and workflow records, private object storage for media, and a durable worker for long-running jobs. Provider adapters: Devin, GitHub, media, STT, email, preview deployment. GitHub publication uses an installed App identity with short-lived installation tokens when configured, with a development/test PAT fallback. The browser must not hold an API request open for a Devin session or a human assignment.

MVP durable worker is a separate process (`npm run worker`) backed by the `Job` table: claims use `SELECT … FOR UPDATE SKIP LOCKED`, a five-minute lease renewed by heartbeat, `attempts`/`maxAttempts` with exponential backoff on `nextRunAt`, and graceful shutdown on SIGINT/SIGTERM. Job payloads are schema-validated; unknown job types fail terminally. Do not build a complex workflow engine before the pipeline works. Every provider session/deployment ID is stored for reconciliation (`DiscoveryRun.providerSessionId`, `providerSessionUrl`).

Core tables (first slice implemented: `Signal`, `AuditEvent`, `ParticipationEvent`, `ExperimentSummary`, `Tenant`, `ApiKey`, `Product`, `DiscoveryRun`, `Proposal`, `Study`, `StudyPlanRevision`, `OutboxEvent`, `PublishRequest`, `Job`; tenant authentication is currently a hashed API key per tenant, memberships/roles come later): `tenants`, `memberships`, `products`, `integration_refs`, `product_config_revisions`, `discovery_runs`, `studies`, `study_revisions`, `participants`, `assignments`, `sessions`, `assets`, `events`, `transcript_segments`, `findings`, `issue_mappings`, `repair_runs`, `check_runs`, `previews`, `validation_summaries`, `notification_outbox`, `jobs`, `audit_events`, optional `credit_ledger`.

Store credentials in an appropriate secret store; database records hold references. Event/media payload size must be bounded. Background processing loads bounded evidence windows rather than entire sessions into every model call.

## Event and operation contracts

Use the shared envelope and schema validation. Initial events:

- `discovery.completed`, `study.published`, `assignment.claimed`
- `session.upload_verified`, `session.analysis_ready`, `analysis.completed`
- `participation.recorded`
- `summary.generated`
- `issue.created`, `issue.updated`, `finding.ready_for_repair`
- `repair.candidate_ready`, `repair.draft_pr_ready`, `checks.completed`, `preview.ready`
- `signal.flagged` (inbound from Jev via the SDK team), `tenant.paused`, `tenant.resumed`
- `retest.requested`, `validation.updated`, `workflow.blocked`

`study.published` is written to `OutboxEvent` in the publish transaction with idempotency key `<study_id>:revision_<n>:publish`; `discovery.completed` is not yet emitted (run completion is read from `DiscoveryRun.status`). Use transactions plus an outbox for jobs and notifications. Each transition checks current state/revision and permissions. Consumers deduplicate; scheduled reconciliation resolves lost webhooks. Progress subscriptions via SSE or polling read the persisted state, not simulated timers.

VC-04 adds a durable `repair.run` job. Its fixture adapters are deterministic
local implementations; the worker stores provider session IDs before polling,
persists independent CheckRuns, and records Preview rows only after a healthy
deployment response. GitHub App publication and repair operations require
Contents read, Pull requests write, and Issues write permissions.

## Policy precedence

Published study policy is immutable for provenance, but live global pause, revoked access, tighter spending caps and disabled capture always constrain upcoming actions. Loosening permissions does not retroactively launch side effects without an explicit resume/upgrade operation. Record who changed the policy, why, and which pending jobs were affected.

An owner should not need to review each code edit in the authorized isolated workflow. Owner-directed selection is a separate planning decision. Production merge/deployment remains out of scope.

## Failure and operational visibility

Display distinctions between waiting for a human, provider rate limit, invalid agent output, missing media, test failure, preview failure, budget exhaustion and insufficient evidence. Offer safe retry/cancel where possible. A retry resumes an existing operation or intentionally creates a new version; never conceal duplicates.

The Operations page lists jobs (type, status, attempts, next run, last error) and outbox events per tenant. Failed jobs can be retried (resets `status` to pending and `nextRunAt` to now, keeps the attempt history) and pending jobs cancelled; both actions are audited. Job handlers are idempotent, so a retry resumes the existing operation (the same run/finding/summary row) rather than creating a duplicate.

Track measured timing: time to first session, upload/transcription latency, analysis time, Devin time, time to checked preview, time awaiting retest, and actual usage/cost where available. Mark estimates as estimates. These are operational measures, not product-market-fit proof.

Deletion jobs remove scoped media/transcripts and dependent content, invalidate links, and request provider deletion where supported. Preserve minimal non-content audit history. Do not falsely claim external data was deleted before confirmation.

## Acceptance criteria

- Owner can move from product setup to evidence to issue/preview without losing context.
- Each automation mode has a correct terminal state and clear UI label.
- The dashboard reflects actual persisted progress and recovers after reload/restart.
- Restarting workers or replaying callbacks does not duplicate issues, credits, assignments, summaries or PRs.
- Signals are displayed as hints with source and window; they never create issues or repairs by themselves.
- Cross-tenant reads/writes and participant access to owner artifacts are denied.
- Global pause blocks new external work while preserving audit and resumable state.
- All current-human-validation labels match the exact current PR SHA.
- Media views work with expiring authorization; missing/deleted evidence is shown explicitly.
- The UI works at laptop/mobile widths and core actions are keyboard accessible.

## Open decisions / future changes

- [ ] Final worker/hosting choice after account capability checks. Drizzle over Prisma was chosen for SQL-first locking queries and a lighter runtime.
- [ ] Replace per-tenant API keys with memberships/roles once a dashboard login exists.
- [ ] Marketplace ranking, paid credits and participant quality appeals after MVP.
- [ ] Team invitation and SSO requirements from actual customers.
- [ ] Additional observability, retention export and provider-deletion guarantees.
- [ ] Authentication of inbound `signal.flagged` posts from the SDK/Jev pipeline (currently the tenant API key).
- [ ] "Propose an experiment from a signal": feeding VC-01 discovery with signals as labeled inputs.
