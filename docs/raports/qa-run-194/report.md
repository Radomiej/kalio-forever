# QA194 — durable history and superseded-turn regressions

2026-10-04. Local source verification on codex/kalio-provider-runtime-ux, HEAD 231b7f94 with preserved mixed dirty work. No new live LLM prompt, reset, provider mutation or deployment.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| SQLite assistant finalization preserves ownership and linkage | PASS | DrizzleMessageRepository actual in-memory SQLite tests, including conflicting session/role/turn/prompt rejection | Target browser proof is separate |
| Paginated history retains linked tool turns | PASS | Long and interleaved turns, prompt-only linkage, cursor/timestamp ties, missing references and foreign-session isolation | Large-history performance not measured |
| Superseded safe interrupted turns cannot resume as current | PASS | RunJournalService admission-order regressions, queued/cancelled/sibling negative cases; unsafe interrupted and human-wait visibility retained | Real restart scenario is not rerun here |
| Affected backend typing | PASS | System Node TypeScript --noEmit, exit 0 | Full release remains open |

Focused Vitest command: run src/modules/chat/drizzle-message.repository.spec.ts src/modules/chat/run-journal.service.spec.ts --reporter=dot. Two files, 35 tests passed, exit 0, 1.27s at 12:15:28. Executed outside sandbox on system Node; expected stale-run recovery warnings belong to fixtures. git diff --check for the three tracked implementation/test files passed.

This verification does not replace QA193 real swe-2 approval/build evidence or prove the entire goal. Remaining mixed chat runtime, UI and documentation changes still require coherent review and closure. Sandbox HTTP probes were denied by socket permissions, not evidence of a QA outage.

The repeated HTTP probes outside sandbox returned UI 200 and API /api/health 200. SessionsService validates session existence before delegating page reads. Repository interface mentions an InMemoryMessageRepository, but bounded source discovery found no such implementation in apps/kalio-api/src or packages; no claim of twin parity is made. No schema or shared contract changes are included.
