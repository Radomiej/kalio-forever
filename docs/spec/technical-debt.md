# Technical Debt

## Confirmation Policy Must Be Enforced In Code

Date: 2026-06-12

Current state:
- Native tools with default `requiresConfirmation: true` are not downgraded in-memory by `ToolRegistryService.setOverride()`, even if `/api/tools/:name` persists `false`.
- The Settings tool panel still exposes a generic reversible confirmation toggle for every tool.
- MCP discovery currently defaults discovered tools to `requiresConfirmation: false` unless the upstream MCP metadata says otherwise.

Debt:
- The destructive/non-destructive distinction is not yet a formal backend capability contract shared across native tools, MCP tools, persisted overrides, and settings UI.
- Confirmation for destructive tools must be enforced centrally in backend policy, not inferred only from UI toggles or upstream MCP metadata.
- Overrides should only tighten confirmation for safe/status tools; they must not disable confirmation for destructive/write/exec tools.

Acceptance:
- Backend rejects confirmation downgrades for destructive tools regardless of caller or transport.
- Destructive capability is classified centrally and reused by native tools and MCP tools.
- Settings UI reflects immutable confirmation for destructive tools instead of a generic on/off toggle.
- Regression tests cover native destructive tools, MCP tools, and persisted override reload.

## AgentFlow Runtime And Workflow QA

Date: 2026-06-04

### Paid Xiaomi Goal Master Proof Gaps

Evidence from run `G2fxR7yTPzkO5tpjzpO1m` against `C:\Projekty\TurboProject2` on branch `codex/paid-xiaomi-simple-workflow-proof`.

What worked:
- Active provider config and credential smoke passed for `xiaomimimo / mimo-v2.5 / db`.
- Goal Master AgentFlow emitted durable lifecycle trace: `started`, `node_started`, `tool_called`, `node_completed`, `return_to_orchestrator`, and `resume_input`.
- Codex CLI child created and committed `/workflow-proof` page in TurboProject2.
- Follow-up Codex CLI child added `docs/workflow-proof-design.md` and `docs/workflow-proof-research.md`, fixed text encoding, and committed the fix.
- Independent `npm run build` in TurboProject2 passed.

Debt:
- Xiaomi still returned `451 Unavailable For Legal Reasons` during long Goal Master branch calls even though direct `test-completion` smoke passed. The provider is usable for short smoke calls, but not yet proven reliable for full AgentFlow runs.
- The run stayed `waiting_on_orchestrator` after repeated Goal Master 451 failures. This is correct audit behavior, but it means paid proof cannot be marked `done`.
- `ResumeAgentFlowRunDto` uses `input`; sending `{ message }` silently records "Resume requested with no additional instructions." API ergonomics should reject unknown resume payloads or support `message` as an alias.
- Implementer slot initially lacked live `web_search`; it wrote research from model knowledge and later marked that honestly in the target doc. Workflow requirements that demand web search need tool availability checks before execution.
- CLI child status can be falsely marked failed when `expectedChangedFiles` includes speculative paths like `src/router.tsx` or `package.json`. Expected files must be derived from project inspection or treated as hints, not hard failure criteria.
- Goal Master fallback routed back to implementer after provider errors, but did not produce a terminal `blocked` summary after repeated provider failures.

Acceptance:
- A paid run may be called complete only when the AgentFlow snapshot reaches `done` or explicit `blocked` with a clear provider/tooling reason.
- Readiness should include a long/runtime-shaped Xiaomi smoke, not only a short credential completion smoke.
- Trace should expose the effective provider/model for each node so `mimo-v2.5` vs `mimo-v2.5-pro` drift is visible without reading logs.
- Resume API should validate payload shape and include the submitted input in `flow:resume_input`.
- Web-search-dependent flows must fail early or route to a node with `web_search`; they must not produce "research" while pretending live search happened.

Update 2026-06-04:
- `agentflow-paid-readiness.mjs --api <url>` now honors the explicit API base instead of silently reading the managed stack state.
- Paid readiness now scans recent AgentFlow snapshot trace events for Xiaomi 451/cross-border failures, so a run like `G2fxR7yTPzkO5tpjzpO1m` blocks the gate even if the parent chat projection is incomplete.
- AgentFlow resume now maps legacy `{ message }` payloads to canonical `{ input }`, preserving manual QA instructions in `flow:resume_input`.
- Remaining blocker: full Goal Master Xiaomi runs still need a provider/model-level fix for repeated branch-call 451s.

### Conversation-Started Workflow Is The Primary User Path

The Architect graph editor is for editing and inspecting presets. It is not the primary user path for a normal user run.

Debt:
- Manual and automated AgentFlow QA must start from a conversation where the user selects the target workflow.
- Graph Editor runs are useful for developer diagnostics, but they must be labeled as developer-path evidence, not user-path evidence.
- Existing QA notes should distinguish:
  - conversation-started workflow;
  - graph-editor preset run;
  - direct API run.

Acceptance:
- A paid/manual proof can identify the parent chat session, selected workflow, generated architecture/AgentFlow run, child/root session, and graph link from the conversation UI.
- The execution graph shows the workflow started from the parent chat, not only from Architect.

### Dedicated Orchestrator Persona

The product needs a persona whose only job is orchestration: interpret the user's vision, select or invoke AgentFlow workflows, analyze incoming context, route work to specialist agents, and hold the acceptance criteria.

Debt:
- The current fallback `default` persona is too generic for root/runtime orchestration.
- Runtime root sessions can still be seeded with `default`, which weakens evidence-first behavior when a schema does not explicitly override the root persona.
- Workflow slots already have stronger personas, but the root orchestration fallback is still a risk.

Proposed direction:
- Add a dedicated `agentflow-root` or `agent-orchestrator` persona for root workflow orchestration.
- Give it `architecture-agent-superpowers`.
- Keep model selection configurable per persona/slot later, but do not mix model routing into the current paid proof.
- Add a regression that root AgentFlow/Architecture sessions do not silently fall back to a bare `default` persona for important workflows.

Update 2026-06-04:
- `Goal Master Delivery Loop` already used `agent-orchestrator` for the orchestrator slot; the issue was prompt specificity, not the schema slot.
- `agent-orchestrator` now explicitly requires planning/prototyping, implementation, and refactor/QA phases; persisted research/design notes; changed files; branch/commit/build evidence; and parent/child/run ids in final artifacts.
- Existing DB personas are refreshed when `agent-orchestrator` lacks the new three-phase audit prompt.
- Remaining debt: the root session for an Architecture run still appears as `persona=default`; slot sessions are correct, but root metadata can confuse manual QA.

### Model Configuration Per Persona

Persona-level model selection would be useful, especially for routing cheap work to smaller models and review/orchestration to stronger models.

Debt:
- Current paid proof should use the active ordinary provider/model (`xiaomimimo` / `mimo-v2.5`) to reduce variables.
- Future persona model routing needs an explicit contract:
  - global default model;
  - persona preferred model;
  - workflow slot override;
  - runtime fallback when the preferred model is unavailable;
  - trace field showing which model was actually used.

Acceptance:
- Trace records effective provider/model per role execution.
- UI shows when a persona/slot used an override versus global default.
- Tests prove per-request model override reaches the provider request body and does not mutate DB credential model.

Update 2026-06-04:
- Subagent LLM audit events now include the effective runtime `provider`, `model`, `modelSource`, and the requested `personaModel` on request and response rows.
- This makes model drift visible during manual QA: for example the runtime can show active `mimo-v2.5-pro` even when a persona requests `mimo-v2.5`.
- Subagent LLM calls now pass a request-scoped persona model override through `LLMSource` / `LLMService.streamChat()` without mutating the active credential model.
- Seeded personas now default high-level orchestration/planning/review/release/synthesis roles to `mimo-v2.5-pro`, while execution/research/design/QA roles default to `mimo-v2.5`.
- Existing seeded personas with an empty stored model are backfilled on bootstrap; custom non-empty user models are not overwritten.
- Static routing audit confirmed the backend text LLM path still goes through the shared `LLMService` / provider factory. Per-request model override only swaps the model on the already-selected provider config; it does not bypass Xiaomi config or remap the provider. The observed `mimo-v2.5-pro` `451 Unavailable For Legal Reasons` is therefore tracked as provider-side cross-border policy/access, not a hidden runtime routing bug.
- Remaining debt: this currently covers chat/subagent LLM calls. Any future direct ArchitectureRuntime LLM path outside `SubagentRuntimeService` must carry the same override/audit contract.

### Auditability Criteria For Manual AgentFlow Proofs

Debt:
- Manual proof reports often conflate generated-project quality with runtime lifecycle correctness.
- A run can produce useful project changes but still fail runtime acceptance if it lacks build evidence, child status proof, or terminal final artifact.
- Old stale runs make `/api/agent-flows/runs` noisy and can obscure the current proof.

Acceptance:
- Before judging generated output quality, the tester can answer:
  - who started the workflow;
  - from which parent chat/session;
  - which workflow was selected;
  - which nodes ran and in what order;
  - which tools/child agents were invoked;
  - why the run is waiting, done, blocked, or failed;
  - whether a final artifact exists and whether it includes real verification evidence.

### False-Start Handling

Debt:
- If a run is started from the wrong surface, the test should stop it and explicitly mark it as false-start evidence rather than silently ignoring it.

Acceptance:
- Session notes include false starts with reason and run id when available.
- False starts are excluded from final success claims.

### Architecture Run Conversation Projection

Debt:
- Architecture runs started from the UI must appear in the conversation surface, not only inside the Architect graph editor.
- A user should be able to audit the run from the parent conversation: timeline card, graph link, branch/session links, final status, and final artifact or blocker.
- If an Architecture run only appears in the Architect editor, the workflow is not product-complete even when the backend run executes.

Acceptance:
- Starting an Architecture workflow from the normal conversation path creates or updates a parent chat message with `architectureRun` metadata.
- The parent chat renders `architecture-run-timeline`.
- The execution graph can open the architecture run from that parent chat card.
- Reloading the page preserves the run projection from durable chat/history data.

Update 2026-06-04:
- Backend async Architecture runs now persist the initial parent-chat projection immediately after run creation, before graph execution finishes.
- Clean Talk-started run `zXYvRz-GOBlv9FMANp-mT` persisted parent conversation messages immediately: `architecture:zXYvRz-GOBlv9FMANp-mT:user` and a terminal assistant failure projection in parent session `vNeJeOKVVxdwB-3jIHf5S`.
- Clean Talk-started run `2xdteJG6sw4cVNR0fmDqt` also persisted parent conversation messages for parent session `FA26urjLVVRTnkdVRv02q` and child/root session `arch-2xdteJG6sw4cVNR0fmDqt-root`; the failure projection included the XiaomiMiMo `451` provider error instead of leaving the run hidden or falsely running.
- Remaining debt: the frontend still needs a stronger conversation card/inspector contract for direct Talk-started Goal Master runs, including explicit graph focus metadata rather than only local FE projection.

### Stop Semantics For Architecture Runs

Debt:
- `Stop` must be reliable and auditable for both Architecture runs and AgentFlow-backed runs.
- If a stop request races with completion, the UI/API should make that explicit instead of leaving the tester unsure whether stop was ignored.
- A run that accepts a stop request should not continue spawning child agents or writing project files after the stop point.

Update 2026-06-04:
- `AgentFlowRuntimeService.stop()` now cascades to the runtime adapter, and `ArchitectureAgentFlowAdapter.stop()` delegates to `ArchitectureRuntimeService.stopRun()`.
- Normal `chat:stop` now also attempts to stop active AgentFlow runs associated with the stopped parent/root/child session.
- Architecture stop now reports the underlying Architecture run as terminal `cancelled` and appends a first-class `run_stopped` event.
- AgentFlow projection maps `run_stopped` to `flow:stopped` / lifecycle `cancelled`, with `reasonCode`, source, previous status, and the user-facing stop reason in the summary.
- Remaining debt: live manual stop still needs browser/API evidence on a controlled long-running run after provider access is fixed or a deterministic mock long-running run is used.

Acceptance:
- Clicking `Stop` while an Architecture run is queued/running produces a terminal `cancelled`/`stopped` status or a clear "already completed before stop" response.
- Trace includes a stop-request event with timestamp, actor/source, previous status, and final status.
- UI disables or relabels `Stop` once the run is terminal.
- Stop behavior is covered for:
  - direct Architecture run from Architect;
  - conversation-started Architecture workflow;
  - AgentFlow/Goal Guard durable run.

### Host Worktree Evidence Reconciliation

Debt:
- The conversation-started Goal Master Delivery Loop run `Ob_SIuSzaMExFOM_95nIu` launched a CLI child in `C:\Projekty\TurboProject2` and the target repo received commit `4d42fad` on branch `codex/paid-xiaomi-agentflow-proof`.
- The AgentFlow runtime still routed back to the implementer because verification relied on isolated VFS/tool evidence and did not reconcile the visible host worktree commit/build.
- Child CLI status was exposed later as failed/empty-output evidence even though the host repo had materialized changes.
- After resume-driven QA, the target repo reached final commit `737eaf3` with clean git status and passing `npm.cmd run build`, but the AgentFlow snapshot still returned to `waiting_on_orchestrator` while the underlying Architecture run remained `running`.

Acceptance:
- `spawn_cli_agent` / `get_cli_agent_status` evidence includes enough durable fields to audit child session id, workdir, branch, final status, last output/error, and commit/hash when available.
- Goal Master verification can explicitly inspect the host worktree when the workflow target is an external repo path.
- A child CLI timeout or failed status cannot hide already-materialized worktree evidence; the trace should say whether the worktree was verified, dirty, clean, built, or unverified.
- Final external QA evidence can be converted into a terminal `done` or explicit `blocked/finalization_missing` state instead of looping back to the implementer after accepted build/commit evidence.

Update 2026-06-04:
- AgentFlow projection now emits `blocked/finalization_missing` when Goal Master accepted host build/git evidence but the Architecture runtime fallback still routes away from `final-artifact`.
- This prevents a known false `waiting_on_orchestrator` projection after accepted external QA evidence.
- AgentFlow projection now also treats an explicit `externalQualityGate.status=passed` resume context as independent host verification for unresolved CLI child evidence. This prevents a later accepted `flow:final_artifact` from being overwritten by `flow:unresolved_cli_children` when the host QA evidence was supplied outside the child CLI runtime.
- AgentFlow snapshot merge now drops stale synthetic `flow:unresolved_cli_children` events when the refreshed runtime projection no longer contains that blocker. This keeps `/api/agent-flows/runs/:id/events` aligned with terminal `done` snapshots after external QA recovery.

### Last Real Proof Findings

Debt:
- Paid readiness only behaved reliably when `KALIO_API_BASE_URL` was set explicitly; the implicit local API target is not stable enough for proof runs.
- Parent projection can still report a reason that does not match the terminal runtime reason, so status and trace need to be checked together.
- VFS/tool context still drifts from the real host worktree context on some paths, which makes proof evidence look more complete than it is.
- CLI child reconciliation is still unresolved when child status lags or never settles, even if host files or commits already exist.
- The trace is still noisy enough that manual QA has to hunt for the real proof signal.
- Persona worker resolution is still not finished in the proof path, so the orchestration split is not yet fully proven.

Acceptance:
- Proof docs state the exact environment override needed for readiness runs.
- Parent projections and terminal runtime reasons match.
- Host/VFS/tool evidence and CLI child evidence reconcile to one terminal story.
- Trace output is short enough for manual review without extra filtering.
- Persona worker completion is explicit in the final proof path.

### Generated Project Proof Quality

Debt:
- Runtime proof can create a target-repo commit that builds but still be weak product evidence.
- The `TurboProject2` proof page currently uses mock runtime metrics/statuses instead of live AgentFlow data.
- Generated code can preserve or introduce mojibake/non-ASCII corruption in existing UI strings, which build checks do not catch.

Acceptance:
- Manual QA separates "AgentFlow lifecycle worked" from "generated app is shippable".
- Generated project review checks text encoding, visible UI quality, routing, and target acceptance criteria, not only `npm run build`.
- If the workflow produces mock proof content, the final AgentFlow artifact must label it as mock/demo and avoid claiming live runtime validation.

### Workflow Selection From Conversation

Debt:
- The tested conversation-started workflow was launched while the current parent session was a Graph Editor root session (`arch-M850F2q1JT1LIkJ_0KEeB-root`), so the product path is only partially proven.
- The normal user path must start from an ordinary chat session with the user selecting the workflow, not from a graph-run session reused as parent context.

Acceptance:
- A clean manual proof starts in a normal chat session, selects `Goal Master Delivery Loop`, starts the run, and records the resulting parent session id.
- The parent chat shows the selected workflow, child/root session link, AgentFlow/Architecture run link, and final waiting/done/blocked state after reload.

Update 2026-06-04:
- Clean normal Talk run `zXYvRz-GOBlv9FMANp-mT` was started from a new ordinary chat session using the `Goal Master Delivery Loop` selector.
- The run did not prove paid implementation because XiaomiMiMo returned `451 Unavailable For Legal Reasons` for cross-border isolation policy.
- Runtime auditability behaved correctly for this negative path: status became `failed`, trace included provider error details, and the parent conversation stored the architecture run projection instead of leaving a false `running` state.

### Execution Canvas Layout

Debt:
- Playwright evidence for the normal Talk proof found the architecture canvas/inspector panel positioned partly outside the 1440px viewport.
- This makes "Open child graph" and run inspection harder to trust during manual QA even when backend trace data is correct.

Acceptance:
- Opening the Architecture/AgentFlow canvas from a parent chat card keeps inspector content inside the viewport at desktop and mobile widths.
- Visual QA covers the parent conversation card, canvas open state, and graph/child-session navigation state.

### Paid Provider Cross-Border Gate

Debt:
- Paid readiness can pass provider credential/config checks while the first real chat completion fails with XiaomiMiMo `451 Unavailable For Legal Reasons`.
- The provider check is therefore too shallow for paid AgentFlow readiness when the target provider has cross-border policy controls.

Acceptance:
- Paid readiness performs a small real chat-completion smoke request through the same path used by runtime roles.
- Readiness fails closed with the provider error when cross-border access is disabled.
- Session notes record whether a paid proof failure was caused by provider access, runtime lifecycle, or generated-project quality.

Update 2026-06-04:
- Added server-side active credential completion smoke endpoint `POST /api/credentials/:id/test-completion`.
- `agentflow:paid-readiness` now calls this endpoint after model-list validation.
- A short noop-shaped completion smoke still produced a false-positive after backend restart while the real ArchitectureRuntime orchestrator request failed with XiaomiMiMo `451 Unavailable For Legal Reasons`.
- The completion smoke now uses an ArchitectureRuntime-shaped system/user request and realistic tool schemas (`spawn_cli_agent`, `web_search`, `vfs_write`).
- A later full prompt-shaped completion smoke still passed while the real `Goal Master Delivery Loop` orchestrator request failed with XiaomiMiMo `451`, so synthetic completion smoke is not sufficient by itself.
- `agentflow:paid-readiness` now also inspects recent parent conversation projections and fails closed when fresh Architecture provider failures are present.
- Live readiness now fails before workflow start when recent Talk-started Architecture runs contain the observed XiaomiMiMo `451 Unavailable For Legal Reasons` cross-border policy response, preventing another paid false-start.
- Quality gates must exercise the same runtime provider-resolution path as production. Alternate smoke/test entrypoints that bypass the runtime LLM service can hide Xiaomi base URL or header drift and should not be used as paid readiness shortcuts.

### Browser Title / Error-State Contamination

Debt:
- After the normal Talk run failed with XiaomiMiMo `451`, Playwright still observed the browser page title as `451 Unavailable For Legal Reasons` while the Kalio app content was visible.
- This makes manual QA confusing because a provider failure can appear as if the whole UI route is an HTTP error page.

Acceptance:
- Provider/runtime errors should be rendered inside the app shell without changing the document title to the upstream error title.
- Reloading or starting a new ordinary Talk session should restore a normal Kalio document title.

### AgentFlow Resume Routing Fidelity

Debt:
- Live paid TurboProject2 run `mWa64q6ZBCBVDNbjN86__` accepted `flow:resume_input` after an external build failure, but the resumed Orchestrator produced a detailed implementation directive without a parseable `route_to(...)`.
- Because no route was taken, the resumed graph ended as `blocked` with `flow:missing_final_artifact` instead of executing the planned Implementer fix.
- The implementation run also proved that a generated final artifact can correctly declare blockers while the runtime still needs a reliable "continue to implementer" path after QA feedback.

Acceptance:
- Resume prompts that contain blocking QA evidence must either route to the requested node or produce a terminal blocker that explicitly says "no route selected".
- The Orchestrator prompt/parser should accept the structured routerOutput `nextAction` or enforce a compact `route_to(implementer, reason)` command when continuation requires implementation.
- Manual QA for paid AgentFlow must include at least one failed external gate followed by a successful resume-to-implementation cycle.

### 2026-06-04 Live Resume Regression (Gq-bpKL4-B5ueq4lwhxed)

Debt:
- Live run `Gq-bpKL4-B5ueq4lwhxed` (parent session `paid-xiaomi-resume-routing-proof-20260604`) confirmed both `flow:resume_input` and `flow:return_to_orchestrator`.
- After resume, Implementer started `spawn_cli_agent` + `wait_for`, but the AgentFlow snapshot stayed `waiting_on_orchestrator`; no new file changes were observed in `C:\Projekty\TurboProject2`.
- XiaomiMiMo `mimo-v2.5-pro` still returned MiFE `451 Unavailable For Legal Reasons`; runtime tests should use `mimo-v2.5` for this paid path.
- Trace quality is still polluted by duplicated mixed-segment sequence numbers (e.g. repeated `125`) in this run, which obscures chronological review.

Acceptance:
- Keep this as blocking technical debt for the paid proof until resume-to-terminal behavior and sequence de-duplication are fixed, and host/tool evidence shows verified progress before claiming success.

### 2026-06-04 Xiaomi Model Mapping / Ordinary-Model Proof

Debt:
- `/api/llm/active/models` returns exact Xiaomi model ids including `mimo-v2.5` and `mimo-v2.5-pro`; the `mimo-v2.5-pro` failure is not a typo or missing model.
- Runtime audit shows model override/mapping works: persona defaults can name `mimo-v2.5-pro`, while the effective request model is overridden to `mimo-v2.5`.
- Full ArchitectureRuntime high-level requests can still receive XiaomiMiMo MiFE `451 Unavailable For Legal Reasons` on `mimo-v2.5-pro`, while simpler completion smoke can pass.
- Ordinary-model run `Z0clSjSB4g-SbJ83dBbeZ` using `mimo-v2.5` wrote files in `C:\Projekty\TurboProject2` and added the `/xiaomi-ordinary-proof` route, and host-side `npm.cmd run build` passed.
- The same run still remained `waiting_on_orchestrator` after repeated return-to-orchestrator cycles, so Kalio did not produce a clean terminal final artifact from the verified build evidence.
- Implementer behavior is still too CLI-heavy: it can spawn/read/wait repeatedly instead of making bounded direct edits and finalizing after a clear external gate.

Acceptance:
- Paid readiness must distinguish exact model availability, effective runtime model, and provider request-shape failures in one traceable report.
- A successful ordinary-model proof must end as `done` or a clearly reasoned `blocked`, not remain `waiting_on_orchestrator` after host-side build success.
- The final AgentFlow artifact must include changed files, build result, provider/model, parent session id, run id, and the reason why pro remains blocked if ordinary model is used.

### 2026-06-04 Orchestrated Launch Studio Paid Proof

Debt:
- Live run `rH7lbjvi5Sl4EaXWvgT3j` on `mimo-v2.5` created a real TurboProject2 page and design-debate document, but AgentFlow ended `blocked` because the Implementer CLI child timed out and the later resume produced `flow:missing_final_artifact`.
- Host-side evidence proved the generated project was valid after a small QA fix: `npm.cmd run build` passed, `/orchestrated-launch-studio` rendered from Turbo preview, and Playwright quality audit dropped from 4 high WCAG findings to 0 high findings.
- Resume with explicit host evidence was not accepted as a terminal final artifact; Orchestrator read the evidence and routed back to Implementer instead of finalizing.
- The design-debate document recorded general source names but did not persist concrete web-search URLs from the AgentFlow trace, so research persistence is still too weak for audit-grade runs.

Acceptance:
- A resume that contains verified host build/visual evidence must either create a final artifact or return a terminal `blocked` summary that includes that evidence, without routing to Implementer again unless a specific implementation defect is named.
- Implementer should avoid spawning CLI children for simple bounded file writes when direct file tools are available.
- Design-debate artifacts must store concrete source URLs or explicit "seeded/no live search" labels so manual QA can distinguish real research from prompt-provided heuristics.

Update 2026-06-04:
- Runtime regression coverage now proves `flow:missing_final_artifact` blocked snapshots can be resumed with external QA evidence.
- ArchitectureRuntime regression coverage now proves a passed external QA resume can re-enter the last completed Goal Master even when the latest cursor points at a later Orchestrator attempt and pending Implementer.
- Live run `rH7lbjvi5Sl4EaXWvgT3j` was resumed with external host evidence and reached terminal `done`: `flow:resume_input` -> Goal Master -> `flow:final_artifact` -> finalizer completed.
- Audit log confirms the effective request used `provider=xiaomimimo`, `requestModel=mimo-v2.5`, and `personaModel=mimo-v2.5-pro`, so the ordinary-model fallback is traceable.
- AgentFlow trace merge now has regression coverage for strictly increasing event sequences after resume refresh merges architecture events.
- Agent Orchestrator seed now requires persisted research/design notes to include concrete `web_search` source URLs, or an explicit `seeded/no live search` label when live search was unavailable or unused.
- Fresh live run `0SsbHDnwO_7ZuwzYZjNHn` proved the fallback half of the research-source contract: the generated audit note persisted `seeded/no live search`, `web_search Used: No`, and `Source URLs: None`.
- Live `web_search` URL persistence cannot currently be proven on the local stack because `/api/search/config` reports `configured=false` and `/api/search/test` returns `Web search not configured`. Unit coverage proves `offline_search=false` persists online results through `MemoryService.ingestWebSearchResult`; a paid/live proof still needs a configured search API key.
- `agentflow:paid-readiness` now checks `/api/search/config` and `/api/search/test`, failing closed before paid research/source-persistence runs when Web Search is not configured.
- `agentflow:paid-readiness` can now run an additional model-specific completion smoke with `AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL`, allowing `mimo-v2.5-pro` to be tested without changing the active worker credential model.
- 2026-06-05 live recheck with `AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL=mimo-v2.5-pro` failed again with XiaomiMiMo MiFE `451` cross-border isolation policy, so `mimo-v2.5-pro` remains an external/provider access blocker for the requested high-level proof.
