# VibeCheck specifications

Status: Draft product specification; implementation has not been verified.

VibeCheck organizes real-human usability research and turns evidence into issues, working code alternatives, and human retests. The embedded library and research engine are the core product. Shareable links and a marketplace supply participants when existing users are unavailable or should not be interrupted.

## Spec map

| ID | Spec | Responsibility |
| --- | --- | --- |
| VC-01 | [Product onboarding and planning](01-product-onboarding-and-test-planning.md) | Connect product/repository, propose challenges, select studies, publish a JSON handoff. |
| VC-02 | [Test delivery and recording](02-test-delivery-and-recording.md) | Passive semantic telemetry, invitations, assignment, consent, configurable recording and uploads. |
| VC-03 | [Evidence and GitHub issues](03-evidence-analysis-and-github-issues.md) | Trigger Jev screening, propose research candidates, analyze human sessions through Devin, deduplicate findings and issues. |
| VC-04 | [Prototypes and verification](04-prototypes-and-verification.md) | Isolated changes, independent checks, retries, previews, draft PRs. |
| VC-05 | [Retesting and validation](05-retesting-and-validation.md) | Invitations, fresh/repeat participants, comparison, commit-bound PR evidence. |
| VC-06 | [Dashboard and orchestration](06-owner-dashboard-and-orchestration.md) | Owner views, settings, tenancy, durable jobs, audit trail and integrations. |
| VC-07 | [Demo target app](07-demo-target-app.md) | Open-source candidate, reproducible fixture, checks and honest three-minute demo. |

## Product decisions

- Initial platform: web applications. Research can work against a URL; code changes additionally require repository access and a reproducible environment.
- The owner selects proposed tasks by default. Optional `auto_launch` can launch bounded studies under preconfigured rules. This supports both owner-directed research and the autonomous demo.
- Once a study is launched, processing follows its snapshotted automation policy. No repeated owner approval is necessary for authorized issue creation or isolated prototypes.
- Modes: `issues_only`, `draft_pr`, `prototype_and_retest`. No automatic merge or production deployment in the MVP.
- Devin is the initial agent provider for planning, analysis, and implementation. Jev screens bounded telemetry windows for possible friction; Devin generates detector questions and plans research. The Jev adapter and screening loop are implemented and tested with stubbed answers; a real Jev call and accuracy remain unverified until `JEV_API_KEY` is supplied. Nebius is not required.
- Ordinary application code owns assignments, credit transactions, workflow state, validation execution and access control. Devin does not replace those services.
- Vonage is the planned media provider; SLNG is the planned STT provider. Verify recording capabilities, access, and supported browser behavior during integration.
- Branches/worktrees in an authorized repository are the default prototype mechanism. Forks are supported as an alternative, not required per variant.
- Task success and participation quality are separate. Failure to complete a task can be valuable research. No honesty score or live reward meter.

## MVP and exclusions

Build one reusable web-app pipeline and prove it with one connected demo repository, one task, one baseline version, one variant, and a small invited participant pool. Provide both a direct link and embedded invitation. A basic claim queue is enough for the marketplace.

Defer payments, complex reputation, generalized automatic setup of arbitrary repositories, native app capture, production rollout, advanced randomization, and enterprise identity integrations. Fixed credits for valid participation may use a ledger without implementing purchases. A prototype must not pretend these deferred capabilities exist.

## Workflow

```text
Product configuration → discovery run → proposed tasks → selection/auto-launch
    → immutable study plan → assignment → consent → session → uploaded evidence
    → analysis → supported finding → deduplicate → GitHub issue
       ├─ issues_only: stop
       ├─ draft_pr: implement → validate → draft PR, no human retest
       └─ prototype_and_retest: implement → validate → preview → draft PR
            → retest invitation → human session → comparison → update PR evidence
```

No finding is a valid result. No participant, missing media, setup failure, exhausted agent budget, or inconclusive retesting must remain visible outcomes; none is silently converted to success.

## Shared contract conventions

These examples are target contracts, not shipped endpoints. Validate inputs/outputs against runtime schemas. IDs are opaque strings, timestamps UTC ISO-8601, relative times integer milliseconds. Every message contains `schema_version`, `event_id`, `event_type`, `occurred_at`, `tenant_id`, `product_id`, `correlation_id`, `idempotency_key`, and `payload`. The server derives tenant access from authentication; a caller-provided tenant ID is never sufficient authorization.

Events may arrive more than once or out of order. Deduplicate by event ID and business operation key. Version rows or use transactional transitions to reject stale updates. External side effects use an outbox and reconciliation record.

```json
{
  "schema_version": "1.0",
  "event_id": "evt_example",
  "event_type": "study.published",
  "occurred_at": "2026-09-19T10:00:00Z",
  "tenant_id": "tenant_example",
  "product_id": "product_example",
  "correlation_id": "workflow_example",
  "idempotency_key": "study_example:revision_1:publish",
  "payload": {
    "study_id": "study_example",
    "study_revision": 1,
    "plan_ref": "studyplan_example"
  }
}
```

`*_ref` values resolve through authenticated services; they are not embedded credentials or permanently public URLs. Credential references identify secrets stored server-side. Signed media links expire and must not be copied into permanent issues or logs.

### Entity ownership

| Entity | Essential fields | Producer → consumers |
| --- | --- | --- |
| ProductConfig | URL/origins, repo binding, audience, credential refs, setup adapter, policies | VC-01/06 → all |
| DetectorDefinition | immutable questions, journey, required signals, app/build binding, policy ref | VC-01 → VC-02/03/06 |
| ObservationWindow | observation session/journey, event IDs, coverage, goal provenance, build, policy | VC-02/03 → Jev |
| JevEvaluation | window/detector refs, actual model, answers, usage, status | VC-03 → VC-01/06 |
| ResearchCandidate | suspected problem, evaluation refs, limitations, unique journey counts, lifecycle | VC-03 → VC-01/06 |
| StudyPlan | immutable task revision, baseline SHA/build, capture and recruitment policy, success rubric | VC-01 → VC-02/03/05 |
| Assignment | participant, cohort, study revision, version/SHA, expiry, fixture ref | VC-02/05 → VC-03/06 |
| SessionManifest | assignment, clocks, capture provenance, media/event refs, completeness | VC-02 → VC-03/05 |
| Finding | title, observation, hypothesis, evidence refs, uncertainty, fingerprint, provenance | VC-03 → VC-04/06 |
| RepairRun | issue, base/candidate SHA, Devin session, attempt/budget, validator version | VC-04 → VC-05/06 |
| Preview | candidate SHA, URL, fixture revision, checks, lifecycle/expiry | VC-04 → VC-05 |
| ValidationSummary | exact SHA, task revision, cohort, observations, checks, limitations | VC-05 → GitHub/VC-06 |

### Study plan handoff

The plan is stored as immutable JSON; events carry its reference. Secrets are excluded.

```json
{
  "schema_version": "1.0",
  "study_id": "study_example",
  "study_revision": 1,
  "product_id": "product_example",
  "task": {
    "task_id": "task_capture_ideas",
    "participant_prompt": "The board on screen collects ideas for a team offsite. Add these three ideas to the board so your teammates can read them: rooftop dinner, karaoke night, museum tour.",
    "research_question": "Can a user capture several short ideas on an existing board?",
    "time_limit_seconds": 300,
    "success_rule_ref": "stickynote_capture_v1",
    "fixture_ref": "excalidraw_fixture_v1"
  },
  "baseline": {"commit_sha": "REPLACE_WITH_REAL_SHA", "environment_ref": "baseline_preview"},
  "recruitment": {"source": "marketplace", "target_count": 2, "cohort": "fresh", "eligibility_rule_ref": "eligible_whiteboard_users_v1"},
  "capture": {"screen": "required", "microphone": "required", "webcam": "off", "pointer": "on", "keyboard": "semantic_only", "text_values": "off", "retention_days": 30},
  "automation": {"mode": "prototype_and_retest", "max_variants": 1, "max_repair_attempts": 2, "agent_budget_ref": "demo_budget", "retest_target_count": 2}
}
```

These are example counts and proposed defaults, not powered sample sizes or verified provider limits. Freeze the neutral task and equivalent fixture across retests. Changes to task wording or success definition create a new study revision and affect comparability.

## Continuous discovery contracts

Implemented alongside the opt-in recorder (schemas in `packages/contracts`: `observation.ts`, `monitoring-policy.ts`, `detector.ts`, `jev.ts`; tables in VC-06):

```text
Code/context → Devin → versioned detector questions + required telemetry
SDK semantic events → deterministic trigger → bounded window → Jev
    → suspected friction / insufficient evidence / no signal
    → research candidate → VC-01 neutral task → selection/authorized auto-launch
    → existing human-study → finding → issue → optional repair/retest pipeline
```

A signal alone cannot create a GitHub issue, authorize repair, establish user intent or claim human validation. Passive collection has its own disclosed collection policy and permission state; installing the SDK or consenting to research does not automatically enable it. Passive monitoring never starts screen/audio recording.

New records use the shared envelope and tenant boundaries. Observation sessions are separate from research sessions and need no assignment. Link them only where authorized; retain source event IDs to prevent double-counting. A detector version is immutable and contains `detector_id`, `version`, `journey_id`, `app_build_ref`, `instrumentation_schema_version`, `required_events`, `questions`, `evaluation_policy_ref` and authoring provenance. Questions are Jev-compatible, whereas scheduling and thresholds belong to our service, outside Jev's question schema.

Proposed starting policy, configurable and not validated performance thresholds:

```json
{
  "schema_version": "1.0",
  "policy_id": "monitoring_policy_example",
  "enabled": false,
  "batch_delay_ms": 4000,
  "window_ms": 90000,
  "cooldown_ms": 30000,
  "normal_journey_sample_rate": 0.01,
  "max_evaluations_per_session_hour": 10,
  "max_evaluations_per_product_day": 1000,
  "max_input_tokens": 6000,
  "max_output_tokens_budget": 1000,
  "daily_spend_cap_usd": 5,
  "candidate_friction_threshold": 0.85,
  "candidate_research_threshold": 0.80,
  "raw_event_retention_days": 7,
  "derived_retention_days": 30
}
```

Token limits are application admission/reservation limits, not assumed provider request parameters. Require a configured pricing estimate before enforcing spend-based admission; reconcile with returned usage and label costs as estimates when needed. Enforce all caps together, including retries. Retention defaults are proposals, independently configurable from study media.

`ObservationWindow` stores `window_id`, `observation_session_id`, `journey_instance_id`, `build_ref`, `detector_ref`, `policy_ref`, start/end times, ordered event refs, gaps, declared/inferred/unknown goal source, coverage and bounded earlier progress summary. Missing build identity or required telemetry prevents use of a detector that requires them. Do not fabricate context to fit a detector.

`JevEvaluation` stores the immutable window, detector and policy references; request hash; requested and returned model versions; raw validated answers; provider request ID where available; timestamps; usage; sampling/trigger reason; and `queued/running/completed/failed/deferred/unknown_outcome` status. An unavailable response is never a negative UX finding.

`ResearchCandidate` stores `candidate_id`, journey/target/category, baseline build, detector version, evaluation refs, supporting event refs, evidence limitations, distinct observation-session/journey counts and `proposed/accepted/dismissed/study_linked` state. Acceptance routes to planning, not repair. Study proposals and published plans may carry optional `source_candidate_refs`; candidate-to-study links survive dismissal or supersession as provenance. No inferred person counts from anonymous sessions.

Compatibility: introduce these as new record/event schemas; preserve existing `SessionManifest` and study recording endpoints. Add optional provenance fields to study contracts with tolerant consumers before producers emit them. Breaking changes require a new schema version. Implement shared runtime schemas before enabling ingestion.


## Cross-cutting requirements

- Consent precedes media capture. Record capture configuration, consent version and permissions. Capture only the declared surface; keyboard content is off by default. See VC-02 for actual browser boundaries.
- Each artifact is tenant-scoped. Public issues contain sanitized summaries and authenticated evidence links, not raw participant data.
- SDK secrets never ship to browsers. An origin-bound publishable key can identify an app, but cannot grant administration or repository access.
- A model's analysis is a hypothesis. Deterministic checks prove declared functional properties; human sessions supply bounded usability evidence. Neither is a guarantee of overall quality.
- Claims of human validation attach to the exact tested commit, task revision, fixture and cohort. New code makes earlier validation historical.
- The app may send notifications only to participants who agreed to invitations, following configured delivery rules. Development uses test inboxes.
- Retention and deletion apply to media, transcripts, derived findings and provider copies according to the configured policy; retain only necessary non-content audit metadata.

## Implementation coordination

Repository layout: `apps/web` (Next.js app, API routes, worker), `packages/contracts` (Zod schemas that every producer and consumer imports), `packages/sdk` (embedded script). Local stack: Supabase CLI for Postgres and Storage, Better Auth for sign-in, Biome for lint/format, Vitest and Playwright for tests. VC-02 is implemented and verified against real Vonage and SLNG with a simulated session (`LIVE_PROVIDERS=1`); VC-01 output is stand-in sample data seeded with provenance `sample`. The participant flow is a dialog the SDK overlays on the product page; see VC-02 for the host↔dialog contract in `packages/contracts/src/embed-messages.ts`.

First agree on schemas and sample payloads. Person A owns VC-02 and dashboard UI; Person B owns VC-01/03/04/05 and orchestration. Person A also prepares the demo app and independent browser checks so repair work does not become a bottleneck. Both own shared contracts. This split does not authorize spawning agents automatically.

Suggested milestones: (1) supplied finding → checked preview; (2) genuine recording → finding; (3) published task → assignment; (4) preview → retest → PR evidence; (5) discovery and demo polish.

## Keeping these specs flexible

See [agent instructions](../AGENTS.md). Update affected specs directly in the same change as implementation. Git history is the change log: do not maintain manual change logs, per-change files, document revision counters, or routine updated-date fields.

Specs describe the current intended behavior. Replace obsolete requirements and keep relevant rationale, compatibility and migration notes next to the affected design. Explain why a change was made in the commit or PR description. Explicit user requirements take precedence; a spec change alone does not require user permission.

Add unresolved proposals under Open decisions until resolved. JSON schema versions and runtime study revisions still matter: update them when contracts or immutable study plans change. Record source verification dates when a decision relies on live documentation; these are evidence provenance, not document revision metadata.

## Open decisions

- [x] Durable worker: a separate process leasing rows from a Postgres `jobs` table (`apps/web/src/worker`). Preview provider still open.
- [ ] Verify Devin account/API capabilities, budgets and artifact retrieval with a real call.
- [ ] Measure timestamp alignment tolerance between video, transcript and events, and verify Safari/Firefox screen share end to end. Vonage recording, signed callbacks and SLNG transcription are verified with real calls (2026-09-19); see VC-02's verification record.
- [ ] Select notification provider; local development writes magic links and invitations to a database test inbox (`/dev/inbox`).
- [ ] Confirm hackathon eligibility of the selected third-party demo target; see VC-07.
