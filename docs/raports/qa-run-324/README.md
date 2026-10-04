# QA324 — child-session stop race regression

Date: 2026-10-04. Local API source fix, not deployed.

QA317 isolated Goal Guard cleanup reported Session not found during CLI stop. SessionRuntimeStopService already collects child ChatSession records before concurrent cancellation, but previously looked them up again after starting architecture/subagent cancellation owners. A deterministic regression reproduces removal between tree collection and CLI lookup.

Fix: pass the already-collected child record to CLI cancellation; root retains its normal lookup. Do not swallow not-found errors or CLI transport failures. Snapshot identifies ownership, not completion; actual CLI stop is still awaited and failures still prevent quiescence.

Regression initially reproduced the missing-child failure. A negative-test fixture initially returned the root for every lookup and was corrected to return the actual CLI record; that initial negative failure was fixture error, not a second product bug.

Verification: 27 tests passed (5 SessionRuntimeStopService, 22 SessionsController) with system Node outside sandbox. Includes real-stop failure propagation and concurrent architecture/subagent/pipeline cancellation ordering. API TypeScript --noEmit exit 0.

| Requirement | Status | Remaining |
| --- | --- | --- |
| Preserve collected child identity during concurrent cancellation | PASS (unit regression) | No repeated child lookup. |
| Propagate actual CLI stop failures | PASS (unit negative path) | Quiescence rejects transport failure. |
| Keep cancellation ordering and REST stop/delete regressions | PASS (unit) | Existing tests unchanged and green. |
| Isolated browser regression at rebuilt revision | UNVERIFIED | Build and rerun relevant Goal Guard cleanup required. |
| Fixed QA deployment | UNVERIFIED | Current QA still runs QA320 diagnostic build. |

No shared contract changes, project edits, real LLM requests or QA restart in this slice.
