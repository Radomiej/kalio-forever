# QA390 — terminal-error graph description regression

2026-10-04. Local source slice only; fixed QA not rebuilt or restarted.

Found `withRecordedTurnModels` replaces node detail with `buildTurnIdentity` detail derived from done alone. That overwrote the graph's error evidence with a completed lifecycle label. Preserve existing status and actual runtime identity, but label done/error turn detail `Turn ended with errors`. No attempt to infer cancellation from message prose, suppress historical tool errors or alter runtime lifecycle.

Added regression through real graph builder and runtime-identity hydration. Initial test 1 FAIL / 3 PASS, then graph identity/presentation 15/15 PASS. Initial typecheck exposed two invalid test-fixture fields; corrected to typed cancellation error object and omitted optional prompt ID. Subsequent typecheck produced no diagnostics. Full frontend suite and browser proof of deployed fix remain pending.

Only executionGraphTurnModels.ts and its test changed. Foreign-dirty model/helpers untouched. Overall goal active; console attribution, Jev and full acceptance remain open.
