# QA249 — deterministic reasoning fixture and first browser attempt

2026-10-04. Added think(text) to the existing MockLLMProvider script grammar to exercise actual stream thinking chunks through the full stack. No real-provider setting, schema or runtime contract changed. Backend files remain under 500 LOC.

RED at 14:41:38: 1 FAIL / 35 PASS; reasoning chunk missing. Minimal parser and emission fix: think emits thinking=true, return stays text. GREEN at 14:42:03: 36 PASS; backend tsc exit0 and build zero issues, 680 files compiled. Full root suite not run; no full-release claim.

First browser attempt FAIL before sending: empty seeded mock-profile chat entered the production new-chat creator, whose Run correctly stays disabled without an eligible non-mock UI selection. This is fixture setup failure, not thinking behavior evidence. Prepared an existing conversation via the same socket fixture pattern used by Stop regression tests before retry.

Isolated API 59805 / UI 59804, DB data/playwright-stack/1791117796697-38640/kalio-e2e.db; fixed QA not restarted. [Failure screenshot](assets/fixture-welcome-disabled.png) copied before another run cleared test-results, verified 74800 bytes. Runner exited1 and shut down its owned test stack.
