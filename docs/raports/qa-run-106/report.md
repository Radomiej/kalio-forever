# QA106 — Restore HomeSite preview through real Devin and HITL

2026-10-04. Preview stopped during QA104's authorized stack restart. Exact session idle, Devin reset succeeded and fresh static readiness16/16 PASS before UI action. No QA database reset.

Original corrected restore workflow now replayed cold: PASS9.8seconds (test9.0). UI submitted exact SWE-2 request; reviewed Full tool arguments for npm/preview/127.0.0.1/57868/strictPort/E:/Projekty/home-site, then Confirm. Shared helper waited exact durable turn completion, required exactly one spawn command and matched its terminal_output. Turn xfule7tJ-Aahr2GynQqXy; terminal veSuLhBGXpcNyqaaYUmwn. One command npm run preview -- --host 127.0.0.1 --port 57868 --strictPort, followed by running/null-exit output. HTTP preview200. No filesystem writes or build/commit request.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| No duplicate preview spawn | PASS | Preflight endpoint unavailable, exact one spawn result |
| Manual Kalio command HITL retained | PASS | Reviewed args then individual Confirm |
| Exact-turn final/result inspected | PASS | Shared helper and scoped durable results |
| Fixed QA and HomeSite available | PASS | UI5288/API3316health/preview57868 allHTTP200 |
| Complete integration | OPEN | Native reason/category/ChatGPT gaps remain |

Screenshots: [approval](assets/preview-approval.png), [completed preview](assets/preview-completed.png). Automated assertions verified results; no separate layout audit in this attempt.
