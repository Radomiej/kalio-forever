# QA166 — local full chat-module regression gate

2026-10-04. System Node outside sandbox, Vitest over src/modules/chat. This is a local gate, not a live QA/browser run.

Initial result: 629 passed, 1 failed across 60 files. Existing subagent regression expected one durable error fallback after streamed text followed by stream failure, but observed two persistence calls. Inspection established different message IDs: the shared runtime's new partial-history save plus SubagentRuntimeService's existing terminal error fallback (nanoid). This was not merely an idempotent upsert or an assertion count to loosen.

Fix: keep error-fallback ownership with SubagentRuntimeService for the subagent audit domain; the shared runtime's new exception-path partial persistence applies to chat. The existing subagent regression was preserved unchanged. Ordinary failed-chat history tests remain intact.

Focused result: 38 passed in subagent-runtime.service.spec.ts and llm-turn-runtime.failed-history.spec.ts. Full rerun: 630 passed in 60 chat-module test files (12.35s). API typecheck passed. Backend build passed with zero TSC issues and 680 SWC-compiled files. Deployment/live verification are still pending for this latest source change; QA remains on the earlier backend process. Mixed runtime worktree changes require ownership/dependency review before a source commit. Runtime service is 497 LOC, below the hard limit.
