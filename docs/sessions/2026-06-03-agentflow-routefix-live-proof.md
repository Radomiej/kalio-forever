# 2026-06-03 AgentFlow routefix live proof

## Scope
- Fixed runtime drift found during `C:\Projekty\TurboProject2-demo70` paid proof.
- Goal: prove Architecture AgentFlow can run from Kalio FE, route through graph nodes, delegate implementation to the Implementer slot, verify evidence, and finalize without Orchestrator spawning durable CLI children.

## Root Cause
- Orchestrator had access to CLI-agent tools by default and used them instead of handing execution to the next architecture node.
- Implementer default CLI backend preferred Copilot; live child prompts were truncated in prior runs.
- Router parser accepted `route_to(node, response)` but not the named form emitted by live Goal Master output: `route_to(targetNodeId='implementer', ...)`.

## Changes
- Orchestrator CLI-agent tools are now hidden unless `allowArchitectureOrchestratorSubagents === true`.
- Orchestrator persona now keeps execution inside the graph by default and prefers `route_to(targetNodeId, response)`.
- Implementer default CLI backend policy now prefers `codex` and only uses Copilot as explicit fallback.
- `route_to(...)` parsing now accepts named target arguments such as `targetNodeId='implementer'`.

## Verification
- Focused test: `npm.cmd --prefix apps/kalio-api run test -- src/modules/architecture/architecture-role-executor.spec.ts`
  - Result: 43 tests passed.
- Backend architecture gate: `npm.cmd --prefix apps/kalio-api run test -- src/modules/architecture src/modules/agent-flow`
  - Result: 20 test files passed, 277 tests passed.
- Paid readiness on isolated stack `http://127.0.0.1:57453/api`
  - Result: passed, provider `xiaomimimo`, model `mimo-v2.5`, Codex CLI default `gpt-5.4-mini`.
- FE-driven live run from `http://127.0.0.1:57454`
  - Run ID: `zjC1CWCbNF7u5wcmLD3Vi`
  - Status: `done`
  - Orchestrator tools: `fs_list`, `fs_read`
  - Orchestrator `spawn_cli_agent`: `0`
  - Implementer child agent: `codex:completed`
  - Goal Master route: `final-artifact`
  - Final artifact status: `accepted`
- Target repo verification:
  - File exists: `C:\Projekty\TurboProject2-demo70\src\runtimeProofDemo70RouteFix.ts`
  - Content: `export const runtimeProofDemo70RouteFix = 'agentflow-demo70-routefix-20260603';`
  - Manual build: `npm.cmd --prefix C:\Projekty\TurboProject2-demo70 run build`
  - Result: passed.

## Browser Evidence
- Before/configured/running/done screenshots were captured by Playwright Orchestrator.
- Final runtime signals for FE page passed with zero console, network, or page errors.

## Remaining Risks
- The verifier still exhausted its local subagent loop once, but runtime continued because tool evidence existed and downstream Tester/Goal Master verified the result.
- Fixed port `5188` can still be stale or confusing when multiple manual dev processes exist; isolated stack ports remain the reliable proof path.
