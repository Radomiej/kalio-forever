# CTO note: provider/runtime choice and integrations UX

Date: 2026-10-02
Status: User-approved product direction; implementation slice verified in local stable QA; production release pending
Priority: P1 — users cannot reliably understand or select the executor for a core chat/run workflow.

## Decision

Desktop creation is a single screen: at >=1024px (`lg`), persona, provider/model and prompt are visible together, with no Next/Back or step indicator. Only mobile/tablet compact viewports below 1024px use sequential configuration -> prompt steps, preserving selections and draft on Back/Next. The rule follows viewport width rather than the device label.

Separate identity from execution. A persona owns role/instructions and persona-scoped behavior and may recommend a default provider/runtime + model pair. The new-chat provider/model fuzzy finder preselects that recommendation while allowing the user to choose another connected pair. The conversation/run owns the final persisted, validated selection. Devin and Codex are first-class execution choices. Mock is test/development infrastructure, not a normal user-facing provider. Never silently fall back.

The backend remains authoritative. At launch, resolve and snapshot the exact selection, project/workspace, credentials source, and capability policy. Later settings changes do not mutate a running session. UI must display this effective selection and a typed pending/ready/blocked/failed state.

The persona recommendation seeds a new conversation; it is not a fallback at dispatch. If no valid conversation selection exists, require the user to choose. Commit an immutable run snapshot before external side effects, and make retry/resume use that snapshot.

## Why now

The QA walkthrough combined unclear connection controls, delayed/no visible status feedback, a 773-model inline catalog, repeated Claude cards, mock provider prominence, duplicate provider-health information, unclear bridge/version/permission states, and a Run flow where the user could not confidently tell which engine would execute. This is a trust and correctness problem, not only visual polish.

## Risks and controls

| Risk | Required control |
|---|---|
| Persona/profile redesign breaks existing sessions | Backward-compatible read path, explicit migration/default, regression fixtures for legacy personas and conversations. |
| Silent provider/model fallback sends work to the wrong service | Fail closed on unavailable/unauthenticated explicit selection; display effective selection before start and in run state. |
| Retry/resume reroutes because a profile/default changed after the original request | Persist immutable resolved execution snapshot before dispatch; retry/resume use that exact snapshot. |
| Credential/token leaks during settings feedback | Return only non-secret metadata; test that token and auth material never enter status, audit UI, or screenshots. |
| Runtime categories remain conflated | Model `integration connection`, `development environment`, `agent runtime`, and `LLM provider` as related but distinct concepts. |
| Status polling recreates prior CMD/process spam | Backend-owned deduplicated/queued probes with bounded cadence; UI consumes cached status and does not independently fan out checks. Do not regress process-audit instrumentation. |
| Mock tests imply real Devin works | Label evidence by boundary; Devin claim requires a real approved-project run after local test/typecheck/build gates. |
| QA rebuild changes persistent data/credentials | Reuse the stable QA data root, inspect lifecycle scripts first, and do not rotate tokens or reset DB. |

## Rollout gates

1. Baseline and freeze accepted UX/runtime contract in `docs/spec/provider-runtime-selection-and-integrations-ux.md`.
2. Add regression tests for selection persistence, persona independence, explicit unavailable states, grouped model catalogs, and settings feedback.
3. Implement one vertical slice across API contract, durable backend selection, FE chat launch, and run projection; preserve legacy read compatibility.
4. Run focused tests, API/web typechecks, and builds. Any real Devin/paid path remains gated until these pass.
5. Rebuild the fixed-port stable QA deployment without erasing its persisted QA data. Record matching revision/build and browser evidence in a new `docs/raports/qa-run-25/` report.
6. Keep Devin live execution marked unverified unless the real ACP run is actually performed and reconciled against bridge/HITL/native approval and tool audit evidence.

## Verification update — 2026-10-02

The implemented slice passed focused UI/API checks and the fixed-port QA build. In the rendered QA UI, one explicit Recheck returned Devin `Online`, `Logged in`, `ACP available`, with 773 dynamically discovered models. The new-chat fuzzy selector offered exact `swe-2` and the high/medium/max variants; selecting `swe-2` displayed its offer condition and October 16, 2026 expiry in the composer. Devin pricing makes the offer conditional on Devin Pro or higher; the CLI status cannot verify the signed-in account's plan. No Devin task was dispatched, no token was rotated, and no production deployment was made. Full evidence and limitations are in `docs/raports/qa-run-25/report.md`.

## Known open decisions

- “Comet” must be disambiguated; CometAPI may be a provider endpoint, while a product named Comet may be a different category.
- Define exact precedence for persona recommendation versus saved conversation choice; baseline recommendation is only an initial value for a new chat, while an explicit user choice wins and is persisted. No environment fallback unless explicitly enabled and shown.
- Keep legacy persona-bound runtime fields until migration and historical session behavior are proven.

## Current evidence boundary

### QA80 desktop/compact review — 2026-10-03

The existing `NewChatScreen.tsx` implements the desktop/compact split with `lg` visibility classes. All seven supplied QA80 PNGs were inspected: `docs/raports/qa-run-80/assets/launch-desktop-1440.png` and `launch-config-{320,390,820}.png` / `launch-prompt-{320,390,820}.png` in that directory. At 1440x900, all three fields appear together and Next/Back are absent; at 320/390/820x900, the captures show configuration then prompt with SWE-2 in the header and an unsent draft. No desktop discrepancy was found.

The parent-owned `apps/e2e/tests/qa-live-launch-wizard.spec.ts` includes desktop visibility/Next/Back assertions and compact model/header, overflow and Back/Next model/draft checks. Parent reports PASS in 3.6s against fixed local QA `http://localhost:5288/`; the sidecar reviewed artifacts without rerunning browser/test/build or dispatching a model request. Desktop capture precedes SWE-2 selection and does not prove a selected desktop pair. QA79 `8aad6e4` remains prior narrow evidence, not a QA80 served-build receipt.

Verdict: CONDITIONAL for launch layout only. Exact breakpoint edges, desktop selection interaction, accessible input/reflow, refresh/reconnect and served revision remain unverified. Real Devin launch/tool/approval/completion proof stays the parent's top priority; UI proof does not close it. The 320px configuration capture starts with the card's top outside the frame; scroll cause and initial visibility need confirmation before treating it as a defect. Detailed acceptance matrix and remaining gates: `docs/raports/qa-run-80/desktop-review.md`. Historical observations below retain their original run boundaries.

QA run 27 isolated a 60-second approval/transport mismatch: cancelled writes were not human denials. Run 28 adds protocol-native progress during actual pending approval, cancellation forwarding and the missing tool:start event. RED/GREEN HTTP/protocol tests and backend static gates passed. This does not yet prove genuine Devin's outer timeout, durable tool history, or Home Site completion; these remain release-blocking evidence gaps.

### Follow-up: live run 26 and reboot

User-approved SWE-2 execution reached real Kalio bridge reads and a confirmed App.jsx write in Home Site. CSS retained its original hash after reboot; no successful generated-project build was proven. The runtime must not be described as fully working yet.

User additionally requires sequential compact-screen creation, removal of duplicate/stale thinking indicators, and a provenance-labeled tool timeline. The first two have focused frontend implementations/regressions; actual compact-browser proof and persisted tool timeline remain acceptance gates. Sidebar showed Completed while the durable run was active, and generic turn audit recorded the persona model rather than the effective ACP model. Both are trust/correctness defects, not polish.

Recovery preserves the AppData QA database and exact project, restarts only the owned QA stack, and inspects pending approvals before any continuation. No automatic retry of the interrupted write is authorized by process startup alone.

### Reconciled live evidence — 2026-10-04

The run-26 unfinished project boundary is superseded by QA144's actual approved SWE-2 build, QA164's single-command preview recovery, and QA161's rendered React demo audit. Devin now has real queue, Stop, denial, host-reset/F5/recovery and user-only interruption evidence; ChatGPT/Codex has queue, Stop, denial and backend-restart/warm-follow-up evidence. These are exact scenario closures, not blanket production readiness.

QA156 closes the reproduced desktop-to-compact draft hiding regression. QA163 closes lost error display after F5 when no assistant message was saved. QA164 system events establish a Windows restart during QA162's process loss; no application crash cause is inferred. Provider settings remain protected; no new autostart behavior is authorized or implemented by this update.

Required before a whole-goal/release claim: reconcile remaining integration settings and token behavior, validate tool/native provenance and user-visible states across required surfaces, finish owned source commits and matching gates, and obtain broader process-spam proof. Neutral external-agent interruption wording is local/tested, not served yet. See `docs/raports/qa-run-165/report.md` for the consolidated evidence matrix.

QA UI/API were reachable on `localhost:5288` / `127.0.0.1:3316` during inspection. The visible Home Site bridge was not ready. The UI showed mock as environment fallback, five Claude cards, 773 Devin models, and an unavailable workspace permission. No token was generated and no Devin run was started in this inspection. Prior run 24 proved one historical, read-only Devin SWE-2 `fs_list`; it is not evidence that this new flow works now.
