# QA340 — real Devin restores Home Site preview

2026-10-04. Fixed QA, SWE-2, approved Home Site session. Warm readiness 17 checks passed.

UI requested only Kalio terminal_spawn npm args [run, preview, --, --host, 127.0.0.1, --port, 57868, --strictPort], cwd E:/Projekty/home-site. Exact payload observed before one manual Confirm. No source writes or native tool enablement.

Request 7HB7ub7mmKiZTtRosyG9y: one terminal_spawn and terminal_output call/result each, one HITL requested/confirmed, one process.cmd.invocation, ACP+LLM completed. Final QA340_PREVIEW_RESULT reports terminal 61t76mEtY1eeVRA7oP9Ft running.

Independent HTTP GET http://127.0.0.1:57868/ returned 200. Existing browser tab reloaded and rendered NEXORA company page with navigation, hero, services, portfolio/demo disclaimer. Screenshot home-preview.png. No claim of real company facts or backend email delivery.

45-second event hook ready before prompt, finished exit 0 with zero console/Terminal records. This measured preview launch did not reproduce flashes; not proof for all launch paths.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Restore actual project preview through Devin/Kalio | PASS | One approved terminal launch |
| Final turn ends while preview stays running | PASS | Completed audit + running terminal reported |
| Page reachable and rendered | PASS | HTTP 200 + browser page |
| No captured console flash in measured launch | PASS for this attempt | Zero events during capture |
| Full responsive/accessibility/form regression | UNVERIFIED this run | Separate page audit needed |

QA UI remains http://localhost:5288/. Overall goal remains active; this is real project preview proof, not complete Kalio/Jev/Codex release acceptance.
