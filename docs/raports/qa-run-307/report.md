# QA307 — separate catalog age from process validity

2026-10-04. Investigated QA306 preflight failure without restarting QA or changing providers. Backend GET models returns the cached catalog only when the host is connected and processEpoch matches. It intentionally does not start a CLI during polling. The preflight independently imposes a five-minute maximum age.

Fresh live read: host and catalog epoch both C2jXsGprEdPnHjnr_5ab0, connected true, requested gpt-6-luna present, catalog age 240.079 seconds. This does not retrospectively establish which part of QA306's compound check failed. The earlier report's recovery evidence remains valid, but mandatory manual recovery during normal chat is not proven by that check alone.

Split preflight diagnostics into epoch validity, five-minute age, and exact model membership. Kept all original rejection conditions and GET-only behavior. Expired catalog now explicitly directs the tester to scoped Recheck; no automatic status-triggered CLI startup was added.

Regression: old catalog with valid epoch and model reports only the age failure. RED 21 PASS / 1 FAIL; GREEN 22 PASS / 0 FAIL using system Node --test scripts/codex-profile-readiness.test.mjs. Existing wrong/unknown epoch, stale catalog, wrong model, active run and permission cases remain covered.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Distinguish stale measurement from host mismatch | PASS | Fail-first regression and 22 tests | Next live expired read should identify exact condition |
| Preserve no-process polling | PASS for changed scope | Script remains GET-only; backend unchanged | Cold startup/reconnect not closed |
| Real integration stability | UNVERIFIED for full scope | QA306 real read passed | More lifecycle and Home Site acceptance work remains |

No backend or frontend deployment required: only the local QA verifier changed. Transient console windows remain open under QA305.
