# AgentFlow Paid-Run Readiness Checklist

Paid/live LLM, CLI-agent, Copilot, Gemini, Codex, Xiaomi, or real-project AgentFlow runs are allowed only after this checklist is green.

For a zero-completion static check, execute:

```powershell
npm.cmd run agentflow:paid-readiness -- --static-only
```

This still validates the provider catalog and active credential, but it never calls the completion or Web Search smoke endpoints. The normal readiness profile performs one completion smoke capped at 64 output tokens.

For runs that require a stronger high-level/orchestrator model while the active credential remains on a cheaper worker model, set the required smoke model explicitly:

```powershell
$env:AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL='mimo-v2.5-pro'
npm.cmd run agentflow:paid-readiness
```

This command checks the managed Kalio API, live LLM provider state, saved/active credentials, active credential provider validation, stale running AgentFlow rows, and Codex CLI default model. A failing result is a hard stop.

## Cost-bounded release commands

Run the comprehensive workflow/edge suite for free against a fresh mock stack:

```powershell
pnpm release:workflow-gate -- --project-path E:\Projekty\company-site
```

Only after that gate passes, run the dedicated live canary. It requires explicit payment confirmation, verifies the exact effective provider/model, temporarily caps generation at 128 output tokens, runs one single-node/no-tool workflow from Talk, verifies reload persistence, restores the prior generation settings, and writes a secret-free receipt under the OS temp directory:

```powershell
pnpm release:paid-canary -- --confirm-paid --expected-provider openrouter --expected-model tencent/hy3
```

The paid canary intentionally accepts no project path and sends no project memory/browser/prior-decision context. `release:demo-gate` still requires `--project-path` for its mock-only first stage, then runs the context-free live canary after restoring the persistent QA stack. The old `release:workflow-gate -- --require-live` mode is removed because it could spend one live generation per E2E group.

When a release also needs proof that a live model can call a real project tool, use the separate bounded tool canary only against an explicitly disposable directory. It exposes only `fs_write`, forces manual HITL confirmation, refuses to overwrite its marker, allows two LLM iterations (tool request plus final response), verifies the exact file content and F5 hydration, removes its marker, restores HITL/allowed-path/generation settings, and writes a separate secret-free receipt:

```powershell
pnpm release:paid-tool-canary -- --safe-project-path E:\Projekty\test-kalio --confirm-paid --expected-provider openrouter --expected-model tencent/hy3
```

Do not point the tool canary at a real source repository or a directory containing valuable files.

Web Search is required only for flows that need live research or source persistence. For those runs, use:

```powershell
npm.cmd run agentflow:paid-readiness -- --require-web-search
```

If the only missing step is local credential activation, put the provider key in ignored `.env.test`, then run:

```powershell
npm.cmd run agentflow:activate-live-credential -- --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1
npm.cmd run agentflow:paid-readiness
```

For the current Architecture Debate release gate, OpenRouter is the preferred live provider. Put `OPENROUTER_API_KEY` in ignored `.env.test` or the process environment, then run:

```powershell
npm.cmd run agentflow:activate-live-credential -- --provider openrouter --model cohere/north-mini-code:free --base-url https://openrouter.ai/api/v1
npm.cmd run llm:probe -- --provider openrouter --model cohere/north-mini-code:free --base-url https://openrouter.ai/api/v1
npm.cmd run agentflow:paid-readiness
```

`agentflow:activate-live-credential` and `llm:probe` also infer OpenRouter from `OPENROUTER_API_KEY` when no explicit provider is passed.

Do not pass real keys in chat, commit them, or print them in logs.

## Hard Gate

- [ ] Focused backend regression tests pass for the touched AgentFlow/Architecture/runtime files.
- [ ] Focused frontend regression tests pass for touched AgentFlow/Architecture/Execution Graph UI files.
- [ ] Mock full-stack E2E passes for the exact flow shape being tested.
- [ ] API typecheck passes when backend/contracts changed.
- [ ] Web typecheck passes when frontend/contracts changed.
- [ ] Affected build passes where a build script exists.
- [ ] Backend coverage command is either passing or any unrelated coverage blocker is recorded with exact failing specs and reason.
- [ ] `npm.cmd run agentflow:paid-readiness -- --static-only` passes against the managed Kalio API before the dedicated canary.
- [ ] The active credential provider test inside `agentflow:paid-readiness` passes; saved/active DB state alone is not enough.
- [ ] If a separate high-level model is required, `AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL` is set and the high-level completion smoke passes.
- [ ] The Web Search config and smoke checks inside `agentflow:paid-readiness -- --require-web-search` pass when the paid flow requires live research/source persistence.
- [ ] No live AgentFlow is `queued`, `running`, or `waiting_on_orchestrator`; the paid canary refuses concurrent work.
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
