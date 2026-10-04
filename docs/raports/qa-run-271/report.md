# QA271 — real saved Devin build: grouped graph and chat

2026-10-04, Europe/Warsaw. **1 passed (3.6s), exit 0**. Chromium desktop 1440x1000, fixed QA UI localhost:5288, API 127.0.0.1:3316/api. Existing real SWE-2 build turn `HccFyxg08nDpfWthfFpDe` from QA245, terminal `Ep5S5x4mbpXoZeMsOQan8`, exact Home Site path. No new agent prompt, command, approval, project change or deployment.

System Node outside sandbox, external-server Playwright `qa-graph-group-details-readonly.spec.ts --grep "exact saved Devin"`, one worker. All four explicit identifiers/report environment variables provided; old report paths not overwritten. Saved heading independently checked through existing message history before launch.

| Area | Status | Evidence | Remaining |
|---|---|---|---|
| Chat provenance | PASS | Exact build result bubble, two tool-origin badges, terminal_spawn and terminal_output | No new live run |
| Compact group | PASS | Exactly one tool-group node for exact turn | Does not assert every other historical turn |
| Drill-down | PASS | Spawn arguments exact project; result exact terminal; output exitCode 0 and 26 modules | Build success belongs to QA245, not a newly executed build |
| F5 parity | PASS | Same group and inspector details after reload | Live streaming update not exercised |
| Visual evidence | PASS | assets/devin-group-after-f5.jpg captured and inspected | Desktop only |
| Overall goal | NOT CLOSED | Remaining full regression/runtime requirements | No completion claim |

QA270 separately proves the one-tool node. Together these runs cover saved single-tool versus multi-tool presentation without changing product grouping. No production application changes were required.
