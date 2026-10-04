# QA412 — safe catalog failure diagnostics

Date: 2026-10-05. Local API source/unit boundary; not deployed to fixed QA.

QA410 exposed a diagnostic gap: model discovery logs discarded string error codes, signals and killed status. QA411 recovered but could not establish the original failure cause.

Added code/signal/killed/durationMs to catalog warnings. String codes and signals are restricted to bounded OS-style tokens; unknown values are replaced with unknown. Message, stdout, stderr, executable, args and environment are not logged. Status/cache behavior and timeout remain unchanged. A killed process with SIGTERM is evidence of termination, not automatically proof of timeout.

RED: four new diagnostic cases failed against the old warning; two parser cases passed. GREEN: six catalog tests plus two command-queue tests passed. Cases include ENOENT, killed SIGTERM, numeric exit, and arbitrary metadata with secret message/output. Process boundary mocked to avoid real CLI launches. API typecheck completed with exit 0; scoped git diff --check passed (line-ending warnings only).

| Acceptance | Status | Remaining |
| --- | --- | --- |
| Distinguish safe failure metadata | PASS (unit) | Real failing command and deployed warning not exercised. |
| Exclude raw error/output secrets | PASS (unit fixtures) | No live output captured. |
| Preserve serialized command behavior | PASS (two queue tests) | Whole suite passed in QA410 before this change, not after. |
| Explain original QA410 failure | UNVERIFIED | Historical warning lacks required metadata; do not infer timeout. |

No QA reset, backend rebuild/deploy, Home Site edit, model change or credential mutation.
