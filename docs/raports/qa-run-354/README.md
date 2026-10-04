# QA354 — durable human-wait bootstrap fix

2026-10-04. Source inspection traced HomeHitlInbox to agentStore pendingConfirmations, and App bootstrap/reconnect to the backend runtime-watchlist. SessionRuntimeWatchlistService considered in-memory confirmations and interrupted runs, but not persisted waiting_for_human runs. That omitted the session from bootstrap after process loss, while manually opening its chat restored the confirmation.

Minimal fix: include waiting_for_human runs using existing pending_confirmation reason and existing child-to-root grouping. No shared contract, approval policy, database migration or command execution change. Durable wait preservation remains intentional.

Fail-first regression: durable child wait with no active slot/no in-memory confirmations failed (1/4). After fix, watchlist/HITL replay/journal regressions passed 29/29 on system Node outside sandbox. Existing tests retain idle exclusion, root deduplication, interrupted-run watch and durable resume behavior.

| AC | Status | Evidence / remaining |
| --- | --- | --- |
| Durable wait included in bootstrap watchlist | PASS locally | New RED→GREEN regression |
| Preserve existing HITL/journal behavior | PASS locally | 29 tests |
| Typecheck/build | NOT RUN | Required before live deployment |
| Fixed QA fresh-browser Home parity | UNVERIFIED | Source fix not deployed |
| Real Devin approve/resume exactly once | UNVERIFIED | Needs controlled live test |

Overall UNVERIFIED for QA delivery. Source patch only; do not label QA fixed yet. Home Site resize/build remains outstanding.

## Build and deployment follow-up

API typecheck exited0; Nest build exited0, TSC0 issues, SWC681 files. Before deployment, both approved Devin/Codex sessions' current-run endpoints returned zero bytes and runtime-watchlist was empty. Managed fixed-QA restart from built dist succeeded with same AppData database, no reset. Logs backend-1791141178165-9248.log / frontend counterpart. Browser displayed preserved Devin history and cancelled old build/Interrupted state (no active Stop or Confirm); reconnect banner was still visible in this first observation, so reconnect completion is not claimed.

Local code gates and deployment receipt PASS. Fresh pending-approval Home parity and actual Devin durable resume remain UNVERIFIED; the completed Stop removed the original pending fixture, so empty watchlist after restart cannot prove the fix's live positive case.
