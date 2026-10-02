# Provider, runtime and integration UX

Status: accepted product direction; implementation slice deployed to local stable QA and browser-verified; production migration/release pending
Last updated: 2026-10-02
Source: user walkthrough of the local stable QA UI, followed by read-only inspection.

## Goal

Make it obvious which connected service will execute a chat/run, which model is selected, what access it has, and whether it is ready. The user chooses an agent persona for role/instructions and chooses an execution provider/runtime for the conversation or run. Kalio must not silently substitute a provider or model.

## Product decisions

1. Persona describes role, system instructions, and persona-scoped capabilities. It may also recommend a default provider/runtime + model pair. On a new chat, that recommendation preselects a fuzzy-searchable provider/model picker; the user can keep it or choose a different connected pair. The chosen pair is persisted to the conversation/run and visible before and during execution.
2. Devin, Codex, cloud/hosted integrations, and configured custom providers should appear as usable execution choices only when connected/configured. Devin and Codex are first-class priorities. A mock provider is for development/test use and must not appear as an ordinary production/user choice.
3. A missing credential, disconnected integration, unavailable model, or failed readiness check is an explicit blocked/error state. No silent fallback to mock, environment credentials, or another model. Environment fallback is opt-in and its source is shown.
4. Integration connection/opt-in is a persisted user choice. Backend status refresh/reconnect follows that choice after startup; the UI shows pending, success, stale, and failure states promptly.
5. Integration cards represent a provider/service connection, not one card per model. Models are nested under that connection and explored in a searchable dialog/popover with counts and capability/readiness labels.
6. Consolidate duplicated provider health/active-provider summaries into one coherent status surface. Show configured, default, active-for-this-chat, and health as distinct concepts only where each distinction is useful.
7. Separate “Development environments” (VS Code, workspaces, projects and their bridge) from “Agent runtimes” (Devin CLI, Codex App Server, Claude Code, hosted agents). Use “Integration” for connection/authentication. These are Kalio UX terms, not claims that vendors share a universal taxonomy.
8. Version labels identify the component and owner, e.g. VS Code version vs Kalio bridge version. Explain whether a version is installed/current/update-available; do not use warning color without an actionable meaning.
9. Disabled permissions explain why, what state is missing, and how to resolve it. Do not render a bare unavailable toggle as though it were a user-controlled setting.
10. Run controls provide immediate pending/success/error feedback and show the project/workspace, persona, runtime/provider, and model that will be used. The selected provider/model remains legible through completion/reconnect.
11. Provider form actions use clear visual hierarchy: primary Add/Save action, visibly secondary Cancel action, with accessible focus/disabled states.

## Scope from the walkthrough

- Devin settings: capability switches reflect persisted state; token generation/save/fallback report outcomes without exposing the secret; recheck shows progress and result; large dynamic model catalog is collapsed and searchable.
- LLM settings: remove duplicate active/health presentation and hide mock from ordinary choices; show configured integrations/providers and explicit credential source/fallback behavior.
- Integrations: group multiple models/identities by service; clarify bridge version and permission availability; persist opt-in and refresh status on startup.
- Development environments: present VS Code and its projects/workspaces together, with per-project bridge readiness and actionable permission explanations.
- Chat/Run: let the user select persona and execution provider/model independently; use the persona's recommendation as the initial choice, persist the user's final selection, reject unavailable selections explicitly, and expose execution progress/errors.

## Compatibility and architecture constraints

- Backend remains the source of truth for persisted selection and runtime state; UI is a projection.
- Treat provider + model as one validated execution pair and persist a run/session snapshot. A later settings change must not rewrite the identity of an already-started run.
- A persona recommendation seeds a new conversation only. Persist the user's explicit conversation choice; if there is no valid recommended or saved choice, require selection. An invalid chosen pair blocks execution and does not fall through to another target.
- At run acceptance, persist an immutable resolved execution snapshot before dispatch. Retry/resume/reconnect use that snapshot, not current persona recommendations or provider defaults. A one-run override, if later introduced, must not mutate the conversation choice.
- Keep existing `ExecutionProfile` and persona-bound fields readable while introducing the new selection. Define a deterministic legacy migration/default and preserve old conversations; do not silently reinterpret history.
- Existing Devin ACP, Codex App Server, hosted Devin, direct LLM providers, MCP policy, credentials, HITL, and project/workspace isolation remain separate boundaries. Do not conflate an LLM API provider with an agent host/runtime.
- Never expose local tokens/secrets in status responses, UI text, screenshots, or logs. Token generation is a credential mutation and needs explicit user action.
- “Comet” in the walkthrough is ambiguous: resolve whether this means CometAPI (an OpenAI-compatible LLM provider) or another product before exposing a named choice. Do not treat a browser/assistant product as a model provider by assumption.

## Evidence ledger

### User-reported observations

- Bridge capability switch did not visibly turn green; token generation appeared to do nothing; recheck gave delayed/unclear feedback.
- Devin model list displayed a small inline sample plus hundreds of “more” entries.
- Mock appeared in LLM settings; provider health and provider list looked duplicative.
- Cloud/Claude appeared as many cards, one per model/identity.
- VS Code/project/bridge concepts were mixed with agent integrations; version color and unavailable workspace permission were unclear.
- Selecting a persona and pressing Run sometimes appeared to do nothing or showed errors; mock worked while the user expected Devin.
- Persona should represent personality/role, with provider/model chosen in the chat/run.

These are reports from the walkthrough and are not all independently reproduced.

### Observed in local QA before implementation

- Stable QA UI `http://localhost:5288/` and API `http://127.0.0.1:3316` were available at the time of inspection.
- LLM settings showed a mock environment fallback and a second provider/health presentation; effective `/api/llm/config` at the last recorded stack check was `mock/mock`, source `env` (see QA run 24; re-check before relying on it).
- Devin card reported 773 discovered models and rendered an inline sample with `+765 more`.
- Integrations showed five Claude cards.
- Home Site showed `Waiting / Bridge not ready`; the permission control showed `Unavailable` and was disabled.
- Token UI showed `Settings`; generation was not clicked because it could rotate local credentials. Thus whether token creation fails is not proven.
- This inspection did not start a Devin run and did not prove current Devin execution readiness.

### Verified after implementation (2026-10-02)

- Rebuilt stable local QA at `http://localhost:5288/` with API at `http://127.0.0.1:3316`; persistent QA data stayed at `C:\Users\Radomiej\AppData\Local\kalio-forever-qa`.
- One explicit Devin Recheck reported `Online`, `Logged in`, `ACP available`, and `773 discovered` models. The new-chat model picker dynamically included exact `swe-2`, `swe-2-high`, `swe-2-medium`, and `swe-2-max` options.
- Selecting exact `swe-2` displayed it in the composer and showed: “SWE-2 is free in Devin Desktop and CLI on Pro or higher through October 16, 2026.” This is a conditional promotion, not proof that the account is on an eligible plan.
- QA settings now separate Agent runtimes from Development environments, do not offer mock as a selectable LLM provider, and identify the QA mock environment fallback explicitly. No token was generated and no Devin run was started.
- Focused frontend tests (68), frontend typecheck/lint, backend session tests (43), backend typecheck/build, and fixed-port QA build passed. QA report: `docs/raports/qa-run-25/report.md`.

## Acceptance criteria

| ID | Acceptance |
|---|---|
| UX-01 | Each connected execution choice identifies service, runtime/profile, model, credential source, connection/readiness and permission boundary; no silent substitution. |
| UX-02 | Persona and provider/model are independently selectable; a persona's recommended pair is preselected, the user can override it in a provider+model fuzzy finder, and the final pair is persisted with the conversation/run and survives reload/reconnect. Legacy conversations remain readable. |
| UX-02a | Persona recommendation is only a new-chat seed; a missing/invalid explicit selection does not silently inherit a lower-priority target. Each accepted run snapshots the resolved target/model before side effects; retry/resume keeps it immutable. |
| UX-03 | Missing/unavailable provider or model blocks launch with actionable feedback; mock is absent from ordinary choices. |
| UX-04 | Integration opt-in and connection state persist; refresh/reconnect visibly reports pending, success, stale or error. |
| UX-05 | Models are grouped under one service/connection and searchable in a dialog; no unbounded inline catalog. |
| UX-06 | LLM provider state is not duplicated; default, active-for-chat, and health are clearly distinct where shown. |
| UX-07 | VS Code/project/workspace bridge is in Development environments; Devin/Codex/Claude/hosted executor connections are in Agent runtimes. |
| UX-08 | Version badges identify component, installed version, and update/readiness meaning; unavailable permissions explain cause and next action. |
| UX-09 | Run shows immediate progress and actionable errors and visibly names project, persona, provider/runtime, and model. |
| UX-10 | Add/Save and Cancel controls have accessible, unambiguous primary/secondary styling and keyboard behavior. |
| UX-11 | Focused FE/BE tests, API/web typechecks and builds pass; stable QA is rebuilt and browser-verified at 5288/3316. Devin model discovery and SWE-2 selection are browser-verified; actual task execution through Devin remains a separate gate and must use an approved project after local gates. |

## Open questions / explicit boundaries

- Resolve the intended product behind “Comet” before adding a named provider.
- Decide whether user-level default provider is separate from chat-level override; default must never override an explicit chat choice.
- Confirm which legacy persona profile/model fields remain editable during a migration period and when they can be retired.
- A healthy stable QA stack or mock E2E does not prove Devin ACP, Codex, hosted-agent, or production readiness.

## Related records

- `project-spec.md` — durable runtime contract and direction update.
- `docs/cto/provider-runtime-selection-and-integrations-ux.md` — CTO decision/risk brief.
- `docs/superpowers/plans/2026-10-02-provider-runtime-selection-ux.md` — implementation and proof plan.
- `docs/raports/qa-run-24/report.md` — prior stable QA / Devin SWE-2 evidence and limits.
