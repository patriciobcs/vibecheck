# VC-06 · Owner dashboard and durable orchestration

Status: Draft
Depends on: [shared contracts](README.md) and VC-01 through VC-05

## Goal

Give owners a coherent view of research and implementation progress, configurable autonomy, and access to evidence. The dashboard must explain real backend state, not merely play an animation of an ideal workflow.

## Information architecture

### Product overview

Show product URL, connection health, participant sources, studies in progress, findings needing attention, previews, and latest human outcomes. Empty states give one clear next action: connect product, run discovery or invite testers. Avoid fabricated ROI, participation counts or generic honesty/UX scores.

### Proposed tests

Cards include participant-facing task, rationale/evidence, audience, duration and proposed success measure. Allow edit, select, publish, dismiss and view discovery provenance. Display an automatic-launch indicator only if that setting is enabled.

### Study detail

Use a clear timeline: Recruiting → Testing → Analyzing → Issues → Building → Retesting → Results. A mode that stops at issues should end successfully there, not appear unfinished. Show target/claimed/completed counts, actual statuses, deadlines and reasons for waiting.

### Evidence review

Synchronized recording player, transcript and event timeline with time-linked findings. Indicate missing channels, prompts/assistance, sample fixtures, recording pauses and redactions. Clicking a finding jumps to its cited range. Access to media is role-controlled and signed URLs expire.

### Findings and alternatives

Each finding separates observation, explanation hypothesis and proposed experiment. Show recurrence counts, uncertainty, GitHub issue mapping, variant previews and independent checks. Original/variant views show build identity and whether human evidence applies to the current commit.

### Settings

Repository/environment connection; owner-selected versus automatic studies; issues-only/draft-PR/retest mode; recruitment source and budget; capture channels; retention; invitation caps; email settings; maximum agent attempts/runtime/spend; allowed modification scope; global pause; delete/export data.

Roasty may explain a state in one sentence, but remains optional and never substitutes for accessible status text. No mascot chatter during a participant's task unless it is a logged neutral research prompt.

## Roles and tenant access

- Owner/admin: configure product and integrations, manage studies and members, view authorized evidence, pause jobs.
- Researcher: manage tasks/findings within granted products; cannot change repository credentials or tenant billing policy.
- Viewer: read-only authorized dashboard.
- Participant: only their assignments, consent, submissions and credit history; never other recordings or repository secrets.

Use backend authorization and row-level tenant boundaries; unguessable IDs alone are not access control. Audit settings, external side effects, manual overrides and access revocation. Avoid unnecessary personal attributes in agent context.

## Suggested architecture

Next.js application/API, Postgres/Supabase for tenancy and workflow records, private object storage for media, and a durable worker for long-running jobs. Provider adapters: Devin, GitHub, media, STT, email, preview deployment. The browser must not hold an API request open for a Devin session or a human assignment.

MVP durable worker can be a separate process backed by a database jobs table with leases, heartbeats, retry count and `next_run_at`. Do not build a complex workflow engine before the pipeline works. Every provider session/deployment ID is stored for reconciliation.

Core tables: `tenants`, `memberships`, `products`, `integration_refs`, `product_config_revisions`, `discovery_runs`, `studies`, `study_revisions`, `participants`, `assignments`, `sessions`, `assets`, `events`, `transcript_segments`, `findings`, `issue_mappings`, `repair_runs`, `check_runs`, `previews`, `validation_summaries`, `notification_outbox`, `jobs`, `audit_events`, optional `credit_ledger`.

Store credentials in an appropriate secret store; database records hold references. Event/media payload size must be bounded. Background processing loads bounded evidence windows rather than entire sessions into every model call.

## Event and operation contracts

Use the shared envelope and schema validation. Initial events:

- `discovery.completed`, `study.published`, `assignment.claimed`
- `session.upload_verified`, `session.analysis_ready`, `analysis.completed`
- `issue.created`, `issue.updated`, `finding.ready_for_repair`
- `repair.candidate_ready`, `checks.completed`, `preview.ready`
- `retest.requested`, `validation.updated`, `workflow.blocked`

Use transactions plus an outbox for jobs and notifications. Each transition checks current state/revision and permissions. Consumers deduplicate; scheduled reconciliation resolves lost webhooks. Progress subscriptions via SSE or polling read the persisted state, not simulated timers.

## Policy precedence

Published study policy is immutable for provenance, but live global pause, revoked access, tighter spending caps and disabled capture always constrain upcoming actions. Loosening permissions does not retroactively launch side effects without an explicit resume/upgrade operation. Record who changed the policy, why, and which pending jobs were affected.

An owner should not need to review each code edit in the authorized isolated workflow. Owner-directed selection is a separate planning decision. Production merge/deployment remains out of scope.

## Failure and operational visibility

Display distinctions between waiting for a human, provider rate limit, invalid agent output, missing media, test failure, preview failure, budget exhaustion and insufficient evidence. Offer safe retry/cancel where possible. A retry resumes an existing operation or intentionally creates a new version; never conceal duplicates.

Track measured timing: time to first session, upload/transcription latency, analysis time, Devin time, time to checked preview, time awaiting retest, and actual usage/cost where available. Mark estimates as estimates. These are operational measures, not product-market-fit proof.

Deletion jobs remove scoped media/transcripts and dependent content, invalidate links, and request provider deletion where supported. Preserve minimal non-content audit history. Do not falsely claim external data was deleted before confirmation.

## Acceptance criteria

- Owner can move from product setup to evidence to issue/preview without losing context.
- Each automation mode has a correct terminal state and clear UI label.
- The dashboard reflects actual persisted progress and recovers after reload/restart.
- Restarting workers or replaying callbacks does not duplicate issues, credits, assignments or PRs.
- Cross-tenant reads/writes and participant access to owner artifacts are denied.
- Global pause blocks new external work while preserving audit and resumable state.
- All current-human-validation labels match the exact current PR SHA.
- Media views work with expiring authorization; missing/deleted evidence is shown explicitly.
- The UI works at laptop/mobile widths and core actions are keyboard accessible.

## Open decisions / future changes

- [ ] Final worker/hosting choice after account capability checks.
- [ ] Marketplace ranking, paid credits and participant quality appeals after MVP.
- [ ] Team invitation and SSO requirements from actual customers.
- [ ] Additional observability, retention export and provider-deletion guarantees.

