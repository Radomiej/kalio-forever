# QA195 — shared admission and approved-tool regression gate

2026-10-04, HEAD 46b939fd, preserved mixed dirty source. Local backend gate only; no QA reset/deploy, provider changes, target-project writes or new live LLM invocation.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| One session reservation and stale cleanup isolation | PASS locally | SessionExecutionAdmission tests: synchronous reservation, drain barrier, repeated Stop, stale release, other-session independence | Live runtime acceptance remains separately scoped |
| Approved effect cannot execute twice | PASS locally | SQLite HITL continuation fixtures: simultaneous approval, cursor claim, result acknowledgement failures and retry rejection | Tool/provider execution mocked in these fixtures |
| Stop fences follow-up until durable cleanup | PASS locally | Stop during admission, approval persistence, tool-result persistence, resumed LLM and journal completion | No physical CMD-window measurement |
| Busy admission does not invalidate a still-pending confirmation | PASS locally | resolveToolConfirmation with actual ChatService and pending SQLite request | UI interaction not rerun here |

System Node outside sandbox: Vitest run session-execution-admission.spec.ts, chat-resumed-worker.spec.ts, __tests__/chat.service.spec.ts, __tests__/session-pipeline.service.spec.ts, __tests__/chat.gateway.spec.ts --reporter=dot. Five files, 133 tests passed, exit 0, duration 2.10s, start 12:18:22. Output was truncated by the tool; final suite counts and exit status are observed, not a claim that all emitted diagnostics were audited. Expected failure fixtures emit preparation/acknowledgement/abort errors.

Reviewed complete implementation text for admission, resumed worker and input helpers, plus ChatService/runtime-HITL and pipeline diffs. The new worker spec was partly truncated on first read; a focused reread recovered the approval/Stop/result-persistence section. Remaining gateway/pipeline test diffs and callers still need coherent review before staging this runtime bundle. No source mutation or commit of that bundle in this run.

Original goal remains active. QA193 real swe-2 build proof and QA187 real ChatGPT/Codex file-read proof are separate reports; this gate alone does not prove full product closure.
