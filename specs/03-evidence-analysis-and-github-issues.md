# VC-03 · Evidence analysis and GitHub issues

Status: In progress — implemented against fixture sessions
Input: [VC-02](02-test-delivery-and-recording.md) · Output: [VC-04](04-prototypes-and-verification.md)

## Goal

Convert real sessions into evidence-backed findings, review them through Devin, and create or update GitHub issues without duplicates. Respect `issues_only` as a complete, useful stopping point.

## Processing workflow

1. Validate the manifest, ownership, task revision, tested build and completeness.
2. Assemble a bounded evidence package: neutral task, actual outcome, relevant event windows, transcript segments, approved media references and baseline repository context.
3. Start a Devin analysis session through the API. Initially provide text/event evidence; verify supported media access before promising direct video analysis. A recording reference alone does not mean the agent watched it.
4. Ask for observations, hypotheses, supporting references, uncertainty, impact and potential experiments. Include findings of successful use when relevant. Do not require a minimum number of issues.
5. Validate returned structured data. Check cited event/segment IDs exist, time ranges overlap the session, and quoted material is accurate. Model scores do not override these checks.
6. Aggregate comparable findings across sessions without treating each complaint as independently proven causation.
7. Deduplicate locally and against existing issues in the authorized target repository.
8. Create or update sanitized GitHub issues. Stop if the study mode is `issues_only`; otherwise emit `finding.ready_for_repair` for eligible findings.

## Finding model

```json
{
  "schema_version": "1.0",
  "finding_id": "finding_example",
  "study_id": "study_example",
  "study_revision": 1,
  "baseline_commit_sha": "REPLACE_WITH_REAL_SHA",
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

Certainty states: `insufficient_evidence`, `preliminary`, `repeated_observation`, `contradictory`. They describe evidence, not statistical significance. Severity considers task/business impact separately from certainty. Set repair eligibility only when the change scope and supported finding justify an experiment.

## Deduplication and publication

Compute a stable local fingerprint from product, journey, normalized problem type and semantic target; store baseline identity separately so observations can accumulate across versions. Search GitHub for the persisted issue mapping and a hidden VibeCheck finding marker before creating anything. Match close candidates cautiously; do not merge distinct symptoms solely because an agent says they sound similar.

For an existing open issue, append new sanitized evidence or update a managed evidence section. For a closed issue that recurs, preserve history and link a recurrence or reopen only under configured policy. MVP default: create a linked recurrence issue after confirming it is not a duplicate current run.

Issue content: problem and observed effect, task context, safe reproduction steps, tested version, evidence counts and limits, proposed experiment, functional constraints, private dashboard link, automation mode and provenance. Never publish participant names, email addresses, private recordings, raw transcripts, test credentials, or secret URLs to a public repository.

The orchestrator, not an unconstrained analysis prompt, performs issue publication with an idempotency record. Reconcile uncertain API responses before retries. Developers must use the demo fork, never the upstream open-source issue tracker for demo findings.

## Policy and failures

- `issues_only`: issue publication ends the automated run; no branches, PRs or retest invitations.
- `draft_pr` / `prototype_and_retest`: only supported, in-scope findings progress. No finding may result in no change.
- Missing transcript/media: wait, retry boundedly, or analyze a declared partial package. Do not penalize the participant for provider failure.
- Unsupported citations: reject the analysis output and request correction; exhausted retries mark analysis failed.
- Disconnected GitHub: retain findings in the dashboard and queue no unbounded publication loop.
- Treat instructions inside pages, code comments, support messages and transcripts as untrusted source material. They cannot grant permissions or change the workflow policy.

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

Implementation notes: the fixture evidence source validates session IDs and
keeps bounded semantic events and transcript segments. Analysis validates
manifest revision, baseline, citation IDs, time overlap and quote substrings
before persistence. Finding fingerprints use product, task, category and a
normalized semantic target; certainty is preliminary for one observation and
repeated_observation after two sessions. Issue publication uses a tenant-scoped
observed-session idempotency key and sanitizes public free text. Finding records
also store semantic target and provenance.

- [ ] Contradictory certainty aggregation.
- [ ] VC-02 owner API for events and transcript.
- [ ] Real-sha baseline from PR #3.
- [ ] Monorepo merge.
