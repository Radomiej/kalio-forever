# QA190 — durable tool-confirmation turn linkage

2026-10-04. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-review HEAD 9979f44b plus preserved mixed dirty work. Fixed QA :5288/:3316, AppData kalio-forever-qa, backend QA167/frontend QA188 unchanged. No QA reset/deploy, provider mutation, live agent prompt or target-project operation.

Reviewed existing uncommitted HitlRequestService restoration change: pending confirmations carry durable turnId and valid string promptMessageId from continuation. Added negative regression for another session and malformed prompt linkage. These do not change confirmation authorization, destructive-tool policy, timeout or compare-and-set resolution. Restoring a request is not accepting/executing it.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Durable confirmation linkage | PASS locally | SQLite restore projection retains exact turn and prompt | Test re-queries SQLite; not a process restart |
| Session isolation | PASS locally | Other session receives no pending request | Live browser reconnect path separately scoped |
| Invalid/legacy prompt linkage | PASS locally | Non-string prompt id omitted; absent turn id remains absent | No fabricated chronological linkage |
| HITL/replay regression | PASS locally | 9 tests / 2 files, exit0 | Runtime helper's pending-confirmation race branch not newly exercised |
| API typecheck | PASS | System Node outside sandbox, tsc --noEmit exit0 | Full API suite separately pending |
| UI/screenshots | N/A in this local slice | No new UI action or rendered-behavior claim | Live F5 while approval pending remains a separate required proof |

Command: system Node Vitest run src/modules/hitl/hitl-request.service.spec.ts src/modules/chat/chat.runtime-hitl.spec.ts, then API tsc --noEmit. Exec handle 15099 explicitly completed exit0. Commit stages only service restoration and its spec plus this report. chat.runtime-hitl.ts's existing change depends on an uncommitted ChatService method and remains unstaged, avoiding a half-owned dependency commit. ChatService larger mixed diff remains preserved for dedicated review.

No claim that all HITL races, actual restart/reconnect approvals, CMD behavior or original goal are complete. QA remains on its already running deployment; no provider backup/restore needed because no runtime data was modified.
