# QA155 — Devin reset loses visible partial history

2026-10-04, fixed QA :5288/:3316, exact SWE-2, session W4fggLSunrJB41C24MV7C.

FAIL: reset during a visible no-tool response terminated the run, but F5 showed only the user prompt. Turn 2KjSTYt3_JEoRRsbNVD9D was durably interrupted; no assistant message was saved. The journal also incorrectly named Codex in its interruption reason.

Evidence: assets/before-host-reset.png and assets/host-reset-after-f5.png. Empty PATCH to existing Devin settings reset the host without changing public policy values. No recovery prompt was submitted after the failed assertion.

Root cause: an external stream exception skipped partial-history persistence. Local regression reproduced the loss; the exception path now persists non-empty settled output while preserving the original failure. Seven focused failure-history cases pass, including poisoned write lane, persistence failure, and empty output. Live verification after deployment is recorded separately in QA158. Provider-specific interruption wording remains a follow-up.
