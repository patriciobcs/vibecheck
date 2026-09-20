# VC-01 · Product onboarding and test planning

Status: In progress — first slice implemented (see [Implementation status](#implementation-status))
Depends on: [shared contracts](README.md), [VC-06](06-owner-dashboard-and-orchestration.md)
Output consumers: VC-03 screening and [VC-02](02-test-delivery-and-recording.md)

## Goal

Let an owner describe and connect a product, have an agent identify useful UX challenges, and choose which ones to test. Publish a precise JSON study plan rather than a free-form instruction to the next service.

## Owner experience

1. From the landing page, choose **Add your project**. Step 1 is account sign-in; Step 2 at `/products/new` requires only project name and a GitHub repository URL. Validate an HTTPS `github.com/owner/repo` link (optional `.git` suffix/trailing slash); reject branch/file links, credentials, queries and other hosts. Persist the normalized owner/repo binding with `issues_enabled: false`. A link records the code location; it does not verify existence, install an app or grant GitHub access. A live app URL, description, audience, language, origin override, release notes, complaints and journeys live in a collapsed optional section. English is the default. When a live URL is supplied, derive its origin without path/query for the SDK allowlist; otherwise leave origins empty unless explicitly supplied.
2. A signed-in user with no memberships gets a private workspace and owner membership when the first project is saved, in the same transaction. Concurrent submissions reuse that workspace. Existing owners/admins/researchers use their authorized workspace; multiple writable workspaces require an explicit choice. Viewers cannot create projects or acquire elevated access. Account email is not collected again in the project form.
3. A repository-only project is saved as `needs_setup` with `app_url_required`. Its dashboard explains that the project is saved, disables discovery and offers a live app URL form. Owners/admins/researchers can add a public HTTP(S) URL later; server-side tenant/role and destination checks apply, and empty origins are derived then. This setup action does not retarget an existing live app. Both discovery creation/processing and study publication reject missing app URLs. Once configured, run discovery and choose a proposed study. With no release notes, discovery proposes exploratory tasks or reports `cannot_assess` / `needs_setup` honestly. Saving does not install the SDK, enable monitoring, run an agent or publish a study automatically.
4. When GitHub issues or repairs are needed, configure GitHub access through an installation scoped to selected repositories. The installation wizard is not yet implemented; onboarding reports the saved link as unverified with writes off. The shared `repo_binding`
   is validated as either `{ provider: "github", owner, repo, default_branch?, baseline_commit_sha? }`
   or `{ provider: "local", path, baseline_commit_sha? }`. A URL-only research setup remains usable,
   but repair modes are disabled until repository setup passes.
5. For repair setup, identify the base branch, preview/build workflow, startup and test commands, test data reset command, supported origins and credentials via secret references.
6. Display proposed tasks as cards: neutral participant task, optional agent-designed scenario, research question, rationale, supporting candidates, eligibility, estimated duration and confidence/uncertainty.
7. Owner edits/selects cards and chooses delivery, capture, recruitment and automation settings. Publish selected studies. Default to one task per study in the MVP.

The optional section preserves richer onboarding without requiring founders to understand research inputs before saving. `ProductConfig` v2 permits a null URL and marks its output with `schema_version: "2.0"`; unversioned API input with a live URL is still accepted. Product API responses also identify version 2.0. Migration `0012_github_onboarding.sql` drops only the URL's NOT NULL constraint; existing products keep their URLs and bindings. Origin derivation is specific to UI setup and does not widen explicit API allowlists. The form validates on the server, retains submitted values on errors and disables resubmission while saving.

Email is collected only for account authentication. Already-signed-in users proceed to project setup and see their account identity. Demo entry is a separate, explicit choice using a shared account, preserves the owner's return path and labels the project form as a demo workspace. Local email mode says that no email is sent and opens the test inbox. Production email sign-in requires Resend configuration; without it, the page states that email sign-in is unavailable instead of pretending to deliver a link.

## Agent behavior

Discovery runs through a provider adapter. Two providers exist: `devin` uses a Devin analysis session with a structured-output schema; `fixture` returns deterministic, sample-labeled proposals for local development and tests and is never presented as agent inference. Use a Devin analysis session to inspect authorized product/repository context. This stage is read-only with respect to the target product: no issue creation or code mutation. Prioritize changed journeys, observed friction and high-value actions with weak evidence. A repository scan alone cannot establish that users struggle.

Return structured proposed tasks with evidence references, a rationale and an optional neutral scenario. Distinguish a passive candidate from a hypothesis, and observed data from model inference. Prioritize supplied release notes when present; their absence must not restrict discovery to an empty feature list. Use the app URL and any description, audience or journeys for exploratory planning. If there are no events, propose exploratory studies and label them accordingly. Do not invent traffic, complaints or observed failures. If no registered success/eligibility rules fit, return `cannot_assess` with the missing setup rather than assigning an unrelated demo rule.

Task prompts describe realistic goals without naming the control to click or suspected problem. Do not ask participants to be negative, design a solution, or prove a predefined hypothesis. Keep researcher-only expected outcomes and validator rules out of the participant prompt.

Scenarios contain a short introduction, one to seven present-tense imperative steps, optional think-aloud cues and an estimated duration. Scenario wording must not name controls or leak the suspected problem. Fixture scenarios are sample data and are labeled as such. Publishing snapshots the optional scenario into the immutable `StudyPlan`.

Provide `cannot_assess` and `needs_setup` outcomes. Validate agent JSON; make a bounded correction request on malformed output and preserve the raw response for restricted debugging. Never interpret malformed output as permission to publish.

Output is malformed when it violates the schema, echoes the wrong `discovery_run_id` or `source_revision`, exceeds `MAX_PROPOSALS` (3), or references a `success_rule_ref` / `eligibility_rule_ref` outside the registered rule set (`packages/contracts/src/rules.ts`). The prompt lists the allowed rule identifiers so the agent cannot substitute prose. Exactly one correction request is made; a second malformed response fails the run without proposals.

A remote agent cannot reach an owner's laptop: a `localhost` target produces `needs_setup` from the `devin` provider. Local demos therefore use the `fixture` provider; Devin discovery requires a publicly reachable URL or a deployed preview.

## Configuration

| Field | Default / behavior |
| --- | --- |
| launch_policy | `owner_selects`; optional `auto_launch` under saved limits |
| automation.mode | `draft_pr` for the demo target; production tenants may choose `issues_only`. `draft_pr` and `prototype_and_retest` require repository setup before repair jobs run |
| audience | Owner-defined product-relevant criteria, not inferred sensitive traits |
| recruitment.source | `direct_link`, `embedded`, or `marketplace` |
| permitted_origins | Explicit web origins; editable by admins |
| automatic limits | Allowed journeys, concurrent studies, invitation frequency, participant count and budget |
| repository mutation scope | Owner-authorized repo/fork and allowed paths; no upstream target by default |
| retention/capture | Snapshotted from product settings into each published study |

`auto_launch` is opt-in and operates only within configured scope. A global pause immediately prevents new invitations and repair jobs. Tightening a policy must also gate queued actions, even when earlier studies carry a broader snapshot.

## Inputs and outputs

Input: `ProductConfig`, authorized source references and an optional baseline build. Suggested endpoints: `POST /products`, `POST /products/:id/discovery-runs`, `GET /discovery-runs/:id`, `POST /studies`.

`source_revision` is the SHA-256 of the stored product configuration at run creation; the agent must echo it verbatim so stale output cannot be attached to a newer configuration.

Agent output shape:

```json
{
  "schema_version": "1.0",
  "discovery_run_id": "discovery_example",
  "source_revision": "context_revision_1",
  "proposals": [{
    "task_id": "task_capture_ideas",
    "research_question": "Can a user capture several short ideas on an existing board?",
    "participant_prompt": "Add the ideas listed in your task to the board so your teammates can read them.",
    "rationale": "Release notes list a newly shipped way to capture ideas; no human evidence exists for it yet.",
    "evidence_refs": ["release_note_example"],
    "evidence_type": "reported",
    "eligibility_rule_ref": "eligible_whiteboard_users_v1",
    "success_rule_ref": "stickynote_capture_v1",
    "uncertainties": ["No baseline human test has been completed."]
  }]
}
```

At publication resolve exact dates, environment, fixture and commit. Emit `study.published` using the complete StudyPlan contract in the index. The simplified discovery prompt above must be concretized before a participant sees it. URLs must pass server-side destination rules before any backend fetch; block private-network/metadata endpoints (loopback, RFC 1918, link-local, `0.0.0.0/8`, `100.64.0.0/10`, IPv4-mapped IPv6 equivalents) and recheck redirects. `ALLOW_LOCAL_TARGETS=true` is an explicit development-only opt-in for loopback targets; a failed check places the product in `needs_setup` with the reason rather than rejecting the create.

Publish requests carry an idempotency key scoped to the tenant. The first publish returns `201` with the study, plan and `study.published` event; a replay returns `200` with the identical stored response. Concurrent replays are resolved by a unique constraint inside the publish transaction, not by a pre-read.

## First simulation run

The first end-to-end exercise of this spec runs against the demo target selected in [VC-07](07-demo-target-app.md). It simulates a product Seamless UX has already been monitoring, so discovery is scoped to recently shipped features instead of the whole application.

Simulated `ProductConfig` inputs, all labeled as sample material with their provenance:

| Input | Value |
| --- | --- |
| URL / origins | Locally served build of the demo fork |
| Repository | Team-owned fork, pinned to the VC-07 baseline commit |
| Release notes | The scoped feature list in VC-07, taken verbatim from upstream commit subjects |
| Support complaints | Sample, clearly labeled; no real user reports exist |
| Product events | None; exploratory proposals must be labeled accordingly |

Expected discovery output: three proposals, one per scoped feature, each naming a goal without naming the control. The owner publishes one. Concretely, for the first study:

- `task_capture_ideas` — capture several short ideas on an existing board; success rule `stickynote_capture_v1`, satisfied when the persisted scene contains at least three idea elements with non-empty text.
- `task_match_colors` — make several shapes share an existing shape's fill; success rule `fill_match_v1`, satisfied when the target element IDs carry the reference background color.
- `task_navigate_board` — bring an off-screen region of the board into view; success rule `viewport_reached_v1`, satisfied when the persisted scroll position covers the target region.

Success rules are evaluated by the Seamless UX runner against a post-session snapshot of persisted scene state, never by the agent and never from claims made inside the page. Publishing this run must not require any capability listed as deferred in the MVP scope.

## States and failures

Product: `draft → connecting → ready` or `needs_setup`.
Discovery: `queued → inspecting → proposed`, or `failed/cancelled`.
Study: `draft → published → recruiting`; later lifecycle belongs to VC-06.

Discovery jobs are retried with backoff; a non-final failure returns the run to `queued`, and only a terminal failure marks it `failed` with the error. Repo access failure must not prevent URL-only research. An inaccessible app produces a setup request, not fabricated task recommendations. Editing a published plan creates a new immutable revision; existing sessions stay attached to the original. Deduplicate repeated publish requests.

## Continuous detector authoring and candidate intake

Implemented 2026-09-19: `POST /api/owner/products/:id/detectors` publishes a hand-authored detector (`mode: manual`) or queues generation (`mode: generate`, provider `fixture` or `devin`, job `detector.generate`); `DetectorDefinitionSchema` and `validateDetectorQuestions` in `packages/contracts` enforce the base questions, `other_or_uncertain`, stand-alone instructions and size limits; generated output must also pass `GeneratedDetectorSchema` and lists `missing_instrumentation`, which yields `needs_instrumentation` instead of activation. A new observed build marks older detectors `stale`. Candidate intake: discovery runs accept `source_candidate_refs`; the Devin prompt includes the candidates and the fixture provider echoes the refs on its first proposal. Original intent: discovery also emits immutable `DetectorDefinition` records from the shared contract. Devin reads authorized code, routes, semantic actions, success rules and known instrumentation. It maps each journey to observable progress, success, failures and help requests. Distinguish existing telemetry from instrumentation that still needs implementation; inactive detectors with missing signals return `needs_instrumentation`. Read-only discovery cannot silently edit the target app to add events. Verified 2026-09-19 with a real Devin session (`provider: devin`, journey hint "share a drawing via a live collaboration link", build `vibecheck-demo`): Devin returned a six-question detector in about 40 seconds that passed `GeneratedDetectorSchema` and was stored as `needs_instrumentation`, because the clone emits only `journey_start`, `progress` and `help_request` and the share flow needs `action_attempt`, `action_result`, `completion` and `exit` events. Nothing was activated; the missing events are listed on the detector's status reason.

Generate Jev `questions` JSON using supported `noul`, `choice` and `score` types. Every instruction must stand alone: question keys are not a substitute for instructions, and questions cannot depend on another answer. Include evidence sufficiency, observable friction, research warranted and an `other_or_uncertain` category. Known goal and outcomes must come from declared tasks or instrumented rules; inferred intentions are labeled. Silence, slow reading and inactive tabs cannot establish frustration or dishonesty.

Validate schema, required event coverage, question size and criteria before publishing a detector. Store code/build identity, source references, instrumentation version and generation provenance. Exercise labeled success, friction, normal hesitation and missing-data fixtures before activation. Enable only within the owner's monitoring policy. New builds require compatibility verification; otherwise pause the old detector as stale rather than silently applying it to changed controls.

VC-03 research candidates become optional discovery inputs. Devin converts their suspected problems into neutral task proposals, with `source_candidate_refs`, supporting evidence and uncertainty. Do not expose the suspected failure or Jev score to participants. Owner selection remains the default; `auto_launch` uses existing audience, invitation, concurrent-study and spending limits. Repeated detector output updates a candidate instead of launching duplicate studies. A candidate can be dismissed or produce no useful task.

Additional acceptance criteria:

- Unsupported/malformed question schemas and missing telemetry prevent detector activation.
- A deployment with incompatible instrumentation marks its detectors stale.
- Candidate-derived studies preserve source references and neutral wording.
- Duplicate candidate deliveries cannot create duplicate studies or bypass launch policy.


## Acceptance criteria

- An owner can connect a product, inspect proposed tasks and publish only selected tasks.
- A first-time signed-in founder can save a project with only name and a GitHub repository link, receives a private owner workspace, and lands on the saved project with adding a live app URL as the next research step.
- The default form shows two project inputs; optional context is keyboard-accessible through a disclosure. Multiple existing workspaces add a required authorized workspace choice.
- A missing app URL never becomes a GitHub URL or placeholder research target. Research is blocked until one is added by an authorized user. The app origin is derived correctly for URLs containing paths, queries or ports; an explicit origin override is preserved and destination checks still apply.
- Saving a repository link normalizes the owner/repo, keeps writes disabled and never claims that GitHub access has been authorized.
- Signed-out, signed-in and shared-demo users reach the same project form with clear account state; return paths cannot redirect to an external site.
- Invalid input preserves the form values and creates no workspace/product. Concurrent first submissions create only one owner workspace. Existing viewer and cross-tenant restrictions remain enforced.
- Minimal context reaches exploratory discovery without fabricated release notes; no matching registered rules remains an explicit limitation.
- A second tenant cannot read or modify that product or its source context.
- Sample complaint data is labeled in the task rationale and dashboard.
- The agent can return no useful proposal without causing downstream work.
- A published plan contains concrete dates, baseline identity, eligibility, capture and automation policy; all consumers validate the same schema.
- URL-only projects cannot trigger repo writes; auto-launch cannot exceed saved limits.
- A duplicate publish request creates one study event and one recruitment operation.

## Implementation status

Implemented (ported into the `apps/web` monorepo on 2026-09-19): API-key tenant authentication (`Authorization: Bearer`, hashed at rest) or the signed-in owner session, `POST/GET /api/products`, `POST /api/products/:id/discovery-runs`, `GET /api/discovery-runs/:id`, `POST/GET /api/studies`, both discovery providers (`fixture`, `devin`), malformed-output correction (exactly one), durable processing on the shared `jobs` table, idempotent publication writing `study_revisions` (provenance `vc01`) and the `study.published` outbox event, and the owner UI (`/products`, `/products/new`, `/products/:id` with runs and proposal cards, `/products/:id/publish`, `/studies/:id`). A published study is immediately claimable through VC-02's channels because both sides validate the same `StudyPlan` schema in `packages/contracts`. Verified by unit/integration tests and a browser e2e (`e2e/discovery.spec.ts`) that connects a product, runs fixture discovery, publishes a proposal and reads it back.

Not yet implemented, so the corresponding acceptance criteria are open: GitHub installation setup
wizard UX, `launch_policy` / `auto_launch` and automatic limits, editing proposal cards before
publication (only `participant_prompt` and `time_limit_seconds` are overridable), study revisions
after the first, and the `recruiting` transition, which belongs to VC-02. The product binding shape
is validated at persistence boundaries and consumed by VC-03 publication.

The email adapter supports Resend for live sign-in and a development-only test inbox; real provider delivery still requires deployment credentials and a verified sender and has not been verified with a live call. Explicit shared-demo entry uses its own inbox context and sends no email. Saving arbitrary projects is supported, but registered success/eligibility rules remain demo-specific; a useful publishable study for an arbitrary app is not guaranteed by completing this form. Adding the missing live URL after creation is implemented; general context editing and changing an existing research target remain unimplemented.

## Open decisions / future changes

- [ ] Devin discovery against a deployed preview of the demo target instead of the public site, so discovery and the VC-02 baseline share one build.
- [ ] GitHub App scope and setup wizard UX after provider verification.
- [ ] Release-trigger integration versus manual release description for the first build.
- [ ] Multi-task studies and audience quotas after the one-task pipeline works.
- [ ] Calibrate generated detectors and discovery cadence against labeled journeys before broader rollout.
