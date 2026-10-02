# CTO note: provider/runtime choice and integrations UX

Date: 2026-10-02
Status: User-approved product direction; implementation slice verified in local stable QA; production release pending
Priority: P1 — users cannot reliably understand or select the executor for a core chat/run workflow.

## Decision

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

QA UI/API were reachable on `localhost:5288` / `127.0.0.1:3316` during inspection. The visible Home Site bridge was not ready. The UI showed mock as environment fallback, five Claude cards, 773 Devin models, and an unavailable workspace permission. No token was generated and no Devin run was started in this inspection. Prior run 24 proved one historical, read-only Devin SWE-2 `fs_list`; it is not evidence that this new flow works now.
