# VC-07 · Demo target app and reproducible scenario

Status: Draft
Dependencies: [VC-02](02-test-delivery-and-recording.md), [VC-04](04-prototypes-and-verification.md), [VC-05](05-retesting-and-validation.md)

## Goal

Select a real open-source application that can be forked, run and seeded predictably, then demonstrate one complete human-research-to-code-to-retest workflow. This spec does not claim a repository has already been forked or that the suspected UX problem exists upstream.

## Proposed target and evidence

First candidate: [Easy!Appointments](https://github.com/alextselegidis/easyappointments). Its upstream README describes self-hosted appointment scheduling, a Docker Compose development path, and PHP/MySQL requirements. The repository identifies GPL-3.0 code licensing. These facts were checked on 2026-09-19; inspect the license and setup at the actual pinned commit before use.

It is a candidate because it matches the agreed rescheduling story. Ease of setup and the exact customer rescheduling path are not yet verified locally. Deposit support is unverified and must not be claimed. Do not build a payment subsystem just to preserve an earlier script detail.

Alternative: the [Cal.com repository link](https://github.com/calcom/cal.com) currently redirects to `calcom/cal.diy`. Treat it as an alternative requiring a separate setup and license spike; do not copy old installation assumptions. Prefer a successful small demo over a recognizable but time-consuming dependency stack.

## Selection gate

Spend a bounded initial spike (proposed 45 minutes) on the preferred candidate:

1. Inspect current license, contributing notes, release/tag and environment requirements.
2. Run a clean checkout in the same style of environment available to Devin and preview hosting.
3. Verify the customer journey can be accessed with isolated test data and no external calendar/payment accounts.
4. Demonstrate automated fixture reset and browser tests.
5. Confirm the embedded SDK can capture relevant safe events.
6. Record selected commit, commands, measured setup time and unresolved constraints below.

If the gate fails, evaluate the alternative or use a small original booking fixture built during the event. Document the selected approach and rationale in this spec. The target is independent from VibeCheck and must not leak app-specific logic into the general orchestration.

## Hackathon eligibility and provenance

The supplied event brief says no previous projects. Confirm whether an attributed third-party demo target is acceptable before relying on the fork for the submission. The VibeCheck platform must be built during the event. If organizers disallow the fork, use the newly built fixture and record that choice.

Use a team-owned fork for modifications, issues and PRs. Preserve upstream notices and attribution. Record the pinned upstream SHA and every demo-specific modification. Do not submit deliberately introduced demo defects to upstream or portray them as flaws independently discovered in the original project.

## Baseline journey

A customer has an appointment, their availability changes, and they need another slot. Example task:

> You have a haircut booked on September 22 at 3 p.m., but your plans have changed. You are available September 25 at 4 p.m. Use this app to arrange your appointment for that time.

Render dates from the seeded scenario with an explicit app timezone rather than relying on ambiguous “tomorrow.” The participant task must not name the rescheduling control, cancellation problem or desired UI solution. Backend success checks and any deposit constraints are researcher-only unless genuinely needed for realistic task context.

First observe the actual baseline. If the flow is already easy, select another genuine journey or clearly label a deliberately modified baseline as a demo fixture. Never force a participant to fail or edit footage to manufacture a failure.

## Fixtures and environment

- One business, one service/provider, fixed opening hours and deterministic available slots.
- A baseline customer with a seeded appointment and a separate customer for authorization checks.
- Fresh fixture/account per assignment so baseline and variant sessions have equivalent starting conditions.
- Fixed locale/timezone and testable clock/date handling.
- Sandbox mail transport and no live payment/calendar effects.
- Baseline and candidate environments each tied to an immutable SHA and fixture revision.
- One-command reset plus a health/readiness check; document dependency versions and commands.

If deposits exist, seed a fake deposit and check it stays attached without using real money. If not, remove deposit language from code, validator, dashboard and video together, and update the scope in all affected specs.

## Independent browser and state checks

1. Customer can access the correct existing appointment.
2. Rescheduling changes date/time and preserves service/customer identity.
3. Old slot is released and new slot is reserved without duplicate bookings.
4. Confirmation displays the actual persisted result, not only optimistic UI.
5. Another customer cannot modify the booking through UI or direct requests.
6. Cancellation remains a distinct intentional action.
7. Deposit preserved only if supported by the actual fixture.

Host acceptance checks in the VibeCheck-controlled runner, outside Devin's editable scope. Verify the baseline's unrelated regression checks before demonstrating repair. A deliberately seeded functional regression may demonstrate a retry if clearly disclosed; do not claim it happened spontaneously.

## Three-minute capture plan

| Time | Actual product evidence |
| --- | --- |
| 0:00–0:20 | Short founder problem scene; no-budget line; no claim that staged dialogue is customer research. |
| 0:20–0:35 | Roasty introduction and real product/repository setup. |
| 0:35–0:55 | Task discovery from labeled inputs and automatic launch under configured policy. |
| 0:55–1:25 | Genuine human attempt with screen and voice; preserve actual outcome. |
| 1:25–1:45 | Dashboard recording/transcript/events linked to a finding. |
| 1:45–2:20 | Real API-created Devin run, candidate diff, independent checks and preview; label elapsed-time cuts. |
| 2:20–2:45 | Fresh human retest on the candidate, with actual result. |
| 2:45–3:00 | PR/evidence summary, tested SHA and preliminary outcome. |

Record the full run first, then edit waiting time. Never fabricate provider screens, participants, check results or speed. Team members can participate but disclose prior familiarity; a knowledgeable returning tester is not a fresh participant. Roasty narrates recorded backend events and does not imply stronger conclusions than the evidence supports.

## Acceptance criteria

- Chosen app has documented source/license, pinned revision, successful clean setup and reset.
- All changes, issues and PRs target the authorized demo repo, not upstream.
- A human baseline session generates real evidence that reaches the agent workflow.
- A code candidate is verified and deployed at the same SHA that the retester sees.
- The PR displays functional checks and bounded human evidence separately.
- Demo defects, sample complaints, staged dialogue and accelerated time are labeled accurately.
- The demo works without production data, transactions or external customer notifications.
- Deposit claims appear only if the implemented test scenario supports them.

## Selection record / open decisions

| Item | Current value |
| --- | --- |
| Preferred candidate | Easy!Appointments for the rescheduling story; awaiting local spike |
| Embedded-dialog demo target | [Excalidraw](https://github.com/excalidraw/excalidraw) cloned locally to `../excalidraw`, branch `vibecheck-demo` adds the SDK script tag to `excalidraw-app/index.html`; MIT licensed. Used to prove VC-02's in-app dialog and safe event capture, not the code-repair loop. Study "task_share_drawing" is stand-in data (VC-01 not implemented). |
| Selected repository/fork | Local clone only; no GitHub fork created yet |
| Upstream commit/license reviewed | Excalidraw: clone of 2026-09-19 (`git rev-parse HEAD` in `../excalidraw`), MIT. Easy!Appointments: TBD |
| Baseline commit | TBD |
| Setup and reset commands verified | Excalidraw: `yarn install`, `yarn --cwd ./excalidraw-app vite --port 3200` with `.env.development.local` holding `VITE_APP_PORT` and `VITE_APP_VIBECHECK_KEY`; no fixture reset needed for a blank canvas |
| Deposit support | Unverified; optional and excluded unless demonstrated |
| Preview runtime | TBD |
| Organizer confirmation for third-party target | Pending |
| Measured baseline friction | No human sessions yet |

Update this record with measured facts during implementation; do not infer completion from the presence of this spec.

