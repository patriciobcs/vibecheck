# VC-05 · Experiment summary for the product team

Status: Draft
Input: [VC-03](03-evidence-analysis-and-github-issues.md) findings, [VC-02](02-test-delivery-and-recording.md) sessions and participation events · Consumed by: [VC-06](06-owner-dashboard-and-orchestration.md)

## Goal

Turn the sessions of one experiment into a single, honest summary the product team can act on: who was invited and who completed the task, what was observed across participants, how sure we are, and what is being done about it (issues, draft PRs). The summary is per experiment (one published study revision) across multiple participants; it is never a per-participant report.

Human retesting of code candidates on previews (the former VC-05 scope) is deferred; see "Deferred: retesting" at the end. Nothing in this spec asks a participant to test a candidate build.

## Scope boundary

The SDK invitation popup, participant dialog, scenario rendering, screen/voice recording, upload, and Jev monitoring pipeline are implemented in-repo under VC-02 and the monitoring domain. VC-05 consumes their persisted rows and contracts:

| Direction | Contract | Owner |
| --- | --- | --- |
| VibeCheck → SDK | `study.published` event and `GET /api/studies/:id` (immutable plan with the participant-facing scenario) | VC-01 |
| SDK → VibeCheck | `POST /api/studies/:id/participation` (external-channel-only participation additions) | VC-05 (this spec) |
| SDK → VibeCheck | `SessionManifest` + events/transcript (`session.upload_verified`) | VC-02 → VC-03 |
| Jev → VibeCheck | persisted `research_candidates` and `jev_evaluations` | VC-03/06 monitoring and summary context |

## Participation events

Persisted VC-02 invitation/assignment/session rows are the primary funnel source. Because `invitation_deliveries` does not carry `study_revision`, `invited` uses the revision-scoped assignment count. `participation_events` remains supported only for external channels; events whose session is null or does not match a persisted session are deduplicated by participant and kind and added as an overlay. Events are idempotent by `event_id`; unknown participants are opaque ids and no personal data is accepted.

```json
{
  "schema_version": "1.0",
  "event_id": "evt_example",
  "study_id": "study_example",
  "study_revision": 1,
  "participant_ref": "participant_opaque",
  "kind": "invited",
  "occurred_at": "2026-09-19T10:00:00Z",
  "session_id": null
}
```

`kind` ∈ `invited`, `accepted`, `dismissed`, `started`, `completed`, `abandoned`. `session_id` is required for `started`, `completed` and `abandoned` and must match the manifest later uploaded through VC-02. A participant can appear once per kind per study revision; replays are ignored. Missing funnel data is reported as unknown, never inferred from session counts.

## Summary generation

1. Trigger: every `analysis.completed` for the study, every `participation` event of kind `completed`/`abandoned`, and an explicit owner request. Generation is a durable `summary.generate` job with one queued/running job per study revision; input changes can schedule a later run.
2. Inputs are read from persisted rows only: VC-02 assignments and sessions, external-channel participation events, findings (VC-03), analysis runs with their manifest outcome/completeness, repair runs, issue mappings and matching research candidates. `inputs_hash` includes their ids and relevant states/outcomes; an unchanged hash produces no new revision.
3. Deterministic part (computed in code, not by the agent): participation funnel, session outcomes, findings grouped by fingerprint with `observed/eligible` counts, certainty, issue and repair status per finding, exclusions with reasons (`baseline_mismatch`, `incomplete_capture`, `analysis_failed`).
4. Narrative part (agent, structured output): a headline, 3–5 key observations each citing finding ids, and limitations. The agent receives only the deterministic summary and sanitized finding fields; passive Jev candidates are not supplied as narrative evidence. It never receives media, transcripts or participant identifiers. Output is validated: every cited `finding_id` must exist in the summary; counts in the text are not trusted and the UI renders numbers from the deterministic part.
5. The summary is stored as an immutable `ExperimentSummary` revision; the latest is selected by revision ordering. Older revisions stay readable.

Provider adapters: `fixture` (deterministic narrative for tests and demos, labeled) and `devin` (reuses the VC-01/03 Devin client and structured-output schema).

## Experiment summary contract

```json
{
  "schema_version": "1.0",
  "summary_id": "summary_example",
  "study_id": "study_example",
  "study_revision": 1,
  "revision": 2,
  "status": "summarized",
  "baseline_commit_sha": "REPLACE_WITH_REAL_SHA",
  "participation": {
    "invited": 12,
    "accepted": 5,
    "dismissed": 7,
    "started": 5,
    "completed": 3,
    "abandoned": 2,
    "unknown": false
  },
  "sessions": {
    "eligible": 3,
    "excluded": [{ "session_id": "session_example", "reason": "incomplete_capture" }],
    "outcomes": { "completed": 1, "stuck": 1, "gave_up": 1, "withdrew": 0, "unknown": 0 }
  },
  "themes": [
    {
      "finding_id": "finding_example",
      "title": "Toolbar: sticky note tool is hard to discover",
      "category": "discoverability",
      "observed_session_count": 2,
      "eligible_session_count": 3,
      "certainty": "repeated_observation",
      "impact": "high",
      "issue_ref": { "provider": "github", "repo": "owner/repo", "number": 4, "url": "https://github.com/owner/repo/issues/4" },
      "repair_status": "queued"
    }
  ],
  "narrative": {
    "headline": "Participants struggled to find the sticky note tool",
    "observations": [
      { "text": "Two of three participants opened the shape menu before finding the sticky note tool.", "finding_ids": ["finding_example"] }
    ],
    "limitations": ["Three sessions; exploratory, not statistical evidence."]
  },
  "provenance": "human_session",
  "inputs_hash": "sha256_example",
  "generated_at": "2026-09-19T15:00:00Z"
}
```

Themes carry the current repair-run status for their finding, or `null` when no repair run exists. Repair-run identifiers, statuses, and update timestamps are included in `inputs_hash`, so a repair state change produces a new summary revision. `status`: `collecting` (no eligible session yet), `summarized`, `insufficient_data` (deadline passed with fewer eligible sessions than `recruitment.target_count` and at least one finding absent), `failed` (agent output invalid after one correction request; the deterministic part is still stored). `provenance` is the strictest provenance among the included sessions: any fixture or simulated session makes the whole summary `fixture`/`simulated_session` and the UI labels it as sample data.

An optional `jev_screening` object is labeled `passive_signal` and contains source candidate references plus matching candidate category, target, observation-session count and lifecycle state. It is passive context, not human evidence.

## Interpretation rules

Report counts with denominators. Small samples are exploratory; do not display significance, uplift, satisfaction scores or a universal UX score. A summary with contradicting sessions keeps the contradiction visible (`certainty: contradictory`). Missing instrumentation stays `unknown`. The summary must not name, quote verbatim or otherwise identify a participant; observations paraphrase.

## Visibility and sharing

The summary is available to the product team through the tenant-scoped dashboard and `GET /api/studies/:id/summary`. Sharing beyond the tenant is a later option: a signed, expiring read-only link to the summary only (no media, no transcripts). Public visibility or per-user visibility inside the app is recorded as an open decision.

## Acceptance criteria

- Every completed analysis or participation change produces at most one new summary revision; identical inputs produce none.
- Funnel and outcome numbers come from persisted events and manifests, never from agent text.
- Every narrative observation cites at least one existing finding id; invalid output is stored as `failed` without hiding the deterministic part.
- Sample/fixture inputs make the summary visibly labeled as sample data.
- The summary contains no participant identifiers, verbatim transcript quotes, media links or session UUIDs in the narrative.
- Cross-tenant reads are denied; older summary revisions remain readable.

## Open decisions / future changes

- [ ] Participation event authentication for the SDK (shared secret vs. per-product key) — depends on spec-2's delivery design.
- [ ] Per-study-session Jev evaluation of instrumentation logs needs a journey/detector mapping for study events; not implemented.
- [ ] Share links (signed, expiring) and in-app visibility roles.
- [ ] Export (Markdown/PDF) of a summary for people without dashboard access.
- [ ] Add a persisted recruitment deadline before implementing `insufficient_data`; the current `StudyPlan` contract has `target_count` but no deadline source.

## Deferred: retesting

Automatic human retesting of a checked candidate (invite fresh participants to a preview, compare baseline vs. variant, `ValidationSummary`, PR labels `vibecheck:human-*`) is not part of the demo and is not implemented. The `prototype_and_retest` automation mode remains defined by VC-04 and stops at `preview_ready` until retesting is specified again. Guidance that still applies when it returns: separate fresh and returning cohorts, never pool them, never imply universal validation from small samples, and mark old human results stale when the PR HEAD changes.
