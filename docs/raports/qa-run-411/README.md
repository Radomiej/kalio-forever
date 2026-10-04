# QA411 — catalog recovery and real Devin CSS read

Date: 2026-10-05. Fixed QA UI localhost:5288; API 3316. Real swe-2, approved Home Site session W4fggLSunrJB41C24MV7C.

After QA410's failed catalog refresh, direct hidden `devin.exe models list` with the same 10-second bound completed successfully in 4141ms; stdout 175086 bytes, stderr 0, swe-2 present. Only metadata printed. Subsequent exact warm-session static preflight passed 17/17. No reset, credential mutation or timeout relaxation.

The failure is transient; resource contention/timeout during the parallel full test gate is a hypothesis, not an attributed cause. Existing catalog catch logs omit signal/string error code, so QA410's original failure cannot be classified from that log alone.

UI prompt requested one Kalio fs_read of src/styles.css lines 1–120, no native tools, terminal, web or writes. Result QA411_RESULT reports global focus-visible outline 3px solid accent-light (#8aa4ff), offset 2px, radius 4px, and skip-link:focus. One Kalio tool bubble visible, Stop count 0.

Authoritative scoped audit:

- turn Hpmteoe817mnVJiZr67Zv, prompt shBPAa3KyeLNBPiVqGy3P, run iP0riXRKS9ROVADVS9npa.
- ACP model swe-2; all native categories false; six bridge tools.
- call mcp-c4e32532-d7cf-4a34-927b-ac47530345f4-2, fs_read exact requested path/range at 1791151631931; success at 1791151631952.
- ACP completed end_turn at 1791151633967; llm.turn.completed at 1791151633968, toolCallCount 1, thinkingLength 0.
- screenshot assets/devin-result.png.

| Acceptance | Status | Remaining |
| --- | --- | --- |
| Fresh model admission | PASS | Recurrent catalog failure cause/diagnostics remain open. |
| UI → real Devin → Kalio read → final | PASS | Does not prove writes/builds in this particular run. |
| Idle final UI | PASS | F5/graph parity not repeated in this run. |
| No startup-console spam | UNVERIFIED | No OS observer used; no host reset/start requested. |

Home Site was not modified. Whole goal remains open.
