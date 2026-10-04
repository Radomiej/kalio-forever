# QA267 — real SWE-2 queued follow-up and F5

2026-10-04, Europe/Warsaw. PASS for this bounded live Devin workflow: **1 passed (11.8s), exit 0**. Fixed QA UI `http://localhost:5288`, API `http://127.0.0.1:3316/api`; existing approved Home Site session `W4fggLSunrJB41C24MV7C`. No project mutation or tool approval.

The static readiness gate passed all 17 checks before generation. System Node outside sandbox; Chromium, one worker, `qa-devin-queue-live.spec.ts`, explicit opt-in and report number 267. Two real prompts were sent through the composer: a 40-item answer followed by a queued one-sentence answer. Both explicitly prohibited tools and project changes.

| Area | Status | Evidence | Remaining |
|---|---|---|---|
| Queue and reconnect | PASS | Queue visible before F5; both unique response headings exactly once afterwards; queue and Stop disappear | Stop/drain during cancellation is separate |
| Durable runtime identity | PASS | Two completed journal turns, both `devin-cli-acp` / exact `swe-2` | Does not prove first-prompt auto-connect |
| Sequential execution | PASS | First completion precedes second start; exactly two starts and completions | Not a concurrency stress test |
| Host reuse | PASS | One Devin host; process epoch unchanged | No cold-start assertion |
| App audit | PASS | Zero tool-call and zero `process.cmd.invocation` events within scoped test window | Not an OS-wide process census |
| Visual evidence | PASS | Both saved screenshots inspected; queued state becomes ordinary final response after F5 | Desktop 1280x720 only |
| Overall release | NOT CLOSED | QA257 broad gate failed; 19 original cases remain unresolved | Full browser gate not rerun |

Screens: `assets/queued-followup.png` and `assets/queue-drained-after-f5.png`. The latter shows the completed second response, no Stop, no pending/queued bubble. No backend/frontend redeploy or QA reset was needed for this test-only harness correction. QA provider settings were not modified. Jev goal-loop proposal remains unimplemented; this test is not evidence for its judge or AutoApprove.
