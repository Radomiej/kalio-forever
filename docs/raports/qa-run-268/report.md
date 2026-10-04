# QA268 — real Devin Stop, tool recovery and F5

2026-10-04, Europe/Warsaw. PASS for the bounded live workflow: **1 passed (8.2s), exit 0**. Checkout `codex/kalio-provider-runtime-ux`, HEAD at launch `dccddb8d`; pre-existing mixed dirty work preserved. Chromium desktop 1280x720, fixed QA UI `http://localhost:5288/`, API `http://127.0.0.1:3316/api`, app-local QA database. Explicit approved session `W4fggLSunrJB41C24MV7C`, provider Devin ACP, exact `swe-2`, project `E:/Projekty/home-site`.

All 17 static readiness checks passed immediately before generation. System Node outside sandbox; external-server Playwright `tests/devin-stream-stop-live.spec.ts`, one worker, opt-in `KALIO_DEVIN_STREAM_QA91=1`, report run 268. Historical QA91 prompt markers belong to this existing harness; screenshots and result heading use the new report directory, not a replacement of QA91.

| AC / PIT | Status | Evidence | Remaining |
|---|---|---|---|
| AC-stop / PIT-03,37 | PASS | Stop clicked only after actual content; cancelled turn `P1GLxkEee5d5zsaBwytNs`; durable partial content and Interrupted label | Not cancellation during a destructive tool |
| AC-recovery / PIT-05,36 | PASS | Fresh turn `3QuNk3QyDDWLd1YcjC5G9` completed; scoped audit has exactly one `tool_call: fs_read` and successful result | No writes/build in this attempt |
| AC-provenance / PIT-07,08 | PASS | UI displays fs_read, Kalio origin and exact package.json path; answer names nexora-home-site; ACP mcp_approval accepts fs_read | Not a claim that an ACP acceptance equals user approval for writes |
| AC-hydration / PIT-11 | PASS | F5 retains partial cancelled answer, final read result and tool row; no Stop, pending or queued state | Desktop only; graph parity not checked here |
| AC-process | PASS within app audit | 25 scoped audit rows since 1791121938544, zero process.cmd.invocation | No OS-wide process census |
| AC-availability / PIT-04 | PASS | QA UI, API health and Home Site preview `http://127.0.0.1:57868/` each HTTP 200 | Health is not full page-quality acceptance |
| Overall release / PIT-01 | NOT CLOSED | QA257 full browser gate not rerun; 19 original failed cases unresolved | Required before production |

Screenshots `assets/visible-generation-before-stop.png`, `assets/generation-stopped.png`, `assets/fresh-read-after-f5.png`. The stopped and refreshed captures were visually inspected. First sandbox HTTP requests were denied by sandbox socket policy; successful outside-sandbox reads establish server availability, so that diagnostic failure is not classified as an app outage.

No app-source change, server reset, redeploy, provider-setting mutation or target-project write. Existing QA and preview left running. This strengthens real Devin lifecycle/tool evidence, but does not implement Jev's goal judge, automatic continuation, integration opt-in persistence, or close all outstanding UX requirements.
