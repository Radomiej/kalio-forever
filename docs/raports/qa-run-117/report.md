# QA117 — Validated dynamic Codex profile resolver (local)

2026-10-04. Starting HEADd124894 with preserved dirty work. No live model generation, QA restart or provider mutation.

POST /runtime/profiles/codex/resolve accepts a nonempty model and authProfileId, requires an enabled configured Codex integration, reads actual model/list on that host connection, and rejects missing models before persistence. Resolution reuses only enabled strict profiles on the exact account/model without a custom provider; otherwise creates a deterministic strict profile. Existing profiles, approval settings and accounts remain untouched; matching disabled strict profiles are not re-enabled. Runtime model admission remains a second gate.

Three fail-first tests failed because the resolver was absent. After implementation, one test exposed that the old SQL fixture returned its first row regardless of id; that test now models exact id lookup rather than changing production SQL. Final13/13 service/controller tests PASS1.20s, API tsc --noEmit exit0, nest build TSC0issues/SWC679files exit0. Service268LOC. Tests prove model rejection, sequential idempotency and account/approval separation; concurrent insert recovery and actual SQLite persistence are not proven here.

| Acceptance | Status | Boundary |
| --- | --- | --- |
| Reject unavailable Codex model before persistence | PASS local | Actual catalog parser with request fixture |
| Deterministic strict profile/account isolation | PASS local | Service fixture, sequential requests |
| Build/typecheck | PASS local | No shared-contract changes |
| Picker dynamic discovery and resolver client | OPEN | Not implemented in this slice |
| QA deployment/runtime SQLite/live UI | OPEN | Existing QA process unchanged |
| HomeSite Codex tools/HITL | OPEN | No live prompt |

This is a backend prerequisite, not closure of QA116. Existing QA and HomeSite remain running; connect the picker and complete UI/local gates before deploying this slice.
