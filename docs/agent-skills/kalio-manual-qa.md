# Kalio Manual QA Skill

Installed skill path:

```text
C:\Users\Radomiej\.codex\skills\kalio-manual-qa\SKILL.md
```

This repository copy records the expected behavior for agents that only read repo docs.

## Core Rule

Test Kalio like a user, then support the conclusion with API/terminal evidence. Do not replace FE checks with backend polling.

## Required Setup

1. Read `kalio-forever`, `C:\Projekty\kalio-forever\AGENTS.md`, and `docs/local-dev-guide.md`.
2. Use dev-servers MCP for Kalio lifecycle; managed service id is `kalio-955d95b1`.
3. Pick the right stack:
   - **Dev (hot reload):** `pnpm dev` → UI http://localhost:5188, API http://localhost:3016
   - **QA (stable dist):** `pnpm qa` or `pnpm qa:rebuild` → UI http://localhost:5288, API http://localhost:3316
   - **Managed QA (random ports):** `pnpm stack:start` → URLs from `pnpm stack:status`
4. Use Playwright Orchestrator for UI flows/screenshots.
5. Use API calls only as supporting evidence: health, run status, sessions, graph, chat.
6. Before a mock/local AgentFlow run, verify `/api/llm/config` shows the intended provider. Do not proceed if `.env` or a saved DB credential silently switches the stack to a live provider.
7. Manual QA must allow both `localhost` and `127.0.0.1` origins so browser evidence is not invalidated by CORS. Use `localhost` for ordinary manual browser QA; prefer `127.0.0.1` for browser MCP automation if localhost bootstrap requests fail.
8. If the QA MCP tools are missing in Kalio, first copy `docs/examples/kalio-agent-qa-mcp.config.toml` into a real `.kalio/config.toml` and restart the Kalio API or wait for config cache refresh.
9. Treat `.vscode/mcp.json` import as legacy/manual fallback only. For repo/dev-managed QA MCP, start from `.kalio/config.toml`. If you use Settings -> MCP Servers -> Import Existing MCP Configs for debugging, remember that imported entries land in SQLite; equivalent TOML and SQLite rows may both stay visible, with TOML active and SQLite shadowed.
10. Do not use `~/.codex/config.toml` to diagnose Kalio MCP state; that file is Codex-only.

## Architecture QA

- If the user asks for the two-agent architecture, test the `Dev/Implementer <-> Goal Guard` loop. Do not substitute Five Minds, Deep Five Minds, or a generic deliberation schema.
- If the user asks about the target nested architecture, read `docs/sub-agentflow-target-architecture.md`: `sub_agentflow` means a child graph/flow run, not a single child agent.
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
   - Read `docs/sub-agentflow-target-architecture.md`.
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
