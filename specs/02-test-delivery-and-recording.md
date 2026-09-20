# VC-02 · Test delivery and recording

Status: Implemented in `apps/web` (first pass); provider calls unverified until credentials are supplied
Input: [VC-01](01-product-onboarding-and-test-planning.md) · Outputs: [VC-03](03-evidence-analysis-and-github-issues.md), [VC-05](05-retesting-and-validation.md)

## Goal

Deliver the same study through a link or an embedded invitation, capture declared session evidence, and reliably upload it for analysis. The participant must understand what is recorded and be able to pause or stop.

## Invitation and assignment

- Direct link: owner shares a study invitation with friends or customers. Exchange a scoped token for an assignment after eligibility and consent; do not expose test credentials in URLs.
- Embedded: a small SDK checks eligibility and invitation caps, then displays a dismissible toast at an appropriate moment. The eligibility offer carries the immutable participant-facing scenario when one is configured. No capture begins merely because the toast appeared.
- Marketplace: signed-in testers claim available tasks from a simple queue. Transactional claims prevent exceeding the target count. Reserve a fixture/account per assignment.
- Support dismissal and cooldown. Proposed starting default: one invitation per participant/product per seven days; configurable. Do not interrupt critical workflows such as checkout.
- Reveal a neutral task, expected duration, recording requirements and any reward before participation. Failure to accomplish the task does not invalidate participation.

## Recording configuration

| Capture surface | MVP default | Boundaries |
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

When the published plan includes an agent-designed scenario, the participant dialog renders its introduction, numbered steps and think-aloud cues. When no scenario exists, it renders the existing `participant_prompt` unchanged.

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

## Implementation notes

Code lives in `apps/web` (Next.js App Router + Drizzle/Postgres), `packages/contracts` (Zod schemas for the shared contracts and the host↔dialog message contract) and `packages/sdk` (embedded script). Local infrastructure is the Supabase CLI (Postgres + private Storage bucket) and a worker process backed by the `jobs` table; the worker and the development "drain" endpoint share one job runner.

### Delivery

- **Entry channels.** Direct link (`/t/:token`, token hashed at rest, exchanged for an assignment after sign-in), embedded toast (`/sdk/vibecheck.js` with an origin-bound publishable key; eligibility and cooldown checked server-side, dismissal remembered locally), marketplace (`/marketplace`, claim locks the study row and counts live assignments against `target_count`). A participant who already claimed sees "Continue your task" instead of a second claim.
- **Participant dialog.** Every channel ends in the same compact dialog rendered by Seamless UX inside an iframe that the SDK overlays on the product page (`/embed/a`, `/embed/join/:studyId`): task → consent (one "Agree and continue" button; the consent version is stored server-side, not shown) → devices → a small floating recording panel → feedback. The iframe is on the Seamless UX origin, so the host page never sees media or tokens; the SDK sets `allow="microphone; display-capture"` so permissions are requested from inside it. The host paints the card chrome (opaque, rounded iframe) because Safari leaves stale pixels in transparent iframes under a blurred overlay. Direct link and marketplace hand the assignment to the product page as `#vc=<assignment token>`, a fragment the browser never sends to a server; the SDK strips it and opens the dialog. Products without the SDK (`embed_mode = hosted`) get the same dialog on `/a/:id` and the product opens in a new window (video-only evidence).
- **Semantic events during a study (2026-09-20).** `VibeCheck.track(...)` calls made while a study recording is active are stored as `semantic` session events (`semantic_type` from the passive vocabulary plus allowlisted refs: `journey_id`, `action_ref`, `progress_ref`, `target_ref`, `result`, `error_code`; free text is rejected by the strict schema). They are study evidence next to the transcript, never passive screening input, so prompted behaviour cannot create research candidates. A study whose capture policy sets `screen: off` records the microphone only (Vonage archive with `hasVideo: false`, asset kind `audio`), and the dialog's device step becomes a single "Start" after the microphone is allowed; the Excalidraw demo study uses this: instrumentation logs plus the transcribed microphone are the evidence.
- **Identity.** Signed-in participants (magic link) for direct link and marketplace; anonymous device participants for the embedded toast (a random device token held in Seamless UX-origin storage inside the iframe, hashed in the database, no email). Participant API calls addressing one assignment accept either the session cookie or a bearer token scoped to that assignment, because cross-origin iframes cannot rely on cookies in every browser. The assignment token never creates new assignments: claim and redeem endpoints (`/api/marketplace/claim`, `/api/embed/claim`, `/api/invitations/redeem`) require a session or device identity and answer `token_scope_mismatch` to an assignment token, so one assignment's token cannot escalate to participant scope. Device identities (`/api/embed/device`) are keyed to a product's publishable key and rate limited per client address.
- **Auth.** Better Auth magic links for owners and signed-in participants; one user table with tenant memberships for owners and a participant profile per user. `EMAIL_MODE=test_inbox` writes links to `notification_outbox` and `/dev/inbox`; no real email provider yet.

### Recording

- **Devices.** Two separate clicks: microphone first, then screen. Safari only allows `getDisplayMedia` while the click is still active, so the screen request is the first statement of its handler and the client SDK is preloaded. After the microphone is granted the dialog shows a live level meter and says "We can hear you" only once the provider reports audio, so a tester notices a muted or wrong input before recording.
- **Session and archive.** Vonage Video: the server creates a routed session only after consent is stored; the browser connects and publishes, and only then asks the server to start the composed archive (Vonage returns 404 for archives on sessions with no connected client). Pause stops the archive and resume starts a new one at the recorded session offset, so each archive is one asset with an explicit offset; pause intervals are stored on the session. Pause is idempotent; a failed archive restart on resume reopens the pause and reports `media_unavailable`, and the client stays paused. The SDK tells the dialog when the host window loses or regains focus (tab switch, other app; focus moving into the dialog does not count) and the dialog auto-pauses and auto-resumes unless the participant paused manually.
- **Callbacks and jobs.** The archive status callback is verified with the application signature-secret JWT (verified live 2026-09-20: Vonage's token carries `iss: "Vonage"`, `iat`, `jti` and `payload_hash`, a sha256 of the JSON body, so the check is signature plus body hash; the token names no application, the per-application secret is the binding), deduplicated by `(archive id, status)` inside the same transaction as the processing it deduplicates (a failed processing lets the provider's retry through; a malformed body is a 4xx), and turns `available` into a durable `archive.fetch` job that re-requests a fresh signed URL, downloads, checks size against the provider, stores the file privately and marks the asset `verified`. `failed` marks the asset failed and the session incomplete. Each asset carries its own `transcript_status`, so a silent archive counts as transcribed and a multi-archive session still completes. `pnpm tunnel` automates the local callback setup (cloudflared, named or quick tunnel, plus the Applications API); the signature secret is dashboard-only.
- **Transcription.** SLNG (Deepgram Nova 3 through the SLNG gateway). The MP4 goes as the multipart `audio` field; `language`, `punctuate`, `utterances` and `smart_format` go in the query string, because sending them as multipart fields made the gateway resolve a non-existent model and answer 400 (observed 2026-09-19). Utterance timestamps are shifted by the asset offset into session milliseconds; segments store confidence in permille; word groups are used when the provider returns no utterances.
- **Events.** The SDK captures clicks, throttled pointer moves, scroll, navigation (query and fragments dropped, token-like segments masked), focus/visibility, semantic keys only, and per-field edit counts. The contract schema is strict, so any payload carrying free text is rejected server-side. The dialog hands the host page a session-scoped events token through postMessage once recording starts; both sides validate origins (the SDK accepts only the Seamless UX origin and its own iframe, the dialog only the product's permitted origins). Instrumentation is idempotent per session and DOM listeners always forward to the current recorder. Interactions inside the dialog itself are never captured. Batches are idempotent by `(session, batch_sequence)` and events by `(session, sequence)`.
- **Clock.** The dialog fixes a client clock origin (epoch ms, stored as bigint) at recording start; media offsets, pauses and transcript segments are expressed on that clock (`buildClockMap`). Alignment tolerance has not been measured yet.
- **Credits.** One idempotent `valid_participation` ledger entry per assignment on outcome submission, regardless of task success. Withdrawal records no credit; partial-session credit policy remains open.

### Output to VC-03

`buildSessionManifest` produces the SessionManifest from the index contract; `GET /api/owner/sessions/:id/manifest` returns it with the clock map and the `session.upload_verified` envelope. Refs resolve by id (`asset_*` via signed URLs from the owner media endpoint, `events:`/`transcript:`/`clockmap:` by session); nothing in the manifest is a URL or participant data. `events_ref` is present for every SDK-instrumented session even when the stream is empty; `transcript_ref` only once transcription finished with at least one segment; `completeness` stays `incomplete` until every archive is verified. Two fields are deliberately "not established" today: `tested_commit_sha` is the placeholder from the stand-in VC-01 plan, and `outcome.instrumented` is `unknown` because no success-rule evaluator exists yet, so VC-03 must treat only `participant_reported` as evidence.

Real example from the simulated session of 2026-09-19 (one 18 s archive at offset 4176 ms, 90+ events, one transcript segment with confidence 0.998 containing the spoken words):

```json
{
  "schema_version": "1.0",
  "session_id": "session_a57b5e5195934c0db9a828620ef9f779",
  "assignment_id": "assignment_d03ce5e814e84011a2d5d0bcfb366ee7",
  "study_revision": 1,
  "tested_commit_sha": "0000000000000000000000000000000000000000",
  "consent_version": "consent_v1",
  "capture_policy_ref": "assignment:assignment_d03ce5e814e84011a2d5d0bcfb366ee7:capture_policy",
  "assets": [{"kind": "screen_audio", "asset_ref": "asset_bbbb176be34d4766b293db8b7a9eab34", "status": "verified", "duration_ms": 18000}],
  "events_ref": "events:session_a57b5e5195934c0db9a828620ef9f779",
  "transcript_ref": "transcript:session_a57b5e5195934c0db9a828620ef9f779",
  "clock_map_ref": "clockmap:session_a57b5e5195934c0db9a828620ef9f779",
  "completeness": "complete",
  "instrumentation": "sdk",
  "outcome": {"participant_reported": "completed", "instrumented": "unknown"}
}
```

### Owner view

`/owner` lists studies, counts, direct links and sessions; `/owner/sessions/:id` shows a synchronized player with transcript captions, transcript, events, processing jobs and an explicit list of evidence limitations. Media is served through 10-minute signed URLs fetched on demand.

### Verification record

- **Real providers (2026-09-19).** `e2e/live-session.spec.ts` (opt-in, `LIVE_PROVIDERS=1`) runs a simulated session on the local Excalidraw clone: a fake microphone plays a synthesized sentence, the dialog runs task → consent → devices → recording → feedback, the archive callbacks (started, stopped, available) arrive through the named cloudflared tunnel with a valid signature, the pipeline jobs run inline with the worker's runner, and the test asserts a verified recording, captured events and a transcript containing the spoken words. Passed repeatedly (≈40 s). A separate headless pause/resume cycle produced two archives with the pause gap recorded.
- **Local (2026-09-19).** Unit and integration tests (contracts, state machine, claims under concurrency, invitations, recording lifecycle with a fake media client including pause idempotency and resume failure, event ingest, archive pipeline with fake provider/storage, SLNG response mapping, callback JWT verification, manifest building), and browser e2e tests for direct link, marketplace claim, embedded join and "the SDK sends nothing while typing".
- **Human attempts.** Two manual Safari sessions stored recordings (49 s and 30 s), events and outcomes correctly, but their audio (peaks −20 dB and −14 dB) contained no recognisable speech for the English, multilingual or Spanish models, before and after loudness normalisation. Because the synthesized-speech path transcribes correctly, this is an input-device issue on that machine, not a pipeline fault; the microphone meter was added in response.

Not yet verified: a human session with real speech in Safari, timestamp alignment tolerance between video, transcript and events, Safari and Firefox screen-share end to end, and marketplace eligibility rules beyond "signed in".

## Passive observation mode

Implemented on 2026-09-19 (`packages/sdk/src/observer.ts`, `apps/web/src/domain/monitoring/ingest.ts`, `/api/observe/session`, `/api/observe/events`). The recorder described above remains assignment-bound and opt-in. This mode is independently enabled per product (monitoring policy, disabled by default); it does not reuse recording consent or the recording token. Product disclosure and applicable collection permissions must be satisfied before sending observation events. Provide a host integration to report permission changes; unknown or withdrawn permission disables collection and clears unsent buffers. A study's recording permission never overrides a passive-collection opt-out.

Collect allowlisted semantic events: journey start, meaningful progress, action attempt/result, validation error codes, navigation, help request, verified completion and explicit exit. No raw key characters, input values, clipboard, DOM snapshots, microphone or video. Use safe stable target IDs and route templates; reject unknown properties and scrub URLs before transmission. Generic pointer movement is not a reason to call Jev. Distinguish observed client outcomes from trusted server-confirmed business outcomes.

Example event payload inside the shared envelope:

```json
{
  "observation_session_id": "obs_example",
  "journey_instance_id": "journey_example",
  "sequence": 17,
  "t_ms": 43000,
  "build_ref": "build_example",
  "instrumentation_schema_version": "1.0",
  "collection_policy_ref": "collection_policy_example",
  "type": "action_result",
  "action_ref": "booking_change",
  "attempt_id": "attempt_example",
  "result": "validation_failed",
  "error_code": "SLOT_UNAVAILABLE",
  "goal_source": "unknown"
}
```

Use short-lived observation-scoped ingestion credentials, origin checks, payload/rate limits and server-derived tenant binding. Browser-origin validation is not proof of a genuine human; client events remain untrusted. Rotate pseudonymous observation session IDs; do not fingerprint users or assume sessions equal people. Navigation cannot by itself establish the user's goal.

Buffer small batches and retry with stable event IDs and sequence numbers. Server ingestion deduplicates, tracks receive time versus monotonic event time, records sequence gaps and builds bounded journey windows for VC-03. Late events create a subsequent window revision when still within retention; never mutate a completed evaluation. Separate tabs and journey instances so overlapping navigation is not a false loop. Limit memory and queue size; record dropped-event coverage rather than retaining unlimited offline activity.

Admin settings include enabled journeys/events, collection policy, retention and ingestion caps. VC-03 owns trigger timing and evaluation budgets. Turning monitoring off stops new ingestion/evaluation; withdrawal and deletion follow the disclosed retention policy. Study pause must not leak research activity through passive collection: suppress passive events during an active research assignment, including pauses, unless separately and explicitly configured with participant permission. Never count the same event twice when evidence is linked.

Implementation notes: the host reports `collectionPermission` (`granted`/`denied`/`unknown`) through the script tag or `VibeCheck.setCollectionPermission`; anything but `granted` opens no session and clears buffers. Events are collected only inside a journey started by the host (`VibeCheck.track("journey_start", { journey_id })`), with an allowlisted payload; navigation alone is never a journey. The SDK suppresses passive collection while research instrumentation is active. Observation sessions get a scoped bearer token; batches carry stable ids and sequence numbers, are deduplicated server-side, and record sequence gaps and receive time. Ingestion schedules one deterministic scan per journey per batch-delay bucket; it never evaluates. The Excalidraw demo fork emits `journey_start`/`progress` on the first drawn element, `progress`/`action_attempt` when the export dialog opens, `help_request` when the help dialog opens, and a client-observed `action_result`/`completion` on export (labeled demo instrumentation in `excalidraw-app/vibecheck.ts`).

Additional acceptance criteria:

- SDK installation alone sends no passive observations; no screen/audio permission is requested in observation mode.
- Required permission is checked before collection; disabling it stops collection and drops unsent buffers.
- Free text, secrets, oversized batches and unauthorized origins are rejected.
- Duplicate/out-of-order events preserve coverage and do not multiply trigger counts.
- Missing progress instrumentation is reported as unknown, not user failure.


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

- [ ] Run the Vonage + SLNG integration with real credentials; record measured alignment tolerance and supported browsers here.
- [ ] Choose measured event sampling and media limits after the integration spike (current defaults: pointer throttle 100 ms, 500 events per batch, 2 s flush).
- [ ] Real email provider for magic links and invitations; local development keeps the test inbox.
- [ ] Marketplace eligibility rules (`eligibility_rule_ref`) are not evaluated yet; any signed-in participant can claim.
- [ ] Instrumented task outcome: no evaluator runs `success_rule_ref` yet, so `outcome.instrumented` is always `unknown` (VC-04/VC-07 checks are the intended source).
- [ ] Prepared-canvas fixtures per assignment for the Excalidraw target; today the task starts from a blank canvas with a drawing step.
- [ ] Device participants are per browser profile (Safari partitions iframe storage per top site), so cooldowns are per device+site, not per person; credits for anonymous participants have no payout path yet.
- [ ] Define participant-facing withdrawal and partial-session credit policy.
- [ ] Accessibility alternatives for participants who cannot provide think-aloud audio.
