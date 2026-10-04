# QA114 — Codex model admission regression fix (local)

2026-10-04. Starting HEAD5cd80ae plus preserved unrelated dirty work. No live prompt, QA restart, provider edit or HomeSite edit.

Four fail-first tests demonstrated thread/start was attempted without reading model/list for unavailable, empty, hidden-only or malformed catalog cases. Runtime source now reads the picker-visible catalog from the same connection before thread creation/resume, rejecting an unspecified/unavailable model with a recheck/select instruction. Catalog failures propagate fail-closed. No new process is spawned by the check beyond the existing getConnection operation; no configured-model fallback or user-profile deletion.

Verification: 22/22 tests across admission(5), catalog(10), lifecycle(7), Vitest1.33s exit0. Positive admission test proves the discovered model reaches thread/start; it intentionally stops there, not generation proof. Existing lifecycle tests use an explicit catalog mock and retain prior streaming/dynamic-tool behavior coverage. API tsc --noEmit exit0; nest build TSC0issues/SWC679files exit0 before final test-only addition. Source remains476LOC, below500limit.

| Acceptance | Status | Boundary |
| --- | --- | --- |
| Unavailable/hidden/empty/malformed admission | PASS local | No thread/start or turn/start |
| Exact discovered model accepted | PASS local | Thread creation boundary |
| Existing streaming lifecycle | PASS local | Catalog mock, protocol fixture |
| QA deployment and live UI error | OPEN | Built code not loaded into current QA process |
| Picker dynamic profile resolution/create validation | OPEN | Runtime guard does not implement picker changes |
| HomeSite Codex tools/HITL | OPEN | No live run yet |

No OS-wide CMD-spam or production-readiness claim. The existing fixed QA stays running with preserved settings; deploy requires idle-run checks, controlled restart and preview recovery.
