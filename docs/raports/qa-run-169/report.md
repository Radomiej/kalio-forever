# QA169 — real ChatGPT/Codex on the current fixed QA deployment

2026-10-04. Checkout: C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux; pre-test HEAD 89c94433 with existing mixed dirty runtime/UI work preserved. The running built deployment was started for QA167; HEAD alone is not its artifact identity. Frontend bundle index-290-Dh3j.js, API :3316, UI http://localhost:5288/, isolated AppData kalio-forever-qa data. Stack fallback mock/mock is not the provider of this explicitly bound Codex session.

Session yvD83rgDA_ZHvUwJKlo_S; profile codex-local-1bd82ba45243e8a3a0c4aa0478538f67, auth chatgpt-default, model gpt-6-luna; approved project E:/Projekty/home-site. Chromium desktop 1280x720. No project writes, tools or resets requested. Catalog refreshed via the integration endpoint, then exact Codex static readiness passed before UI submission.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real communication and warm follow-up | PASS | Two unique QA169 headings rendered through composer-driven real Codex responses; same host process epoch | Other models/providers not tested |
| Terminal run and F5 hydration | PASS | No Stop button, empty scoped current-run endpoint, both answers remain after reload, no reconnect indicator | Other surfaces not covered |
| No tools or CMD for this action | PASS | Scoped audit: zero tool_call, zero process.cmd.invocation, exactly two llm.turn.completed | Not an OS-wide console/process proof |
| Screenshot | PASS | assets/codex-recovery-after-f5.png inspected | Native tool audit heading still appears without tool calls |

Playwright qa-codex-restart-recovery-live.spec.ts: 1 passed (12.3s), test 11.5s. Report number is now configurable with KALIO_CODEX_RESTART_REPORT_RUN and numeric validation, avoiding overwrite of QA160 evidence. This test observes recovery on the deployment previously restarted in QA167; it does not itself restart the backend.

[P3] Empty native-tool audit heading is displayed above no-tool responses. It adds confusing UI noise. Preserve genuine provenance but hide an empty audit section; regression and deployed browser verification remain required.

Devin reset/recovery proof remains separately recorded in QA168; HomeSite recovery in QA167. This report closes current-deployment Codex no-tool reply/follow-up/F5 only, not the full goal, all tool provenance, settings usability or production readiness.
