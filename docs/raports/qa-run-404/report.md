# QA404 — distinguish CLI readiness from a running Devin host

2026-10-04. Worktree 5a7e baseline ebd8ed1c plus preserved unrelated changes. Fixed QA http://localhost:5288/, API 127.0.0.1:3316; IAB tab 6 ordinary viewport. No API/Devin reset, provider settings change or target project mutation.

## Change

The card's former Online label derived only from probeChecked/authenticated/acp, not hosts. Changed it to CLI ready and added an explanation that model hosts start on the first message and CLI readiness does not mean an agent is running. Existing host count/details remain unchanged. No runtime, contract or permission logic changes.

## Verification

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Zero hosts do not imply running agent | PASS component fixture | New rendered test with authenticated ACP and zero hosts expects CLI ready, no Online, zero count and explanation | Zero-host live reset not repeated |
| Parent integration panel parity | PASS | Updated assertion distinguishes Devin CLI ready from Codex Online | Other providers retain existing semantics |
| Settings regressions | PASS | 32 files / 213 tests | Initial parent test failed at old two-Online assertion; adapted to intended new contract |
| Full frontend unit suite | PASS | 215 files / 1889 tests, 37.78 s, exit 0 | Not E2E or full backend suite |
| Typecheck/build | PASS | tsc --noEmit exit 0; Vite build 3120 modules, 6.09 s | Existing >500KB chunk warning remains |
| Fixed QA rendered change | PASS | Settings → Agent runtimes displays CLI ready, one host, explanation; captured console error/warn logs empty | Mobile viewport not retested for this text-only change |

RED: new card test failed because CLI ready was absent; one prior Escape test passed. GREEN after minimal text change and parent-contract update. Browser page is Kalio on localhost:5288, meaningful settings content, no framework overlay observed. Screenshot [Devin CLI ready](assets/devin-cli-ready.png).

Frontend built from current dirty worktree; bundle index-BCpLkAdN.js (2116.02KB), not a claim that unrelated changes are owned or newly accepted. Existing preview serves updated dist; generated runtime-config.js restored to API/WS 127.0.0.1:3316 from stack state (API PID 10288, web PID 59376). No generated dist is staged. This is a frontend-only fixed-QA update, not an API deploy or production release.

Communication proof remains QA403. Short console-window attribution and Jev remain open. No new LLM call, pricing verification, external knowledge sync or whole-goal completion claim.
