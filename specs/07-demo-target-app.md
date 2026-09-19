# VC-07 · Demo target app and reproducible scenario

Status: Draft
Dependencies: [VC-02](02-test-delivery-and-recording.md), [VC-04](04-prototypes-and-verification.md), [VC-05](05-retesting-and-validation.md)

## Goal

Select a real open-source application that can be forked, run and seeded predictably, then demonstrate one complete human-research-to-code-to-retest workflow. This spec does not claim a repository has already been forked or that the suspected UX problem exists upstream.

## Selected target and measured evidence

Selected: [Excalidraw](https://github.com/excalidraw/excalidraw), MIT licensed (root `LICENSE`, "Copyright (c) 2020 Excalidraw"). Spike commit `97c68dd371e13c017a8dcca49f8b3995ba7890a8`, authored 2026-09-19.

Measured on a macOS machine with Node 24.20.0 and yarn 1.22.22 on 2026-09-19:

| Step | Command | Measured |
| --- | --- | --- |
| Clone | `git clone --depth 1` | 1m34s |
| Install | `yarn install` | 4m24s; installs husky hooks |
| Run | `yarn start` | Vite ready in 0.7s; app on `http://localhost:3001` |
| Readiness | `curl http://localhost:3001` | HTTP 200 |

The editor needs no backend, database, login, seed migration, API key or Docker daemon. Scene state persists in browser local storage (`excalidraw` for elements, `excalidraw-state` for app state; see `excalidraw-app/app_constants.ts`), which is also the observable surface for fixtures and success rules. Live collaboration and Excalidraw+ are hosted features and stay disabled in the demo.

Rejected candidates and why: Easy!Appointments, Documenso, Open WebUI and Stirling-PDF all require a Docker Compose stack, and the available development machine has no Docker. Mastra Studio runs in 28s from `create-mastra` but needs a model-provider API key to execute an agent, and its Agents/Workflows/Scorers/Traces surface requires participants who already know the framework, which conflicts with recruiting ordinary participants in VC-02.

Trade-off accepted: success is observed from persisted client scene state rather than server records. This is weaker provenance than a database assertion, and checks must therefore read a post-session snapshot captured by the runner rather than trusting in-page claims.

## Scoped feature set

Treat the demo as continuous research on a product VibeCheck already monitors, so discovery covers only recently merged editor features rather than the whole editor. Scope for the first study, taken from the commit range ending at the pinned SHA:

| Feature | Upstream PR | Reachability verified |
| --- | --- | --- |
| Sticky notes | #12064 | Yes — shortcut `N`; a note renders with a creation-date footer |
| Bucket fill and eyedropper | #11849, #11859 | Yes — "Bucket fill" in the More tools menu, shortcut `B` |
| Customizable color top picks | #11872 | Not yet verified in the UI |
| Right-click pan, wheel-button zoom and the "zoom with scroll wheel" preference | #12110, #12099 | Not yet verified in the UI |
| Lasso selection `boxSelectionMode` | #11862 | Listed in the More tools menu; behavior not verified |

Publish at most three of these in the first study. The remaining entries are the backup pool if a chosen journey turns out to be frictionless.

## Baseline journey

A user works on an existing board and captures several short ideas on it. Example task:

> The board on screen collects ideas for a team offsite. Add these three ideas to the board so your teammates can read them: rooftop dinner, karaoke night, museum tour.

The participant task must not name the sticky note tool, its shortcut, or any suspected discoverability problem. Backend success checks stay researcher-only.

First observe the actual baseline. If the flow is already easy, select another genuine journey from the backup pool or clearly label a deliberately modified baseline as a demo fixture. Never force a participant to fail or edit footage to manufacture a failure.

## Fixtures and environment

- `excalidraw_fixture_v1`: one seeded scene document (`.excalidraw`) holding a small pre-drawn board with stable element IDs, plus a seeded app state with light theme, 100% zoom, fixed scroll position, the welcome screen dismissed and an empty library.
- Fresh browser profile and fresh fixture per assignment, so baseline and variant sessions start identically.
- Reset: clear the `excalidraw`, `excalidraw-state`, `excalidraw-collab` and `excalidraw-theme` local storage keys and re-seed the scene before the page loads. Expose this as one command plus a readiness check that asserts the seeded element IDs are present.
- Fixed locale (`en`) and an explicit timezone; sticky notes stamp a creation date, so the clock is part of the fixture.
- Collaboration, Excalidraw+ and any network-dependent feature disabled; no external accounts.
- Baseline and candidate environments each pinned to an immutable SHA and fixture revision.

There is no payment, mail or calendar surface in this target, so deposit, notification and calendar language is removed from the demo scenario and from the specs that referenced it.

## Independent browser and state checks

1. The seeded scene loads with the expected element IDs and count.
2. Ideas captured during the task persist across a reload with their text intact.
3. A color change applies to the intended element only and leaves other elements untouched.
4. Undo restores the previous element state.
5. Export to PNG and SVG still produces a non-empty file containing the scene.
6. The reset command restores the fixture byte-for-byte in terms of element IDs and app state fields.
7. No collaboration or telemetry network calls occur in demo mode.

Host acceptance checks in the VibeCheck-controlled runner, outside Devin's editable scope. Verify the baseline's unrelated regression checks before demonstrating repair. A deliberately seeded functional regression may demonstrate a retry if clearly disclosed; do not claim it happened spontaneously.

## Hackathon eligibility and provenance

The supplied event brief says no previous projects. Confirm whether an attributed third-party demo target is acceptable before relying on the fork for the submission. The VibeCheck platform must be built during the event. If organizers disallow the fork, use a newly built fixture app and record that choice.

Use a team-owned fork for modifications, issues and PRs. MIT permits this; preserve upstream copyright and license notices. Record the pinned upstream SHA and every demo-specific modification. Do not submit deliberately introduced demo defects to upstream or portray them as flaws independently discovered in the original project.

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

## Selection record / open decisions

| Item | Current value |
| --- | --- |
| Selected upstream | `excalidraw/excalidraw`, MIT |
| Spike commit reviewed | `97c68dd371e13c017a8dcca49f8b3995ba7890a8` (2026-09-19) |
| Local clone | `../excalidraw`, branch `vibecheck-demo` adds the SDK script tag to `excalidraw-app/index.html` and demo semantic instrumentation (see VC-02 passive mode). Used to prove the in-app dialog, safe event capture and passive screening; not yet the code-repair loop. |
| Team-owned fork | Not created yet; required before VC-04 writes anything |
| Baseline commit | TBD; pin when the fork is created |
| Setup verified | `yarn install` 4m24s; `yarn --cwd ./excalidraw-app vite --port 3200` with `.env.development.local` holding `VITE_APP_PORT` and `VITE_APP_VIBECHECK_KEY`, HTTP 200 |
| Reset command | Not implemented; a blank canvas needs no reset, local storage reset plus scene re-seed is the intended mechanism for seeded tasks |
| Preview runtime | TBD; a static Vite build is sufficient because there is no backend |
| Organizer confirmation for third-party target | Pending |
| Measured baseline friction | No human sessions yet |

Update this record with measured facts during implementation; do not infer completion from the presence of this spec.
