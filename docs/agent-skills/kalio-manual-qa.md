# Kalio Manual QA Skill

Installed skill path:

```text
C:\Users\Radomiej\.codex\skills\kalio-manual-qa\SKILL.md
```

This repository copy records the expected behavior for agents that only read repo docs.

## Core Rule

Test Kalio like a user, then support the conclusion with API/terminal evidence. Do not replace FE checks with backend polling.

## Required Setup

1. Read the current checkout's `AGENTS.md` and `docs/spec/local-dev-guide.md`; do not assume the main checkout path when using a worktree.
2. Inspect dev-servers MCP read-only inventory (`mcp_stack_health`, `managed_service_list`, `dev_session_list`) when available. Never invent or hard-code a service id. The repository's stable QA launcher is not automatically a Windows service or a registered dev-servers managed service; use the documented QA launcher when inventory shows no owned service.
3. Pick the right stack:
   - **Dev (hot reload):** `pnpm dev` → UI http://localhost:5188, API http://localhost:3016
   - **QA (stable dist):** `pnpm qa` or `pnpm qa:rebuild` → UI http://localhost:5288, API http://localhost:3316, isolated data under `%LOCALAPPDATA%\kalio-forever-qa`. Use this when the user requests the persistent QA profile.
   - **Managed QA (random ports):** `pnpm stack:start` → URLs from `pnpm stack:status`; use this when a disposable isolated profile is required.
4. Use `cua_repl` with Chrome or the in-app browser for manual UI flows. Inspect the live accessibility tree before choosing controls. Use repository Playwright tests for repeatable assertions or screenshot files; ensure browser teardown with `finally`. Do not assume a heading/control exists or leave a timed-out browser process running.
   - For responsive navigation, test both opening and closing via the same menu toggle, then test a navigation link separately. A link closing an overlay does not prove the close toggle is usable; report pointer interception or an obscured toggle as a defect.
5. Use API calls only as supporting evidence: health, run status, sessions, graph, chat.
6. Verify `/api/llm/config` and Settings → LLM Settings show the intended provider and source. Do not proceed if `.env` or a saved DB credential silently switches the stack to a live provider. The repo's paid/live readiness checklist also gates CLI-agent runs; a Devin model marked `[Free]` does not waive its hard gates. If static readiness fails, do not submit a live CLI/ACP prompt or silently change providers.
   - An explicit local Devin `swe-2` conversation has its own equivalent static preflight: `node scripts/agentflow-paid-readiness.mjs --api http://127.0.0.1:3316/api --static-only --devin-session <session-id> --expected-project-path E:\Projekty\home-site`. It validates that session's enabled strict profile, exact project/cwd, fresh authenticated catalog, local bridge, native filesystem/terminal denial, six-tool persona allowlist and manual per-write/command confirmation. It performs GETs only. Global direct-provider credentials are not substituted for this ACP profile; the default paid-provider gate stays unchanged. The check rejects existing children rather than claiming their status is safe without inspection.
   - This is snapshot readiness, not permission to execute or a claim that SWE-2 is free. Recheck immediately before the authorized UI action; runtime locking, VFS boundaries, tool policy and HITL remain authoritative. Pricing and the user's execution authorization are separate gates. Do not use the native profile flags for direct-LLM or AgentFlow paid canaries.
   - Exception only for a user-authorized single local free Devin ACP canary: keep Kalio's provider unchanged, record the failed gate and exact model/project/tool scope, and do not repeat or broaden access without fresh authorization. This does not waive paid-provider readiness.
   - For Kalio MCP HITL in a CLI/ACP run, keep the exact conversation open in Talk before starting the tool call. The inline Talk confirmation may fail to render even when Home → Ongoing actions has the pending card; if so, use a fresh QA tab on the same origin and review the exact path plus the audited payload before approving from Home. Observability is audit evidence, not the approval surface; ACP-level `mcp_approval: accept` is not the user's Kalio tool approval. In QA, stale requests were cancelled after about 60 seconds and the agent retried the same write: treat that cancellation as a timeout unless audit proves a user rejection, do not approve stale/duplicate cards, and do not repeat the write blindly. If AX click fails on the card, inspect the current screenshot before using coordinates.
7. Manual QA must allow both `localhost` and `127.0.0.1` origins so browser evidence is not invalidated by CORS. Use `localhost` for ordinary manual browser QA; prefer `127.0.0.1` for browser MCP automation if localhost bootstrap requests fail.
8. If the QA MCP tools are missing in Kalio, first copy `docs/examples/kalio-agent-qa-mcp.config.toml` into a real `.kalio/config.toml` and restart the Kalio API or wait for config cache refresh.
9. Treat `.vscode/mcp.json` import as legacy/manual fallback only. For repo/dev-managed QA MCP, start from `.kalio/config.toml`. If you use Settings -> MCP Servers -> Import Existing MCP Configs for debugging, remember that imported entries land in SQLite; equivalent TOML and SQLite rows may both stay visible, with TOML active and SQLite shadowed.
10. Do not use `~/.codex/config.toml` to diagnose Kalio MCP state; that file is Codex-only.
11. On Windows, Playwright/QA stack verification must use system Node outside the sandbox. If a run fails with `EPERM` on pnpm junctions or false `MODULE_NOT_FOUND` for installed dependencies such as `ajv`, rerun with system Node before treating it as a Kalio regression.

## QA Reports and Process Diagnostics

- Create one folder per attempt at `docs/raports/qa-run-N/`, using the next unused number. Put `report.md` and screenshots in `assets/` under that folder; never overwrite an earlier run.
- Record checkout and pre-existing dirty state, exact UI/API URL and ports, QA data root/mode, effective provider/model and source, exact target project path, browser/viewport, tested steps, console/network evidence when collected, PASS/FAIL/BLOCKED rows, and unresolved findings.
- Save real browser screenshots as files and link them from the report. If capture fails, state which screenshots are missing; do not describe tool-output images as saved artifacts.
- Treat agent prose such as “the user rejected the tool” as unverified. Reconcile the exact session's graph/tool count with `devin-cli-acp.mcp_bridge`, `devin-cli-acp.mcp_approval`, `devin-cli-acp.native_approval`, and HITL events; a native/policy `decline` alone does not prove a user rejected a request.
- Treat Settings → MCP Servers as global Kalio connectivity, not proof that a persona or Devin can call those tools. Keep raw browser-session, arbitrary navigation, and page-evaluation tools out of Devin; require an owner/project/origin-scoped facade plus direct-denial and audit tests before exposing browser capabilities.
- For a growing `cmd.exe` count, take only a bounded read-only before/after sample for the exact task-owned action, including parent and command line with secrets redacted. Correlation with Codex/MCP launchers does not identify a specific task or prove a leak. Stop repeated diagnostics when counts continue rising; do not terminate shared or unknown processes.

## Architecture QA

- If the user asks for the two-agent architecture, test the `Dev/Implementer <-> Goal Guard` loop. Do not substitute Five Minds, Deep Five Minds, or a generic deliberation schema.
- If the user asks about the target nested architecture, read `docs/spec/sub-agentflow-target-architecture.md`: `sub_agentflow` means a child graph/flow run, not a single child agent.
- Split runtime-flow proof from persona proof:
  - Flow/API/FE E2E tests verify supported transitions, graph routing, durable state, resume, audit/log events, tool evidence, and visibility in Chat/Execution Graph.
  - Persona/agent text behavior is simulated in flow tests and verified separately in stream LLM/provider tests such as `MockLLMProvider` specs.
  - Do not make live/paid QA prove prompt quality or individual persona cleverness; live QA may vary default personas and policies only after the mock flow contract is green.
- Start the task from Kalio FE, not directly from `/api/architecture-runs/async`.
- After starting a run, switch to Talk without reloading and verify the new root conversation appears.
- Verify both Chat and Execution Graph from the FE. Capture screenshots with Playwright Orchestrator.
- Execution Graph must update live enough to inspect current state. Console warnings, stale nodes, or frozen graph interaction are QA failures.
- Browser QA findings are not post-run notes. Feed failing Playwright Orchestrator evidence back into the `Dev/Implementer <-> Goal Guard` AgentFlow as structured resume context and require another implementation/review pass before final acceptance.

## Creating A New Workflow For Future Agents

Use this checklist when a future agent needs to add a new Kalio workflow instead of just testing an existing one.

1. Start from the current product model, not an ad hoc prompt chain:
   - Read `docs/spec/sub-agentflow-target-architecture.md`.
   - Use Architect as the authoring surface for schema-driven flows.
   - Reuse an existing preset/variant when the target behavior is only a specialization of an existing flow.
2. Define the workflow as explicit runtime stages, not one opaque "parallel agents" blob:
   - stage 1: `Orchestrator` or `Router dispatch`,
   - stage 2: role/participant fan-out,
   - stage 3: `Router merge` or summarizer,
   - stage 4: `Finalizer` or `Artifact`.
   If a stage exists conceptually, represent it as a node that can be inspected in Chat and Execution Graph.
3. Use node kinds deliberately:
   - `Agent / Role` for bounded persona work,
   - `Router` for routing, review, or guard decisions,
   - `Parallel` for fan-out only,
   - `Artifact` for the final output.
   Do not model an orchestrator as a fake parallel group, and do not collapse merge/finalization into hidden prompt logic when the UI must expose them.
4. Keep session and run lineage visible:
   - the parent chat should launch one root child workflow session,
   - branch sessions should sit under that root,
   - parent observers must be able to see descendants live,
   - a reload must reconstruct the same run from persisted sessions and run snapshots.
5. Define expected statuses before implementation:
   - graph/timeline/sidebar should support `pending`, `running`, `waiting`, `completed`, `blocked`, `failed`, `cancelled`,
   - missing status is a bug; treat unknown child outcome as `waiting` or `failed`, not silent success.
6. Save the variant with a durable name and keep the intended role model explicit. For top-level role patterns, prefer the reference model from `C:\Projekty\Agent-Architecture-Lab` or an existing Kalio architecture instead of inventing a new top-level taxonomy without need.
7. Do not call the workflow ready until this FE-first gate passes:
   - start it from Kalio FE,
   - confirm the root conversation appears in Talk without refresh,
   - confirm all expected child conversations appear in the sidebar live,
   - confirm the timeline shows planned stages even while later nodes are still `pending`,
   - confirm Execution Graph and chat bubble agree on statuses,
   - reload during the run and verify the same workflow resumes with the same child visibility,
   - finish with a terminal backend run state and visible final artifact text.

## Demo Repo Runs

For `C:\Projekty\TurboProject2` and similar demo targets:

1. Inspect git state before the run.
2. Create each run on a fresh branch from the last verified clean baseline, not from the previous run branch.
3. Use branch names `demoN` unless the user requested another name.
4. Preserve previous demo branches for review. Do not clean/reset/delete them unless explicitly asked.
5. Verify at the end: expected branch, known working tree state, build passed, deploy artifact exists, final screenshot exists.
6. Do not patch generated demo files manually. If the page fails QA, resume the Kalio AgentFlow and let the implementer agent repair it.

## Evidence Standard

Minimum evidence for "works":

- FE task start screenshot or Playwright action evidence.
- Conversations visible without hard refresh.
- Execution Graph screenshot.
- API run status and root session id.
- Target repo branch/status.
- Build output and deployed/static artifact check.
- Final page screenshot for generated websites.

If any part is missing, report it as uncertain. Do not claim 100%.
