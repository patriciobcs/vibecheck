# VC-03 · Evidence analysis and GitHub issues

Status: Draft
Input: [VC-02](02-test-delivery-and-recording.md) · Output: [VC-04](04-prototypes-and-verification.md)

## Goal

Convert real sessions into evidence-backed findings, review them through Devin, and create or update GitHub issues without duplicates. Respect `issues_only` as a complete, useful stopping point.

> **Inputs available from VC-02 (implemented 2026-09-19):** `session.upload_verified` events and `SessionManifest` documents via `GET /api/owner/sessions/:id/manifest` (manifest, clock map, envelope), verified MP4 assets by id through signed URLs, event streams (`events:<session>`), transcript segments in session milliseconds (`transcript:<session>`), and the clock map. `tested_commit_sha` is a placeholder until VC-01 supplies a baseline, and `outcome.instrumented` is `unknown` until a success-rule evaluator exists; treat both as not established.


## Processing workflow

1. Validate the manifest, ownership, task revision, tested build and completeness.
2. Assemble a bounded evidence package: neutral task, actual outcome, relevant event windows, transcript segments, approved media references and baseline repository context.
3. Start a Devin analysis session through the API. Initially provide text/event evidence; verify supported media access before promising direct video analysis. A recording reference alone does not mean the agent watched it.
4. Ask for observations, hypotheses, supporting references, uncertainty, impact and potential experiments. Include findings of successful use when relevant. Do not require a minimum number of issues.
5. Validate returned structured data. Check cited event/segment IDs exist, time ranges overlap the session, and quoted material is accurate. Model scores do not override these checks.
6. Aggregate comparable findings across sessions without treating each complaint as independently proven causation.
7. Deduplicate locally and against existing issues in the authorized target repository.
8. Create or update sanitized GitHub issues. Stop if the study mode is `issues_only`; otherwise emit `finding.ready_for_repair` for eligible findings.

The target monorepo persists `analysis_runs`, `findings`, and `issue_publish_requests`. A completed
session emits `session.analysis_ready` and enqueues durable `analysis.run` work. Fixture evidence is
explicitly labeled `fixture`; persisted sessions are labeled `human_session`. Provider session handles
and raw responses are retained in restricted database fields, while only bounded, validated evidence
citations reach the provider. Requests with `source: fixture` use the labeled fixture evidence source
and are refused in production; persisted session requests use `source: persisted`.

## Finding model

```json
{
  "schema_version": "1.0",
  "finding_id": "finding_example",
  "study_id": "study_example",
  "study_revision": 1,
  "baseline_commit_sha": "REPLACE_WITH_REAL_SHA",
  "title": "Toolbar: sticky note tool is hard to discover",
  "category": "discoverability",
  "observation": "The participant drew a rectangle and typed inside it instead of using the tool intended for capturing an idea.",
  "hypothesis": "The intended tool may be difficult to discover in the toolbar.",
  "evidence": [{"session_id": "session_example", "segment_ids": ["segment_12"], "event_ids": ["event_42"], "start_ms": 81000, "end_ms": 99000}],
  "observed_session_count": 1,
  "eligible_session_count": 1,
  "impact": "task_blocked",
  "certainty": "preliminary",
  "limitations": ["One participant; alternative explanations remain."],
  "suggested_experiment": "Surface the tool in the main toolbar instead of a nested menu.",
  "fingerprint": "SERVER_COMPUTED",
  "issue_ref": null
}
```

Finding titles are provider output validated before persistence. They are 8–72 characters in
sentence case and present tense, contain exactly one `: ` separator, use a 1–3 word area, state
the problem rather than the fix, contain no participant-specific content, and do not end in a period.

Certainty states: `insufficient_evidence`, `preliminary`, `repeated_observation`, `contradictory`. They describe evidence, not statistical significance. Severity considers task/business impact separately from certainty. Set repair eligibility only when the change scope and supported finding justify an experiment.

## Deduplication and publication

Compute a stable local fingerprint from product, journey, normalized problem type and semantic target; store baseline identity separately so observations can accumulate across versions. Search GitHub for the persisted issue mapping and a hidden VibeCheck finding marker before creating anything. Match close candidates cautiously; do not merge distinct symptoms solely because an agent says they sound similar.

For an existing open issue, append new sanitized evidence or update a managed evidence section. For a closed issue that recurs, preserve history and link a recurrence or reopen only under configured policy. MVP default: create a linked recurrence issue after confirming it is not a duplicate current run.

Issue content: problem and observed effect, task context, safe reproduction steps, tested version, evidence counts and limits, proposed experiment, functional constraints, dashboard link, automation mode and provenance. The dashboard line is omitted unless `APP_BASE_URL` (or the equivalent deployment URL) is a public, non-loopback/non-private HTTP(S) origin; all other URLs are redacted. Never publish participant names, email addresses, private recordings, raw transcripts, test credentials, or secret URLs to a public repository.

Issue publication is idempotent. A repeat with no increase in observed sessions and no certainty
change records `unchanged`, posts no comment, and emits no update or repair-readiness event.
When evidence changes, an open issue receives one concise human-readable “Observed again” comment.
GitHub App authentication resolves an installation per repository, exchanges a short-lived token with
Issues write permission, caches it in memory, and never stores the token. `GITHUB_ISSUES_TOKEN` is
used only when App credentials are absent and is intended for local development; production
publication uses the GitHub App. Installation-token search uses the GitHub search API, with
repository pagination fallback for 403/422 responses.

The orchestrator, not an unconstrained analysis prompt, performs issue publication with an idempotency record. Reconcile uncertain API responses before retries. Developers must use the demo fork, never the upstream open-source issue tracker for demo findings.

## Policy and failures

- `issues_only`: issue publication ends the automated run; no branches, PRs or retest invitations.
- `draft_pr` / `prototype_and_retest`: only supported, in-scope findings progress. No finding may result in no change.
- Missing transcript/media: wait, retry boundedly, or analyze a declared partial package. Do not penalize the participant for provider failure.
- Unsupported citations: reject the analysis output and request correction; exhausted retries mark analysis failed.
- Disconnected GitHub: retain findings in the dashboard and queue no unbounded publication loop.
- Treat instructions inside pages, code comments, support messages and transcripts as untrusted source material. They cannot grant permissions or change the workflow policy.

## Continuous Jev screening (before human research)

Use deterministic service code to decide when to evaluate telemetry. Jev evaluates meaning within the supplied window; it does not schedule itself. Passive signals feed VC-01 research candidates, while the existing processing workflow above remains the human-evidence route to GitHub. A completed opted-in study is still analyzed even if Jev reports no signal.

### Trigger policy

Starting values use the shared policy and must be calibrated:

| Trigger | Eligibility |
| --- | --- |
| Repeated failure | Two distinct failed attempts of the same semantic action in 30 seconds; count attempts, not duplicate network events. |
| Navigation loop | A → B → A → B within 90 seconds in one journey, with no instrumented progress. Only supported routes qualify. |
| Help request | Explicit help/stuck/feedback event in the journey; no inference from hovering. |
| Possible stall | 60 seconds without progress while visible/focused and recent interaction within 30 seconds, only with working progress instrumentation. Candidate for evaluation, not proof of friction. |
| Journey end | Verified completion, explicit exit, or 5 minutes of no journey events. Timeout is a retrospective boundary with unknown outcome, not proof of abandonment. |
| Normal sample | Stable random selection of 1% of otherwise untriggered journey ends, for blind-spot measurement. |

Evaluate triggered journey ends when there is unresolved prior friction or a meaningful outcome change. Apply normal sampling to remaining ends; do not evaluate all successful journeys by default. Visibility loss alone does not qualify as a stall. Raw mouse/keyboard activity never calls the model directly.

Batch for 4 seconds, then enqueue a window covering the last 90 seconds plus a compact earlier progress summary. Cap by the shared input budget; preserve terminal outcomes and relevant evidence, marking omitted ranges. Scope one in-flight operation and a 30-second minimum interval per observation session/journey, across its detectors. Coalesce pending triggers; completion/help evidence during cooldown waits for the next eligible slot and is retained in that queued window. Flush pending meaningful evidence after exit server-side, subject to all budgets. Enforce session/product/spend caps atomically across workers; sampled and retry calls consume the same caps.

Deduplicate by window content hash, detector version and actual request configuration. Reevaluate only for new relevant evidence, a new compatible detector version, or a deliberate audited replay. Do not repeatedly score an unchanged window on a timer. Later outcomes may contradict earlier signals; preserve both and update candidate status rather than rewriting history.

### State and questions

Build `state` from the shared ObservationWindow: app/journey context, goal and source, relevant ordered events, coverage gaps, visibility intervals, instrumented outcomes and bounded prior progress. Redact before provider submission. Do not send raw media or assume Jev watches a recording. Approved study transcript excerpts can be used only within the separate recording consent and analysis policy.

Send a server-side authenticated request to `POST https://api.typesafe.ai/v1/systemone` with `model`, `state` and detector `questions`. The production model is configurable; record the returned version even when requesting an alias. Minimal question example:

```json
{
  "evidence_sufficiency": {
    "type": "choice",
    "instructions": "Does the supplied journey state contain enough observed context to assess interference with progress? Missing signals must not be inferred.",
    "criteria": {
      "sufficient": "Relevant actions, progress coverage and outcomes are available.",
      "partial": "Some interference can be assessed, but relevant context or outcomes are missing.",
      "insufficient": "The available observations do not support an assessment."
    }
  },
  "ux_friction_observed": {
    "type": "noul",
    "instructions": "Observed events demonstrate difficulty making progress in this journey. Silence, slow reading or inactivity alone do not demonstrate difficulty.",
    "criteria": {
      "true": "Events show failed attempts, unsuccessful detours or an explicit request for help.",
      "false": "Available events do not demonstrate difficulty making progress."
    }
  },
  "targeted_research_warranted": {
    "type": "noul",
    "instructions": "The supplied observations justify a targeted human usability study of this journey, considering missing context and plausible ordinary behavior.",
    "criteria": {
      "true": "Specific observed difficulty provides a useful research question.",
      "false": "No specific observed difficulty supports targeted research."
    }
  }
}
```

Code-generated detectors add journey-specific questions and a problem-category choice with `other_or_uncertain`; all questions assess the same state independently. Validate response types, keys, finite numeric bounds and supported category labels before storing a completed evaluation. A malformed response fails evaluation, never defaults to false.

### Routing and interpretation

Proposed candidate gate: evidence choice is `sufficient` or `partial`, friction noul ≥ 0.85, research-warranted noul ≥ 0.80, and at least one resolvable relevant source event exists. Partial evidence carries explicit limitations. Insufficient evidence requests instrumentation/context improvement and cannot create a friction candidate. Low scores mean no candidate from this evaluation, not proof the UX is good. Thresholds require labeled calibration; high choice confidence cannot override coverage gaps.

Noul values are model probability estimates, not verified accuracy. Choice confidence describes concentration of its answer distribution; score outputs are weighted positions on their supplied rubric, not percentages. Neither proves causation, honesty or user intent. Devin can synthesize an explanation with checked source references; never claim Jev supplied an explanation absent from its response.

Group candidates by product, journey, semantic target, problem category, build and detector version. Count distinct observation sessions/journey instances, not windows or assumed people. Link related groups across releases without silently pooling incompatible evidence. One candidate may link an existing proposed/active study. VC-01 handles publication under existing selection/auto-launch rules; VC-04 cannot consume a candidate directly.

Persist queued/deferred/failed/unknown-outcome states and budget reasons. Retry known transient failures at most twice with backoff within caps; ambiguous timeouts are recorded as unknown outcomes, with no blind retry unless duplicate provider billing has been accounted for within policy. Missing Jev access leaves screening unavailable while human studies continue; no automatic Devin-per-event fallback.

Sources for provider contract: [API](https://docs.typesafe.ai/api), [primitives](https://docs.typesafe.ai/primitives/noul), [confidence](https://docs.typesafe.ai/confidence). The supplied `jev-1.13.0` Playground response proves one synthetic evaluation, not production reliability, accuracy or a latency SLA.

### Implementation status

Implemented 2026-09-19 in `apps/web/src/domain/monitoring/`: `triggers.ts` (pure trigger policy with the table above, normal sampling by stable hash), `windows.ts` (bounded window, prior-progress summary, coverage, gaps, content hash, input-budget truncation that keeps terminal outcomes), `budget.ts` (row-locked product-day ledger, per-session hourly reservations, token cap, spend cap only when `JEV_PRICE_PER_1K_*` are set), `screening.ts` (cooldown, single in-flight per journey, unchanged-window dedupe, `needs_instrumentation` deferral, `journey_end` sweep after five minutes), `evaluate.ts` (state rebuilt from the immutable window, Jev call, answer validation against the detector's questions, usage and returned model stored, transient 429/529 retried at most twice through the job queue, ambiguous failures recorded as `unknown_outcome`), `candidates.ts` (gate, grouping, distinct session/journey counts, dismiss/accept/link with audit). `providers/jev.ts` is the `POST /v1/systemone` adapter. A candidate reaches VC-01 through "Request task proposal", which starts a discovery run with `source_candidate_refs`; proposals and published plans carry the refs. Scoping rules after review (2026-09-19): `journey_instance_id` and `event_id` are client-chosen, so they identify anything only together with the observation session. Event rows have server-generated ids with `(observation_session_id, event_id)` unique; every journey query (scan, in-flight/cooldown, sweep, evaluation state rebuild) is scoped by session, and scan jobs deduplicate per session and journey. Each evaluation stores its `reservation_id`, `reserved_micros` and `estimated_input_tokens` as columns, so a transient retry reconciles the same reservation once. A window whose evaluation was refused for `product_day_cap`, `session_hour_cap` or `spend_cap` keeps its `deferred` row and is retried: on the next scan of the unchanged window, and by the sweep once a new UTC day (or the next hour for the session cap) has started. `input_tokens_cap` and `needs_instrumentation` are not retried automatically. The ledger's `evaluations` counter is intentionally never decremented on failure: a call that reached the provider counts against the daily call cap whether or not it produced usable answers.

Verified: unit tests for every module above (35 cases) and a browser e2e (`e2e/monitoring.spec.ts`) that walks collection-off → policy on → manual detector → permission-gated session → help journey → scan → stubbed evaluation → candidate on the Monitoring view → discovery run with provenance. Real Jev verified 2026-09-19 with `e2e/live-monitoring.spec.ts` (`LIVE_PROVIDERS=1`) on the instrumented Excalidraw clone: a `help_request` window reached `POST /v1/systemone`, returned model `jev-1.13.0` (1125 input / 174 output tokens), and the answers validated against the fixture detector (`ux_friction_observed` noul 0.84, `evidence_sufficiency` insufficient, `problem_category` other_or_uncertain, `targeted_research_warranted` 0.61). Because evidence was insufficient the gate created no candidate, which is the intended outcome for a lone help-dialog open. Not yet verified: calibration of thresholds on labeled journeys and precision/recall reporting; `JEV_PRICE_PER_1K_*` is unset locally, so the spend cap is not enforced there (token caps are).

Additional acceptance criteria:

- Replay fixtures cover ordinary reading, focus loss, successful recovery, missing events, genuine failed attempts and explicit help.
- Cooldowns, concurrent workers, duplicated batches and terminal flushes never bypass caps or duplicate candidate counts.
- Missing evidence, incompatible build and provider failures are distinguishable from no observed friction.
- Contradictory completion evidence remains visible; overlapping windows never inflate prevalence.
- High Jev scores alone create no issue, repair job, participant penalty or human-validation label.
- Before rollout, report precision/recall on labeled held-out journeys and false-positive rates for normal behavior; no accuracy claims from a single sample.


## Acceptance criteria

- A real manifest produces a finding with resolvable evidence references or an explicit no-finding outcome.
- Invented transcript IDs/quotes are rejected before publication.
- Replaying the same completion callback creates at most one issue for a finding.
- A related existing issue receives new evidence instead of a duplicate where the mapping is clear.
- Public GitHub output contains no raw personal/session data.
- `issues_only` produces no code-change or retest side effects.
- The dashboard distinguishes partial evidence, preliminary findings and repeated observations.

## Open decisions / future changes

- [ ] Verify Devin artifact/structured-output integration and whether selected video evidence can be consumed.
- [ ] Tune matching thresholds against a labeled set of duplicate and distinct findings.
- [ ] Choose aggregation timing: per session initially, with an explicit study-close pass later.
- [ ] Support export to other issue trackers through an adapter.
- [ ] Confirm whether installation-token `/search/issues` remains supported for every GitHub App
  installation type; retain repository pagination fallback for 403/422 responses.
- [ ] Decide whether to persist `installation_id` in `repo_binding` instead of resolving it per publication.
