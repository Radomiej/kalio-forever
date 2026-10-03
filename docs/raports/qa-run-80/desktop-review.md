# QA80 desktop and compact launch review

Date: 2026-10-03. Verdict: **CONDITIONAL — launch layout evidence only**.

Project: Kalio-Forever. Repository: `C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever`; branch verified as `codex/kalio-provider-runtime-ux`. Review used existing screenshots, source and test; no new browser interaction, runtime reset, build, model request, Home Site write or commit occurred. Linear/Notion status updates are not assigned to this sidecar; no external writes were made. No full-goal or production-ready verdict is given.

## Accepted contract and ownership

At >=1024px (`lg`), creation is one screen containing persona, provider/model and prompt together, without Next/Back or a step indicator. Below 1024px, mobile/tablet compact creation is configuration then prompt, preserving selections and draft on Back/Next. Width governs layout, not device detection.

Source: `apps/kalio-web/src/features/chat/launch/NewChatScreen.tsx`. Setup/prompt wrappers use `contents` / `hidden lg:contents`; navigation and step indicators use `lg:hidden`. The breakpoint value 1024px is supplied by the parent contract; the exact rendered transition was not measured here.

Parent owns `apps/e2e/tests/qa-live-launch-wizard.spec.ts`, QA80 README and live Devin testing. This review owns only this report and the provider/runtime spec and CTO note; their preexisting edits were preserved. QA79 commit `8aad6e4` is historical narrow proof from the handoff, not the QA80 served revision. No source fix was authorized or made.

## Reviewed artifacts

All paths below are repository-relative; every PNG was visually inspected. Capture heights are 900px.

| Viewport | Exact screenshot path | Observation |
|---|---|---|
| 1440x900 | `docs/raports/qa-run-80/assets/launch-desktop-1440.png` | Persona, provider/model and prompt together; no Next/Back or step indicator; empty model field, disabled Run. |
| 320x900 | `docs/raports/qa-run-80/assets/launch-config-320.png` | Default persona, SWE-2, configuration/Next; card top outside frame. |
| 320x900 | `docs/raports/qa-run-80/assets/launch-prompt-320.png` | Prompt/Back, unsent QA80 draft, Run. |
| 390x900 | `docs/raports/qa-run-80/assets/launch-config-390.png` | Default persona, SWE-2, configuration/Next. |
| 390x900 | `docs/raports/qa-run-80/assets/launch-prompt-390.png` | Prompt/Back, unsent QA80 draft, Run. |
| 820x900 | `docs/raports/qa-run-80/assets/launch-config-820.png` | Default persona, SWE-2, configuration/Next. |
| 820x900 | `docs/raports/qa-run-80/assets/launch-prompt-820.png` | Prompt/Back, unsent QA80 draft, Run. |

## Acceptance and evidence matrix

| AC / PIT | Status | Evidence | Unverified / next |
|---|---|---|---|
| AC-01 / PIT-02, PIT-09: desktop single screen | PASS | 1440 PNG plus source; parent test asserts three controls visible and Next/Back not visible. | Screenshot confirms no indicator; test does not explicitly assert indicator absence. |
| AC-02 / PIT-02, PIT-09: compact sequential creation | PASS | Six PNGs at 320/390/820; test asserts prompt absent in setup and model absent in prompt. | Physical mobile/tablet and exact breakpoint edges not covered. |
| AC-03 / PIT-03, PIT-10: compact model/draft retention | PASS | Test asserts model value after Back and draft after Next; prompt PNGs show unsent draft. | Persona after Back and project retention are not explicitly asserted; no F5/reconnect proof. |
| AC-04 / PIT-04, PIT-11, PIT-16: runtime/result provenance | BLOCKED | Parent reports PASS 3.6s at `http://localhost:5288/`; test restricts target to that URL and numeric report ID. | Result not independently rerun; raw run receipt and served revision not established by this review. Effective backend provider/config was not read. |
| AC-05 / PIT-05, PIT-08, PIT-18: real Devin workflow | N/A | Test reuses empty session, selects SWE-2, enables Run and never submits. | Explicitly outside sidecar; parent must prove dispatch, approvals/tools and outcome separately. |
| AC-06 / PIT-06: documentation/ownership | PASS | Three-file write scope; existing spec/CTO edits retained. | Parent retains test/README and external status ownership. |

The test has no dependency interception in this file, but this does not identify the QA backend's effective execution provider. `Devin CLI · swe-2` proves visible selection, not Devin inference authorization. The desktop screenshot is taken before model selection; compact selection evidence cannot be promoted to desktop interaction evidence. Correction attempts: 0; no UI correction performed.

## Findings and remaining gates

| Priority | Finding or action | Impact | Evidence | Resolution |
|---|---|---|---|---|
| P2 | Real Devin workflow remains outside this evidence | Launch UI cannot establish working executor/runtime or full-goal readiness. | No Run click or downstream execution assertions in reviewed test. | Required before prod: parent closes real Devin gates; preserve its priority. |
| P2 | Served revision and breakpoint/interaction/accessibility boundaries remain unverified | Layout samples cannot establish every responsive state or release provenance. | Samples 320/390/820/1440 only; no 1023/1024/1025, desktop selected pair, keyboard/touch/zoom, unavailable-provider recovery or F5/reconnect in this test. | Required before prod: obtain relevant proof or explicitly accept the bounded gaps. |
| P3 | 320px configuration card begins above the captured frame | Initial heading/context may be missed; image alone cannot identify scroll cause. | `launch-config-320.png` omits the top NEW CHAT region while later compact captures include it. | Recommended: parent checks initial scroll, resize/focus scrolling and access to all controls; observation, not confirmed source defect. |

No discrepancy was found against the desktop single-screen requirement. The desktop empty-model/disabled-Run state is consistent with not selecting a provider yet; no claim about launch rejection or error feedback follows from it. Focus outline in compact PNGs does not prove keyboard/contrast compliance. Existing promotional text was reviewed as pixels only; offer validity and account eligibility were not investigated.

## Handoff

Changed documentation: `docs/spec/provider-runtime-selection-and-integrations-ux.md`, `docs/cto/provider-runtime-selection-and-integrations-ux.md`, `docs/raports/qa-run-80/desktop-review.md`. Review supports the existing desktop/compact implementation at captured widths. Parent test PASS is attributed, not independently reproduced. No further edits are needed for this documentation slice; listed runtime and release proof remains with the parent.
