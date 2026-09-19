# VC-02 · Test delivery and recording

Status: Draft
Input: [VC-01](01-product-onboarding-and-test-planning.md) · Outputs: [VC-03](03-evidence-analysis-and-github-issues.md), [VC-05](05-retesting-and-validation.md)

## Goal

Deliver the same study through a link or an embedded invitation, capture declared session evidence, and reliably upload it for analysis. The participant must understand what is recorded and be able to pause or stop.

## Invitation and assignment

- Direct link: owner shares a study invitation with friends or customers. Exchange a scoped token for an assignment after eligibility and consent; do not expose test credentials in URLs.
- Embedded: a small SDK checks eligibility and invitation caps, then displays a dismissible toast at an appropriate moment. No capture begins merely because the toast appeared.
- Marketplace: signed-in testers claim available tasks from a simple queue. Transactional claims prevent exceeding the target count. Reserve a fixture/account per assignment.
- Support dismissal and cooldown. Proposed starting default: one invitation per participant/product per seven days; configurable. Do not interrupt critical workflows such as checkout.
- Reveal a neutral task, expected duration, recording requirements and any reward before participation. Failure to accomplish the task does not invalidate participation.

## Recording configuration

| Signal | MVP default | Boundaries |
| --- | --- | --- |
| Screen | Required for recorded studies | Explicit browser screen-share choice; encourage the application tab. |
| Microphone | Required for think-aloud studies | Permission and clear recording indicator; missing permission gives retry or exit. |
| Webcam | Off | Optional future feature; not needed to prove honesty. |
| Pointer movement/clicks | On in instrumented pages | Throttle movement; record viewport, scroll and safe target identity. |
| Navigation/focus | On in instrumented pages | URLs scrubbed of query secrets; focus loss is not proof of fraud. |
| Keyboard | Semantic only | Tab, Enter, Escape and edit counts; no typed characters, clipboard data or password values. |
| Input values | Off | Mask sensitive fields; content capture is outside MVP. |
| Retention | Proposed 30 days | Admin-configurable and disclosed before consent. |

Admins can choose `off/optional/required` where supported. They cannot bypass browser permissions or secretly activate capture. Settings changed mid-session must not expand capture without new consent.

## Actual browser limits

The SDK observes only instrumented application pages. A hosted recorder cannot read DOM, keyboard or mouse events from another origin, browser chrome, unrelated tabs or native apps. Screen recording of a selected surface does not provide those structured events. A direct-link study against an uninstrumented app is video/audio-only and must say so.

The embedded SDK connects via short-lived session tokens and explicit allowed origins. Popups/windows use validated origins for messaging. Do not assume arbitrary websites can be embedded in an iframe; many block framing. MVP can use a dedicated recorder page beside the target tab.

Pixel-level screen recordings can reveal information beyond masked DOM events. Use sandbox/test accounts for the demo, explain surface selection, and do not claim field masking redacts raw video unless implemented and verified. Recording is scoped to opt-in testing; general analytics collection is separately configured.

## Participant flow

`invited → eligible → assigned → consent → device_check → recording → submitting → complete`

The participant may pause, resume, mark themselves stuck, finish early or withdraw. A neutral reminder such as "What are you looking for?" may be used sparingly; log its timestamp because moderation can affect behavior. Never coach toward a specific control or show an engagement/roast score during testing.

At completion ask for perceived difficulty and optional comments. Capture declared completion separately from instrumented completion. Store missing evidence as missing, not as zero time or failure.

## Media and event pipeline

Use Vonage for the planned screen-share/recording session and SLNG for transcription. Run an early spike to confirm selected browser, screen-track, audio, archive retrieval and timestamp behavior. If a provider capability is unavailable, implement an explicit adapter fallback and document the change; never display a provider integration that is not used.

Maintain a monotonic session clock for client events and an explicit mapping to media/STT offsets. Record pause intervals. Upload event batches with sequence numbers; use idempotent multipart/chunk handling for any client-uploaded media. Provider archive callbacks also require signature/authentication checks and deduplication.

Mark upload complete only after server-side asset verification. Transcription may finish later. Analysis can run in partial-evidence mode only with declared limitations. Short-lived upload tokens are restricted to the assignment and asset type/size.

```json
{
  "schema_version": "1.0",
  "session_id": "session_example",
  "assignment_id": "assignment_example",
  "study_revision": 1,
  "tested_commit_sha": "REPLACE_WITH_REAL_SHA",
  "consent_version": "consent_v1",
  "capture_policy_ref": "capture_snapshot_example",
  "assets": [{"kind": "screen_audio", "asset_ref": "asset_example", "status": "verified", "duration_ms": 185000}],
  "events_ref": "events_example",
  "transcript_ref": "transcript_example",
  "clock_map_ref": "clock_example",
  "completeness": "complete",
  "instrumentation": "sdk",
  "outcome": {"participant_reported": "stuck", "instrumented": "not_completed"}
}
```

Individual event: `session_id`, `sequence`, `t_ms`, `type`, `safe_target_ref`, `viewport`, `coordinates` where relevant. Transcript segments: `segment_id`, `start_ms`, `end_ms`, `speaker`, `text`, optional STT confidence. Sanitize before sending evidence to agents.

## Quality, credits and failures

No automatic credit denial based on silence, speed, pointer activity, positive feedback or a model rating. Check meaningful task participation and recording usability; route disputed cases to review. Fixed valid-session credit is idempotent per assignment. A withdrawal follows disclosed compensation rules, not an invented penalty.

Handle permission denial, tab closure, network loss, recorder failure and incomplete uploads visibly. Support resumable upload where possible. Persist partial assets with clear status. A resumed assignment must not accidentally merge evidence from different builds or reset accounts.

## Acceptance criteria

- The same published task can be entered by direct link, toast and marketplace claim.
- Capture starts only after consent and permissions; pause/stop visibly controls capture.
- Password characters and input text never enter event payloads in the MVP.
- Uninstrumented targets explicitly report video-only evidence.
- Video, transcript and click timestamps align within a measured tolerance recorded in integration notes.
- Duplicate chunks/callbacks create no duplicate sessions, assignments or credits.
- A permission/network failure is recoverable or marked incomplete; it is never shown as a complete recording.
- A tester who makes an honest attempt and fails the task can receive participation credit.

## Open decisions / future changes

- [ ] Confirm recording architecture and supported browsers using actual provider accounts.
- [ ] Choose measured event sampling and media limits after the integration spike.
- [ ] Define participant-facing withdrawal and partial-session credit policy.
- [ ] Accessibility alternatives for participants who cannot provide think-aloud audio.

