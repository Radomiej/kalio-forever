# AgentFlow Paid-Run Readiness Checklist

Paid/live LLM, CLI-agent, Copilot, Gemini, Codex, Xiaomi, or real-project AgentFlow runs are allowed only after this checklist is green.

Before any paid/live run, execute:

```powershell
npm.cmd run agentflow:paid-readiness
```

For runs that require a stronger high-level/orchestrator model while the active credential remains on a cheaper worker model, set the required smoke model explicitly:

```powershell
$env:AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL='mimo-v2.5-pro'
npm.cmd run agentflow:paid-readiness
```

This command checks the managed Kalio API, live LLM provider state, saved/active credentials, active credential provider validation, Web Search configuration/smoke, stale running AgentFlow rows, and Codex CLI default model. A failing result is a hard stop.

If the only missing step is local credential activation, put the provider key in ignored `.env.test`, then run:

```powershell
npm.cmd run agentflow:activate-live-credential -- --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1
npm.cmd run agentflow:paid-readiness
```

Do not pass real keys in chat, commit them, or print them in logs.

## Hard Gate

- [ ] Focused backend regression tests pass for the touched AgentFlow/Architecture/runtime files.
- [ ] Focused frontend regression tests pass for touched AgentFlow/Architecture/Execution Graph UI files.
- [ ] Mock full-stack E2E passes for the exact flow shape being tested.
- [ ] API typecheck passes when backend/contracts changed.
- [ ] Web typecheck passes when frontend/contracts changed.
- [ ] Affected build passes where a build script exists.
- [ ] Backend coverage command is either passing or any unrelated coverage blocker is recorded with exact failing specs and reason.
- [ ] `npm.cmd run agentflow:paid-readiness` passes against the managed Kalio API.
- [ ] The active credential provider test inside `agentflow:paid-readiness` passes; saved/active DB state alone is not enough.
- [ ] If a separate high-level model is required, `AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL` is set and the high-level completion smoke passes.
- [ ] The Web Search config and smoke checks inside `agentflow:paid-readiness` pass when the paid flow requires live research/source persistence.
- [ ] No live run is already stuck in `running` because of a stale runtime worker.
- [ ] The run context explicitly disables unavailable paid/CLI backends, or the UI proves the selected backend is available.
- [ ] The test scenario starts from Kalio FE when the requirement is FE+BE, not only from direct API polling.

## Mock E2E Must Prove

- [ ] The user can start the target flow from Kalio UI.
- [ ] Conversations show the AgentFlow run and linked child/root sessions.
- [ ] Execution Graph updates nodes, edges, tool evidence, and terminal statuses.
- [ ] Two-agent Goal Guard runs use Dev/Implementer <-> Goal Guard, not Five Minds.
- [ ] Max-step or return-to-orchestrator pauses become `waiting_on_orchestrator`, not hidden success.
- [ ] Resume with QA evidence can continue or block the run deterministically.
- [ ] Fake final answers fail when there are no files, no write evidence, stale CLI children, wrong schema, or failed external QA.
- [ ] CLI tools are hidden when CLI agents are unavailable, instead of being shown and failing at runtime.

## Evidence To Record Before Paid Run

| Evidence | Required value |
| --- | --- |
| Focused BE tests | command + pass count |
| Focused FE tests | command + pass count, if touched |
| Mock E2E | command + pass count |
| API typecheck | passed, if backend/contracts changed |
| Web typecheck | passed, if frontend/contracts changed |
| Build | passed for affected app/package |
| Coverage | current FE/BE status or exact blocker list |
| Screenshot | required for FE/manual QA flows |
| Paid backend policy | selected backend, allowed fallback list, disabled unavailable backends |

## Stop Conditions

Do not start or resume paid/live runs if any item below is true:

- A focused regression is red.
- Typecheck or build is red for the affected app.
- Mock E2E does not cover the exact target flow.
- CLI backends are only prompt-recommended, not enforced by runtime/tool visibility.
- Implementer can complete without required write evidence, or Goal Master can accept without verified Implementer/CLI proof.
- Conversations or Execution Graph cannot show the run status reliably.
- The latest live run is still `running` and cannot be reconciled from durable state.
- The active live credential fails provider validation, including `401 Invalid API Key`.
- Web Search is not configured or its smoke check fails for a paid flow that requires live research/source URL persistence.
