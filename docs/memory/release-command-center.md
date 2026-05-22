# Release Command Center

## Mission

- Goal: continue in loop fixing release blockers until the app is genuinely release-ready, not just superficially green.
- PM rule: no single-agent trust. Every meaningful implementation must be checked by PO and QA from at least one additional angle.

## Team Roster

- PM: orchestration, priority, delivery tracking, acceptance decisions.
- Product Owner agent: defines acceptance criteria, user-facing completeness, and release scope discipline.
- QA Manual agent: verifies UX, flows, copy, edge cases, and "80% done" creative gaps.
- QA Auto agent: validates tests, deterministic checks, smoke coverage, and regression risk.
- Backend Dev agent: backend/runtime fixes, contracts, persistence, process resilience.
- Frontend Dev agent: UI, UX, interaction safety, visual polish, accessibility.
- DevOps/Release agent: startup, build, CI, typecheck, environment parity, Windows-specific behavior.

## Working Rules

- Always keep at least 2 active agent roles per work cycle.
- Dev work should be delegated first; PM verifies outcomes and may reject partial work.
- Manual QA and automated QA are separate gates.
- Long-term findings belong here in `docs/memory/` and session-level implementation logs belong in `docs/sessions/`.

## Release Metrics

- Dev startup via `start-dev.cmd`: PASS on latest PM verification.
- API smoke `http://localhost:3016/api/sessions`: PASS (200) on latest PM verification.
- Web smoke `http://localhost:5188/`: PASS (200) on latest PM verification.
- Backend Telegram connect resilience: PASS for immediate polling-failure cases; broader operational conflict handling still monitored.
- Backend typecheck warning debt: PASS for current build/typecheck gates after config hardening.
- Backend build contract `apps/kalio-api/dist/main.js`: PASS after PM rejection/rework of initial tsconfig fix.
- RA-App iframe message hardening: PASS for inline-vs-served trust boundary and spoofed source rejection.
- Known failing test suites intentionally tolerated: OPEN and must be audited before release sign-off.
- Frontend coverage confidence on peripheral UX surfaces: OPEN.
- RA-App security review for iframe messaging: PARTIALLY CLOSED; core injection vector fixed, more edge-case coverage still possible.
- Embedding credential storage parity/security review: OPEN.
- Frontend production bundle size warning: OPEN.

## Current Active Agents

- PO/QA audit agent: completed initial release-readiness sweep and identified product/quality gaps.
- System audit agent: completed initial backend/runtime sweep and identified infra and recovery risks.
- Backend Dev agent: completed TypeScript config warning/build-contract slice after one rejected iteration.
- Frontend Dev agent: completed RA-App iframe message hardening slice with test-first validation.
- QA Auto agent: verified both slices on narrow tests plus PM acceptance gates.
- Next PO/QA + Dev pairing: choose next release blocker from failing suites, coverage gaps, or credential security.

## Prioritized Backlog

1. Audit and resolve known failing RA-App test suite or explicitly quarantine it with sign-off.
2. Raise confidence on frontend release surfaces with targeted tests for settings, memory, and observability UX.
3. Review embedding credential storage parity vs encrypted LLM credentials.
4. Address frontend production bundle size warning with code-splitting or chunk strategy.
5. Re-run release gates from multiple angles: startup, typecheck, targeted tests, smoke, manual UX.

## Current Sprint Slice

- Slice owner: PM rotating team.
- Last completed slices:
  - TypeScript config warning/build-contract hardening.
  - RA-App iframe message trust-boundary hardening.
- Next candidate slice:
  - release-signoff decision on pre-existing failing RA-App suite vs explicit quarantine.

## PM Notes

- The app is no longer in obvious startup-regression territory, but it is not release-ready yet.
- The main risk is false confidence from green-ish primary flows while secondary quality/security/reliability gaps remain.
- PM rejected one superficially green tsconfig fix because it broke the real `dist/main.js` contract. Build-shape validation is mandatory, not optional.
- Current posture is improving: startup is stable, config noise is lower, and RA-App iframe trust boundary is tighter.