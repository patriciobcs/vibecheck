# VC-05 · Retesting, notifications and PR validation

Status: Draft
Input: [VC-04](04-prototypes-and-verification.md) · Reuses: [VC-02](02-test-delivery-and-recording.md)

## Goal

Automatically recruit humans for a checked preview, run the same task, compare evidence honestly, and show on the PR whether and how its exact code version was human-tested.

## Retest policies

| Setting | Behavior |
| --- | --- |
| enabled | Derived from `prototype_and_retest`; off for issues-only/draft-PR mode |
| participant_policy | `fresh` default; `returning` or `mixed` explicitly selectable |
| source | Direct invite, embedded, or marketplace; external testing happens on the preview |
| target_count | Configurable; small demo count is exploratory, not statistical proof |
| invitations | In-app default; optional email to opted-in recipients |
| reminder_limit | Proposed one reminder per assignment; respect unsubscribe and expiry |
| study_deadline | Explicit UTC time; expiry closes recruitment with `insufficient_data` |

Returning participants can explain whether a proposed fix addresses their earlier concern, but prior exposure affects performance. Separate fresh and returning cohorts in comparisons; do not pool them invisibly.

## Workflow

1. On `preview.ready`, verify the SHA, health, expiry, policy and remaining budget.
2. Create a RetestStudy referencing the frozen baseline task/research question, comparable fixture and candidate SHA. Keep the original study and sessions immutable.
3. Select eligible participants. Fresh means no previous exposure to this task/product flow in recorded study history, not a guarantee that they have never seen the product elsewhere; record self-reported familiarity.
4. Reserve an assignment and fixture, then send an in-app/email invitation through the outbox. Avoid duplicate assignment messages.
5. Invitation contains a short neutral description, time expectation, reward, expiry and scoped link. Do not say which control moved, that the original was broken, or that the participant is expected to like the fix.
6. Run VC-02 on the preview with equivalent capture settings. Verify served build identity at session start; mark sessions non-comparable if the preview changes midway.
7. Analyze the retest through the same evidence pipeline, then generate a version-specific comparison.
8. Update the existing PR managed evidence section and dashboard. Retesting does not auto-merge the PR.

## Metrics and interpretation

Report counts and denominators: completed task, partial, failed/stuck, missing outcome and excluded sessions with reasons. Record task duration excluding documented pauses, navigation detours, assistance, perceived difficulty and qualitative observations. Missing instrumentation must remain unknown.

Compare like-for-like task revision, fixture, cohort and completion rules. Retain participant comments that contradict a favorable aggregate. Time alone does not prove improvement; an easier task, learned behavior or changed fixture can explain a difference.

For the MVP show descriptive results such as `baseline 0/1 completed; variant 1/1 completed; fresh participants; preliminary`. Do not display significant uplift, causality, general effectiveness or a universal UX score from tiny samples. Powered experiments and confidence intervals require a separately specified design.

## Validation summary

```json
{
  "schema_version": "1.0",
  "validation_id": "validation_example",
  "pull_request_ref": "pr_example",
  "candidate_commit_sha": "REPLACE_WITH_REAL_SHA",
  "study_revision": 1,
  "fixture_revision": "booking_fixture_v1",
  "functional_status": "passed",
  "human_status": "tested_preliminary",
  "outcome": "encouraging",
  "cohort": "fresh",
  "baseline": {"attempted": 1, "completed": 0},
  "variant": {"attempted": 1, "completed": 1},
  "evidence_refs": ["session_baseline", "session_retest"],
  "limitations": ["Exploratory sample; not evidence of statistical significance."],
  "generated_at": "2026-09-19T15:00:00Z"
}
```

Use separate statuses for functional checks and human evidence. Human status: `not_requested`, `pending`, `tested_preliminary`, `inconclusive`, `stale`, `unavailable`. Outcome can be `encouraging`, `mixed`, `no_observed_improvement` or `unknown`. A completed human session may reveal regression and still counts as human-tested.

## GitHub representation

Managed PR section includes linked issue/finding, tested SHA, deployment/build identity, independent check results, task/cohort/counts, outcome, limitations, authenticated evidence link and updated timestamp. Possible labels: `vibecheck:human-pending`, `vibecheck:human-tested`, `vibecheck:human-inconclusive`, `vibecheck:validation-stale`.

Never use `human-tested` to imply universally validated. The PR body states preliminary results explicitly. On a new PR HEAD, mark old results stale and remove any current-validity badge; preserve history. Re-run functional tests and create new human assignments according to the configured policy. Deletion/withdrawal of evidence recomputes summaries and removes content-dependent claims where needed.

## Failures and cancellation

Email failure retries within bounds without duplicating assignments. No testers by deadline ends as insufficient data. Preview downtime pauses invitations; expired links offer reassignment only if a healthy equivalent build exists. A participant who returns after HEAD changes must not test a stale candidate unnoticed.

When the owner disables retesting, cancel unclaimed invitations and stop new reminders. Let active sessions finish unless the environment is unsafe or access is revoked, and label resulting evidence accurately. Credits are tied to valid participation, never to favorable retest outcomes.

## Acceptance criteria

- A healthy checked preview automatically generates one eligible assignment per requested slot.
- Invitations reveal no hypothesis or expected answer, and use authenticated scoped access.
- Retest runs exactly the intended candidate/task/fixture revision.
- Fresh/returning participants and assistance are recorded and visible.
- The PR distinguishes functional pass, human participation and usability outcome.
- New code makes old human validation stale; no old badge silently applies to a new SHA.
- No response, failed task and missing data remain distinguishable outcomes.
- Development sends only to test inboxes or explicitly authorized participants.

## Open decisions / future changes

- [ ] Pick email provider and decide sender branding and opt-in flow.
- [ ] Add concurrent randomized original/variant assignment after the sequential demo.
- [ ] Define a statistically powered evaluation mode if customers need causal improvement claims.
- [ ] Decide policy for automated retesting after later PR changes and its cost cap.

