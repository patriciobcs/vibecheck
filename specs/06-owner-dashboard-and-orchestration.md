# VC-06 · Owner dashboard and durable orchestration

Status: Draft
Depends on: [shared contracts](README.md) and VC-01 through VC-05

## Goal

Give owners a coherent view of research and implementation progress, configurable autonomy, and access to evidence. The dashboard must explain real backend state, not merely play an animation of an ideal workflow.

## Information architecture

### Product overview

Show product URL, repository binding and connection health, experiments (studies) by stage, findings needing attention, open issues and draft PRs, the latest experiment summary and a Signals (research candidates) panel. Empty states give one clear next action: connect product, run discovery or publish an experiment. Avoid fabricated ROI, participation counts or generic honesty/UX scores; numbers come from persisted rows with denominators.

### Signals (research candidates)

The dashboard reads tenant- and product-scoped `research_candidates` and related monitoring rows populated by the in-repo Jev pipeline. Candidates show category, target reference, distinct observation-session and journey denominators, evidence limitations and lifecycle state (`proposed`, `accepted`, `dismissed`, `study_linked`). They are passive signal context, not findings, human evidence, GitHub issues or repairs. Discovery may receive candidate references as labeled provenance for neutral task planning.

### Proposed tests

Cards include participant-facing task, rationale/evidence, audience, duration and proposed success measure. Allow edit, select, publish, dismiss and view discovery provenance. Display an automatic-launch indicator only if that setting is enabled.

### Study detail

Use a clear timeline derived from persisted state: Proposed → Published → Collecting → Summarized → Issues → Draft PR (→ Preview). The Summarized stage reads the latest persisted experiment summary for the study. Draft PR and Preview read persisted repair runs. Stages after Summarized depend on the automation mode: `issues_only` ends successfully at Issues, `draft_pr` at Draft PR, `prototype_and_retest` at Preview (retesting is deferred, VC-05). A mode that stops early ends with a completed label, not an unfinished one. Each stage shows its count (completed sessions, findings, issues) and the reason it is waiting (no sessions yet, analysis running, agent running, checks failed, blocked by permissions, paused).

### Evidence review

Synchronized recording player, transcript and event timeline with time-linked findings. Indicate missing channels, prompts/assistance, sample fixtures, recording pauses and redactions. Clicking a finding jumps to its cited range. Access to media is role-controlled and signed URLs expire.

### Findings and alternatives

Each finding separates observation, explanation hypothesis and proposed experiment. Show recurrence counts, uncertainty, GitHub issue mapping, variant previews and independent checks. Original/variant views show build identity and whether human evidence applies to the current commit.

### Settings

Repository/environment connection; owner-selected versus automatic studies; issues-only/draft-PR/retest mode; recruitment source and budget; capture channels; retention; invitation caps; email settings; maximum agent attempts/runtime/spend; allowed modification scope; global pause; delete/export data. Implemented first: the tenant-level **global pause** (`tenants.paused` is the source of truth, `tenants.paused_at` records when it took effect, set through `POST /api/settings/pause` or the Operations page). The worker checks it before leasing any job (`jobs.tenant_id`): a paused tenant's jobs stay `queued` with attempts and `next_run_at` untouched, and the dashboard shows the paused banner. Every pause/resume writes an `audit_events` row recording the reason and the number of queued jobs affected.

Roasty may explain a state in one sentence, but remains optional and never substitutes for accessible status text. No mascot chatter during a participant's task unless it is a logged neutral research prompt.

## Roles and tenant access

- Owner/admin: configure product and integrations, manage studies and members, view authorized evidence, pause jobs.
- Researcher: manage tasks/findings within granted products; cannot change repository credentials or tenant billing policy.
- Viewer: read-only authorized dashboard.
- Participant: only their assignments, consent, submissions and credit history; never other recordings or repository secrets.

Use backend authorization and row-level tenant boundaries; unguessable IDs alone are not access control. Audit settings, external side effects, manual overrides and access revocation. Avoid unnecessary personal attributes in agent context.

## Suggested architecture

Next.js application/API, Postgres/Supabase for tenancy and workflow records, private object storage for media, and a durable worker for long-running jobs. Provider adapters: Devin, Jev, GitHub, media, STT, email, preview deployment. The browser must not hold an API request open for a Devin session or a human assignment.

MVP durable worker is a separate process (`npm run worker`) backed by the `Job` table: claims use `SELECT … FOR UPDATE SKIP LOCKED`, a five-minute lease renewed by heartbeat, `attempts`/`maxAttempts` with exponential backoff on `nextRunAt`, and graceful shutdown on SIGINT/SIGTERM. Re-leasing a job whose lease expired counts as a failed attempt (the previous worker died mid-job), so a job that keeps crashing its worker is dead-lettered instead of looping. Jobs are enqueued on the caller's transaction (`enqueueJob(input, tx)`), so a job never commits without the rows it needs, and webhook receipts (Vonage archive callbacks, observation batches) commit together with the processing they deduplicate. Job payloads are schema-validated; unknown job types fail terminally. Do not build a complex workflow engine before the pipeline works. Every provider session/deployment ID is stored for reconciliation (`DiscoveryRun.providerSessionId`, `providerSessionUrl`).

Core tables (snake_case in `apps/web/src/db/schema`; VC-01 and VC-02 tables are implemented, the monitoring tables exist as schema and are being filled in): `tenants`, `memberships`, `api_keys`, `products`, `integration_refs`, `product_config_revisions`, `discovery_runs`, `proposals`, `publish_requests`, `detector_definitions`, `monitoring_policy_revisions`, `observation_sessions`, `observation_events`, `observation_windows`, `jev_evaluations`, `research_candidates`, `candidate_study_links`, `studies`, `study_revisions`, `participants`, `assignments`, `sessions`, `assets`, `events`, `transcript_segments`, `findings`, `issue_mappings`, `repair_runs`, `check_runs`, `previews`, `notification_outbox`, `jobs`, `audit_events`, optional `credit_ledger`.

Store credentials in an appropriate secret store; database records hold references. Event/media payload size must be bounded. Background processing loads bounded evidence windows rather than entire sessions into every model call.

## Event and operation contracts

Use the shared envelope and schema validation. Initial events:

- `detector.published`, `observation.batch_received`, `evaluation.requested`, `evaluation.completed`, `research_candidate.updated`
- `discovery.completed`, `study.published`, `assignment.claimed`
- `session.upload_verified`, `session.analysis_ready`, `analysis.completed`
- `participation.recorded`
- `summary.generated`
- `issue.created`, `issue.updated`, `finding.ready_for_repair`
- `repair.candidate_ready`, `repair.draft_pr_ready`, `checks.completed`, `preview.ready`
- `tenant.paused`, `tenant.resumed`
- `retest.requested`, `validation.updated`, `workflow.blocked`

`study.published` is written to `event_outbox` in the publish transaction with idempotency key `<study_id>:revision_<n>:publish`; `research_candidate.updated` is emitted when internal monitoring changes candidate state; tenant-level events (`tenant.paused`, `tenant.resumed`) carry the tenant id in `product_id` because the shared envelope requires one. `discovery.completed` is not yet emitted (run completion is read from `DiscoveryRun.status`). Use transactions plus an outbox for jobs and notifications. Each transition checks current state/revision and permissions. Consumers deduplicate; scheduled reconciliation resolves lost webhooks. Progress subscriptions via SSE or polling read the persisted state, not simulated timers.

VC-04 adds a durable `repair.run` job. Fixture adapters are deterministic
local implementations; the worker stores provider session IDs before polling,
persists independent CheckRuns, and records Preview rows only after a healthy
deployment response. GitHub repair operations require Contents read, Pull
requests write and Issues write permissions.

## Policy precedence

Published study policy is immutable for provenance, but live global pause, revoked access, tighter spending caps and disabled capture always constrain upcoming actions. Loosening permissions does not retroactively launch side effects without an explicit resume/upgrade operation. Record who changed the policy, why, and which pending jobs were affected.

An owner should not need to review each code edit in the authorized isolated workflow. Owner-directed selection is a separate planning decision. Production merge/deployment remains out of scope.

## Failure and operational visibility

Display distinctions between waiting for a human, provider rate limit, invalid agent output, missing media, test failure, preview failure, budget exhaustion and insufficient evidence. Offer safe retry/cancel where possible. A retry resumes an existing operation or intentionally creates a new version; never conceal duplicates.

The Operations page (`/operations`, API under `/api/operations`) lists jobs (type, status, attempts, next run, last error) and outbox events per tenant, plus the global pause control. Failed/dead/cancelled jobs can be retried (resets `status` to `queued`, `attempts` to 0 and `next_run_at` to now) and queued jobs cancelled (`cancelled` job status); both actions are audited with the previous status and are rejected cross-tenant (404) or in the wrong state (409). Job handlers are idempotent, so a retry resumes the existing operation (the same run/finding/summary row) rather than creating a duplicate.

Track measured timing: time to first session, upload/transcription latency, analysis time, Devin time, time to checked preview, time awaiting retest, and actual usage/cost where available. Mark estimates as estimates. These are operational measures, not product-market-fit proof.

Deletion jobs remove scoped media/transcripts and dependent content, invalidate links, and request provider deletion where supported. Preserve minimal non-content audit history. Do not falsely claim external data was deleted before confirmation.

## Continuous monitoring controls and views

Implemented as `/products/:id/monitoring` (2026-09-19): collection health, detectors with status and required events, evaluations with trigger/sample reason, requested and returned model, tokens and cost (labeled unpriced without a configured price), research candidates with distinct-session denominators, evidence limitations and actions, and the policy form (each save is a new revision). Original intent: add a Monitoring view with collection health, active/stale detectors, known event coverage, last evaluated build, suspected friction and research candidates. Label candidates as passive signals, separate from findings supported by human studies. Show source events, window bounds, gaps, trigger versus random-sample reason, actual model version and detector version. Avoid an overall honesty or UX score.

Candidate actions: inspect, dismiss with reason, request task proposal or open linked study. Default task publication remains owner-selected; show when saved auto-launch rules performed it. Display counts of distinct observation sessions, evaluated journeys and sampled journeys with explicit denominators. Trigger-selected data is not an unbiased estimate of all-user friction. Show unknown/unavailable outcomes separately from clean journeys.

Settings expose the shared monitoring policy: disabled-by-default collection, allowed journeys/events, permissions integration, raw/derived retention, batching/window/cooldown, detector thresholds, normal sampling, session/product call caps and spend limits. Explain these as tuning parameters rather than guarantees. Invitation cooldown and consent are independent of detector cooldown. Users never see a live meter or automatic loss of credits.

Use separate observation ingestion and screening jobs from media processing. The worker stores immutable windows and configuration snapshots, reserves budget transactionally before dispatch, reconciles usage and persists provider failures. Use bounded queues/backpressure, expiring leases and per-journey coalescing. A restarted worker must not issue another provider request for an unresolved in-flight request without explicit reconciliation/accounting. No exactly-once billing promise where the provider has no verified idempotency support.

Global pause, revoked credentials, disabled monitoring and tighter caps gate queued evaluations and candidate-driven launches immediately. Retention/deletion cascades from source observations to windows and derived content; retained non-content audit rows indicate evidence removed. Existing recordings retain their own policy. Never retain raw logs indefinitely to preserve a chart.

Metrics: actual calls/tokens/estimated or actual cost, queue time, provider latency, trigger mix, skipped/deferred counts, coverage, candidate-to-study conversion and labeled false-positive outcomes. Keep observed detector accuracy separate from model confidence. Operational dashboards are not proof of PMF.

Additional acceptance criteria:

- Cross-tenant observation reads, candidate actions and detector edits are rejected.
- Owner can trace a research candidate through its detector/window to a neutral task and later human evidence.
- Restart/concurrency tests demonstrate bounded provider calls and unique candidate/study mappings.
- Collection off, global pause, deletion and budget exhaustion appear as actual persisted states.
- Passive monitoring does not change participation credits or imply recording permission.


## Acceptance criteria

- Owner can move from product setup to evidence to issue/preview without losing context.
- Each automation mode has a correct terminal state and clear UI label.
- The dashboard reflects actual persisted progress and recovers after reload/restart.
- Restarting workers or replaying callbacks does not duplicate issues, credits, assignments, summaries or PRs.
- Research candidates are displayed as passive hints with source and window; they never create issues or repairs by themselves.
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
- [ ] Per-study-session Jev evaluation of instrumentation logs needs a journey/detector mapping for study events; not implemented.

### Live analysis view (implemented 2026-09-20)

`/products/:id/monitoring/live` is the second-screen view for a running session: the owner's browser polls `GET /api/owner/products/:id/live` every second and renders persisted state only (stored events, windows, evaluations, candidates, assets, transcript segments); nothing is simulated or extrapolated. Until the first session exists it shows a waiting state with the product URL and the policy/provider status. Sessions (passive observation sessions and opted-in study sessions of the product) appear as tabs, or a dropdown past six, newest first; "Follow newest" auto-selects the most recently active one. A passive session shows a metrics strip derived deterministically from the stored events (`journey-metrics.ts`: journey time, attempts, detours = cancelled attempts, failures, help requests, outcome, time to goal), an instrumentation log stream, a journey timeline with the evaluated windows shaded, "What Jev reads into it" (every answer next to the question it answers, probability bars against the gate thresholds, model, latency, tokens, the redacted state that was sent, and earlier evaluations as a trend), and research candidates with the same actions as the Monitoring view. A study session shows the same strip over its semantic events plus recording and transcript status, a session log that interleaves actions and speech on one clock, the task, the timeline and the transcript. Facts come from events; meaning comes from Jev and is labeled as an estimate.
