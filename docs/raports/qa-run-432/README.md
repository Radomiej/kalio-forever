# QA 432 — grouped launcher ownership queries

Date: 2026-10-05 Europe/Warsaw. Branch `codex/kalio-provider-runtime-ux`, initial HEAD `8a99cea5`. Fixed QA remains API PID 33020 / web PID 27052, ports 3316/5288, AppData QA data. Existing provider configuration and Home Site preview were not reset. Foreign dirty work preserved.

## Implementation

Extracted `stack-port-owners.mjs` from oversized `stack-manager.mjs`; launcher shrank by 53 net lines. Windows owner refresh, free-port validation and known-profile conflict checks issue one hidden PowerShell query for the requested group. Each lifecycle stage reads fresh state. Force-restart termination retains a fresh per-port query immediately before termination rather than reusing the group snapshot across kill operations.

Query process uses windowsHide, 10-second timeout and 64KiB output cap. Command interpolates only validated integer ports. Nonzero exit, spawn/timeout failure or malformed/unrequested ownership fails explicitly; it is no longer silently treated as a free port. A successful empty result remains distinct. Non-Windows retains lsof-per-port lookup; missing lsof now fails explicitly instead of pretending the port is free. No shared contracts, app bootstrap, credentials, model catalog or tool permissions changed.

## Verification

- Initial tests failed because the new resolver did not exist. This is a missing-feature baseline, not a behavioral RED reproduction of the old inline function. QA 431 remains the measured baseline for actual process churn.
- Resolver suite: 6/6 PASS, including a real Windows test binding two random loopback ports, identifying both owners as the test PID, then observing closure. Tests also cover one query per group, no cross-call cache, failed/malformed responses, empty result, and fixture Linux lsof behavior.
- Resolver + runtime-scripts + window/process monitors: 46/46 PASS, 0 skipped, system Node outside sandbox. Existing runtime-scripts tests largely inspect source invariants; they are not live startup proof.
- `node --check scripts/stack-manager.mjs`: PASS. No app build needed for this `.mjs` launcher extraction; backend/frontend built artifacts were unchanged.
- Full `node scripts/run-test-gate.mjs`: exit 0. Shared types/SDK builds and preflight passed. API: 276 files passed / 1 skipped, 2972 tests passed / 3 skipped, 79.58s. Web: 215 files / 1889 tests passed, 79.41s. Launcher wrapper: 14/14 passed, 19.22s. Early command output was truncated; counts come from final summaries, not a claim to have reviewed every logged line. Wrapper tests are not the complete browser E2E suite. The new resolver suite is separately proven regardless of root-gate inclusion.

## Read-only runtime measurement

Both monitors ready before `node scripts/stack-manager.mjs status --json`, UTC 2026-10-04 23:14:04.263. Launcher PID 21428, exit 0, status running, empty stderr. Process monitor: 311 samples, maximum gap 77.065ms (full test gate ran concurrently, so timing is not an isolated performance benchmark).

Captured launcher descendants: one PowerShell PID 43532 / parent 21428, plus its conhost PID 35584. The launcher itself had conhost PID 35220. The live source previously queried the two ports separately; the new runtime observed one query process for both. No restart or new Devin request occurred in this measurement. Both monitors exited 0 with empty stderr; window hook reported zero matching/unclassified events. This does not prove absence of visible flashes.

## Acceptance

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| PORT-01 grouped Windows owner reads | PASS for resolver and live status | boundary test, two actual listeners, one observed PowerShell | full optimized start/stop/restart not yet measured |
| PORT-02 fresh lookup, no stale PID cache | PASS for resolver | second lookup reports changed PID | OS race between lookup and termination remains existing boundary |
| PORT-03 failure is not a free port | PASS for resolver | rejected failed/malformed ownership fixtures | injected end-to-end launcher failure not exercised |
| PORT-04 preserve existing QA/user data | PASS for this non-reset slice | same running stack; only launcher/script files changed | no reset/restore claimed |
| WIN-04 no visible startup flashes | UNVERIFIED | no fresh full restart in this slice | pre-armed optimized startup test plus visible-window attribution |

[P2] Required before prod or explicit acceptance: optimized start/stop/restart runtime proof and unresolved visible-console attribution. Linux/macOS runtime proof is not claimed. This change reduces demonstrated process churn; it does not close the entire console bug, real Devin lifecycle matrix, Jev/Goal requirements or the overall Home Site objective.
