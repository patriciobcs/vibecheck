# VC-04 · Prototype generation and independent verification

Status: Draft
Input: [VC-03](03-evidence-analysis-and-github-issues.md) · Output: [VC-05](05-retesting-and-validation.md)

## Goal

Use Devin to reproduce supported findings and create working design alternatives. Verify the exact candidate independently, deploy an isolated preview when requested, and preserve evidence in a draft PR. No person is required to approve each step inside the previously authorized scope.

## Automation modes

| Mode | GitHub issue | Code/PR | Preview and human retest |
| --- | --- | --- | --- |
| issues_only | Create/update | None | None |
| draft_pr | Create/update | Devin change, independent checks, draft PR | Retest off; preview optional |
| prototype_and_retest | Create/update | Devin change, independent checks, draft PR | Deploy checked candidate and assign retest |

The demo build defaults to `prototype_and_retest` so the whole loop is exercised (see VC-01 configuration); `issues_only` remains the recommended default for real tenants. The owner can select another mode at product or study level. Study settings snapshot the choice. Raising automation for an existing issue requires a deliberate owner action; lowering it or pausing must gate queued side effects immediately. No mode authorizes automatic merging or production deployment.

## Repository adapter and prerequisites

Record repository owner/name, installation reference, base branch/SHA, editable paths, setup/start/build/test commands, test fixture reset command, expected services, health check and deployment adapter. Credentials are secret references, never prompt text or client values.

Research-only access does not imply write permission. A setup probe must demonstrate the baseline starts, fixtures load and baseline regression checks pass. If baseline behavior is already broken, distinguish expected reproduction failure from unrelated baseline failures.

Use a branch/worktree in an authorized repo by default. A GitHub fork can be configured where permissions and CI support it. Validate fork secret restrictions and deployment access; do not assume workflows on forks inherit secrets. Separate stateful resources by variant/assignment so tests cannot interfere.

## Repair workflow

1. Persist a RepairRun bound to finding, issue, study revision, automation snapshot and baseline SHA.
2. Create a Devin API session with the neutral task, observed evidence, actual reproduction steps, experiment proposal, allowed paths and functional invariants.
3. Devin reproduces the current behavior in its environment, proposes/implements the bounded change and produces a branch/commit artifact. If evidence cannot be reproduced, retain that limitation instead of claiming success.
4. Resolve the candidate SHA through GitHub. Do not trust an agent's text claim that a PR or build exists.
5. Run the platform-owned validator against that SHA in a separate runner. Persist runner results and validator version outside editable app files.
6. On failure, send structured diagnostics back to Devin. A revised candidate gets fresh checks. MVP proposal: `max_repair_attempts: 2` means two total candidate attempts, including the initial candidate (one retry). Keep that meaning consistent across contracts, settings and code.
7. When required checks pass, create/update a draft PR and deploy a preview when the mode requires it. Bind both to the tested SHA.
8. After deployment, run a health check and smoke test on the deployed URL. Only then emit `preview.ready` to VC-05.

## Independent validation

Required checks are application-specific and must exist before accepting the agent output. Devin may add helpful tests, but cannot edit or disable the independent acceptance suite, runner, required checks or outcome definitions. A trusted adapter maps each test result to the tested commit and fixture.

Generic checks: install/build, app readiness, primary journey smoke tests, permitted diff scope, secret scan, and authorization regression checks appropriate to the change. Reject unexplained dependency or environment modifications outside scope rather than quietly expanding it.

Whiteboard example: the elements the participant created persist across a reload with their content intact, a color change affects only the intended element, undo restores the previous state, and export still produces a non-empty file. Functional checks alone cannot establish easier usability. See VC-07 for the full check list bound to the selected target.

## Repair run contract

```json
{
  "schema_version": "1.0",
  "repair_run_id": "repair_example",
  "finding_id": "finding_example",
  "issue_ref": "github_issue_example",
  "mode": "prototype_and_retest",
  "base_commit_sha": "REPLACE_WITH_REAL_SHA",
  "candidate_commit_sha": "REPLACE_WITH_REAL_SHA",
  "devin_session_ref": "provider_session_example",
  "variant_id": "variant_a",
  "attempt": 1,
  "validator_version": "excalidraw_acceptance_v1",
  "checks_ref": "checks_example",
  "preview_ref": "preview_example",
  "pull_request_ref": "pr_example",
  "status": "preview_ready"
}
```

Preview fields: URL, candidate SHA, build/deployment ID, health status, fixture revision, access policy, created/expiry timestamps, cleanup status. URLs are given only to assigned participants and authorized owners.

## Budget, concurrency and failures

- Configure maximum wall time, retries, variants and provider spend/cap where supported; do not invent provider-side hard limits. Track local budget estimates and reconcile usage when available.
- One variant per finding for MVP. Later variants must have distinct hypotheses and isolated builds; never select the most attractive screenshot as a proven winner.
- Duplicate completion messages must not create duplicate sessions, PRs or deployments. Persist provider IDs before polling; reconcile ambiguous create responses instead of blindly retrying billable actions.
- If branch HEAD changes, validate the new SHA before deployment. If the base branch advances, do not silently rebase and reuse old evidence. Create a new candidate and invalidate earlier functional/human badges as appropriate.
- Setup/auth/rate-limit failures have bounded retry and visible causes. Budget exhaustion produces `blocked`, preserves issue and artifacts, and starts no additional work.
- Failed variants stay private and cannot be assigned to participants. Clean up expired previews and credentials without deleting audit references.

## States

`queued → preparing → reproducing → implementing → validating → deploying → preview_ready`

Alternative paths: `validating → retrying → implementing`; `validating → draft_pr_ready` for no-retest mode; any active state → `blocked/failed/cancelled`.

A draft PR may be retained for a blocked run, clearly marked with failed checks. Its existence is not equivalent to a successful repair.

## Acceptance criteria

- A finding triggers a real API-created Devin session and a retrievable code artifact.
- Required independent checks run on the candidate SHA, and changing the check files cannot bypass them.
- A genuine failed check can return to Devin and a later candidate is separately verified.
- No preview is assigned until deployment health and required checks pass.
- Issues-only mode never enters this pipeline; draft-PR mode does not invite retesters.
- Replay of a worker job creates no duplicate side effects.
- Exhausted retries preserve the issue and show a blocked reason.
- No run merges or changes production automatically.

## Open decisions / future changes

- [ ] Verify actual Devin authentication, session lifecycle, artifact retrieval and cancellation behavior.
- [ ] Select preview provider after reproducing the target app environment.
- [ ] Define the first supported repository adapter; general stack detection comes later.
- [ ] Multi-variant execution and owner-controlled production rollout are future scope.

## Implementation status

VC-04 slice 1 implements the tenant-scoped RepairRun, CheckRun and Preview
records, durable `repair.run` jobs, the state machine, retry accounting and
fixture adapters for repair, validation and preview. The fixture provider
returns a deterministic candidate-shaped response; it does not modify a
repository or claim a real PR or deployment. The Devin provider uses the
existing session API and structured output contract. A repair run has one
`variant_a` per finding, and `max_repair_attempts` counts the initial candidate
and all retries.

The fixture validator currently enforces only allowed diff paths. The
production Excalidraw acceptance validator and Vercel deployment adapter remain
pending for slice 2. The demo policy currently owns allowed paths and the five
VC-07 invariants; moving those values onto the repository binding is an open
decision. GitHub App credentials request Issues write, Contents read and Pull
requests write permissions for the repository adapter.

Blocked reasons include `not_reproduced`, `out_of_scope`, `checks_failed`,
`preview_unhealthy`, and `github_permissions`; missing base/candidate artifacts
are terminal failures. Draft PRs use `Refs #N` rather than auto-closing issue
references, and include functional checks separately from human evidence.
