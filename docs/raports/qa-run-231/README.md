# QA231 — Codex concurrent-start regression

Date: 2026-10-04. Local backend regression; fixed QA is not yet restarted with this patch.

[P1] Simultaneous getConnection calls could both pass the empty connection map and await the MCP policy before reserving a connection. The connection factory was consequently called twice for one auth profile. This is a unit-level reproduction of duplicate starts, not proof that it caused historical OS-wide CMD spam.

Fix: reserve a deferred connection promise synchronously, then read policy and start the process. Check the existing generation before invoking the factory, so a reset during policy lookup cannot start a superseded process. The existing profile-scoped host and reset contracts remain unchanged; no new permissions, schemas, or API fields.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| Reproduce simultaneous starts | PASS / RED | 14:04:09: factory called 2 times instead of once |
| One shared connection for simultaneous requests | PASS locally | Added regression now passes |
| Reset before spawn prevents factory invocation | PASS locally | Added negative-path regression |
| Existing reset-during-start and consumers | PASS locally | 24 tests, 3 files, 1.19s at 14:05:30 |
| Backend types | PASS | tsc --noEmit exit 0 |
| Backend build | PASS | Nest TSC zero issues; 680 files compiled |
| Deployed QA and real CLI process count | UNVERIFIED | Controlled deploy and cold/concurrent readiness scenario still required |

Tests: codex-app-server.host.spec.ts, native-cli-integration.controller.spec.ts, codex-app-server.llm-source.spec.ts. Expected fixture warnings cover thread-resume fallback and reset invalidation. A disconnected idle host remains a separate lazy-start behavior; durable user connection opt-in/startup restoration is not implemented by this patch.
