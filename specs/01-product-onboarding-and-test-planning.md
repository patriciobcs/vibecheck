# VC-01 · Product onboarding and test planning

Status: Draft
Depends on: [shared contracts](README.md), [VC-06](06-owner-dashboard-and-orchestration.md)
Output consumer: [VC-02](02-test-delivery-and-recording.md)

## Goal

Let an owner describe and connect a product, have an agent identify useful UX challenges, and choose which ones to test. Publish a precise JSON study plan rather than a free-form instruction to the next service.

## Owner experience

1. Create a product with name, description, URL, supported language and intended audience.
2. Connect GitHub through an installation scoped to selected repositories. A URL-only research setup remains usable, but repair modes are disabled until repository setup passes.
3. Identify the base branch, preview/build workflow, startup and test commands, test data reset command, supported origins and credentials via secret references.
4. Supply optional release notes, support complaints, known journeys and product events. Mark imported/sample material and its provenance.
5. Run discovery. Show progress and actionable connection errors.
6. Display proposed tasks as cards: neutral participant task, research question, rationale, supporting signals, eligibility, estimated duration and confidence/uncertainty.
7. Owner edits/selects cards and chooses delivery, capture, recruitment and automation settings. Publish selected studies. Default to one task per study in the MVP.

## Agent behavior

Use a Devin analysis session to inspect authorized product/repository context. This stage is read-only with respect to the target product: no issue creation or code mutation. Prioritize changed journeys, observed friction and high-value actions with weak evidence. A repository scan alone cannot establish that users struggle.

Return structured proposed tasks with evidence references and a rationale. Distinguish a signal from a hypothesis, and observed data from model inference. If there are no events, propose exploratory studies and label them accordingly. Do not invent traffic, complaints or observed failures.

Task prompts describe realistic goals without naming the control to click or suspected problem. Do not ask participants to be negative, design a solution, or prove a predefined hypothesis. Keep researcher-only expected outcomes and validator rules out of the participant prompt.

Provide `cannot_assess` and `needs_setup` outcomes. Validate agent JSON; make a bounded correction request on malformed output and preserve the raw response for restricted debugging. Never interpret malformed output as permission to publish.

## Configuration

| Field | Default / behavior |
| --- | --- |
| launch_policy | `owner_selects`; optional `auto_launch` under saved limits |
| automation.mode | `issues_only`; `draft_pr` and `prototype_and_retest` require setup |
| audience | Owner-defined product-relevant criteria, not inferred sensitive traits |
| recruitment.source | `direct_link`, `embedded`, or `marketplace` |
| permitted_origins | Explicit web origins; editable by admins |
| automatic limits | Allowed journeys, concurrent studies, invitation frequency, participant count and budget |
| repository mutation scope | Owner-authorized repo/fork and allowed paths; no upstream target by default |
| retention/capture | Snapshotted from product settings into each published study |

`auto_launch` is opt-in and operates only within configured scope. A global pause immediately prevents new invitations and repair jobs. Tightening a policy must also gate queued actions, even when earlier studies carry a broader snapshot.

## Inputs and outputs

Input: `ProductConfig`, authorized source references and an optional baseline build. Suggested endpoints: `POST /products`, `POST /products/:id/discovery-runs`, `GET /discovery-runs/:id`, `POST /studies`.

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
    "eligibility_rule_ref": "whiteboard_users_v1",
    "success_rule_ref": "stickynote_capture_v1",
    "uncertainties": ["No baseline human test has been completed."]
  }]
}
```

At publication resolve exact dates, environment, fixture and commit. Emit `study.published` using the complete StudyPlan contract in the index. The simplified discovery prompt above must be concretized before a participant sees it. URLs must pass server-side destination rules before any backend fetch; block private-network/metadata endpoints and recheck redirects.

## First simulation run

The first end-to-end exercise of this spec runs against the demo target selected in [VC-07](07-demo-target-app.md). It simulates a product VibeCheck has already been monitoring, so discovery is scoped to recently shipped features instead of the whole application.

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

Success rules are evaluated by the VibeCheck runner against a post-session snapshot of persisted scene state, never by the agent and never from claims made inside the page. Publishing this run must not require any capability listed as deferred in the MVP scope.

## States and failures

Product: `draft → connecting → ready` or `needs_setup`.
Discovery: `queued → inspecting → proposed`, or `failed/cancelled`.
Study: `draft → published → recruiting`; later lifecycle belongs to VC-06.

Repo access failure must not prevent URL-only research. An inaccessible app produces a setup request, not fabricated task recommendations. Editing a published plan creates a new immutable revision; existing sessions stay attached to the original. Deduplicate repeated publish requests.

## Acceptance criteria

- An owner can connect a product, inspect proposed tasks and publish only selected tasks.
- A second tenant cannot read or modify that product or its source context.
- Sample complaint data is labeled in the task rationale and dashboard.
- The agent can return no useful proposal without causing downstream work.
- A published plan contains concrete dates, baseline identity, eligibility, capture and automation policy; all consumers validate the same schema.
- URL-only projects cannot trigger repo writes; auto-launch cannot exceed saved limits.
- A duplicate publish request creates one study event and one recruitment operation.

## Open decisions / future changes

- [ ] GitHub App scope and setup wizard UX after provider verification.
- [ ] Release-trigger integration versus manual release description for the first build.
- [ ] Multi-task studies and audience quotas after the one-task pipeline works.
- [ ] Scheduling continuous discovery based on actual customer usage.

