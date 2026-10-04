# QA214 — Jev branch integration risk

2026-10-04. Read-only Git tree comparison. No actual merge/cherry-pick, index changes, reset, database modification, server restart or LLM invocation during diagnosis.

Compared committed current branch HEAD 954fc6a6 with installer branch 19d5c0c2 using common ancestor c436ca478feb82a65c6035e15a8496663b39ff14. Legacy three-tree `git merge-tree` prints a merge preview without changing checkout or index. Dirty working files are excluded from this preview and require separate ownership review.

Preview contains conflict markers in 18 files:

- apps/e2e/scripts/start-playwright-stack.test.mjs
- apps/kalio-api/src/modules/agent-runtime/codex-app-server-process.spec.ts
- apps/kalio-api/src/modules/agent-runtime/codex-app-server-process.ts
- apps/kalio-api/src/modules/agent-runtime/codex-app-server.host.spec.ts
- apps/kalio-api/src/modules/agent-runtime/codex-app-server.host.ts
- apps/kalio-api/src/modules/agent-runtime/devin-cli-acp.host.spec.ts
- apps/kalio-api/src/modules/agent-runtime/devin-cli-acp.host.ts
- apps/kalio-api/src/modules/agent-runtime/devin-native-tools.ts
- apps/kalio-api/src/modules/agent-runtime/execution-profile.service.spec.ts
- apps/kalio-api/src/modules/agent-runtime/execution-profile.service.ts
- apps/kalio-api/src/modules/chat/subagent-runtime.service.ts
- apps/kalio-api/src/modules/code-intelligence/project-ide-runtime.manager.ts
- apps/kalio-web/src/features/settings/registry.tsx
- apps/kalio-web/stryker.config.mjs
- docs/quickstart-user.md
- packages/@kalio/types/src/index.ts
- README.md
- scripts/runtime-scripts.test.mjs

[P2] Jev's source exists on the installer branch, but wholesale integration crosses the actual Devin/ChatGPT runtime boundaries under current QA verification. The installer-side Devin host keeps a static model list; the current branch has dynamic model/probe changes. Selecting their files wholesale would not preserve this branch's implementation.

Jev feature commit 43beadce changes shared contracts; shared settings commit ede6284b adds a migration and module. Repository guidance requires shared-contract PR review. Installer branch also includes REST authentication/loopback and bootstrap changes; protected files cannot be blindly replaced to obtain Jev.

Required integration gates: review exact Jev dependency slice and shared contracts; preserve dynamic model catalog, native permission semantics and process audit; reconcile durable HITL claims/Stop; migrate settings without losing credentials; verify control-plane FE/API transport consistently; affected focused tests/typechecks/builds; real bounded Jev decision on DEV; then provider-preserving QA deployment and real Devin/ChatGPT regressions.

This is an integration readiness report, not a claim that all textual or semantic conflicts were exhaustively reviewed. First broad outputs were truncated; conflict path inventory was recovered in a compact second preview. No conflict resolution or Jev deployment was performed. Main objective remains open.
