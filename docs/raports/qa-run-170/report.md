# QA170 — real SWE-2 Kalio file read and durable provenance

2026-10-04. Fixed QA UI http://localhost:5288/, API http://127.0.0.1:3316/api, AppData kalio-forever-qa data. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-test HEAD f46f82ec with unrelated and remaining runtime/UI work preserved. Existing QA167 deployment was not restarted for this test. Chromium 1280x720.

Exact Devin swe-2 session W4fggLSunrJB41C24MV7C, strict local ACP profile, approved project E:/Projekty/home-site. Warm-session static preflight passed immediately before the UI action, including native tool denial, six Kalio tools, manual write/command approval and no unresolved runs/children.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real file content through Kalio | PASS | One fs_read of E:/Projekty/home-site/package.json; one durable tool result contains react and vite; answer names nexora-home-site and vite build | This is read-only, not a new write/build proof |
| Single execution and CMD boundary | PASS | One scoped tool_call fs_read, zero process.cmd.invocation | No OS-wide process/window measurement |
| Durable provenance after F5 | PASS | Tool-execution-origin says Kalio before and after F5, answer remains, Stop absent | Native provenance and other surfaces separately scoped |
| Screenshot | PASS | assets/kalio-read-after-f5.png inspected | Empty native audit affordance remains as noted in QA169 |

Playwright devin-kalio-read-live.spec.ts: 1 passed (6.6s), test 5.8s; turn rmCRhn-ulAMoVslQlFQqx. Unique marker/report-run parameter prevents overwriting QA105 or matching historical answers. No terminal, writes, web, build or project changes requested. Native policy remained part of preflight; zero Kalio CMD alone does not independently prove absence of all provider-native activity.

Source bundle f46f82ec contains durable dispatch, correct user-turn correlation, approval progress forwarding, cancellation, committed result resume context and audit correlation. Focused adapter/MCP regressions: 40 passed across 4 files (69.28s); API typecheck passed. It was already part of the existing built deployment, but committing source is not a fresh deployment receipt. Full objective remains active.
