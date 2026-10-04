# QA339 — actual Home Site build through Devin/Kalio

2026-10-04. Fixed QA, approved session W4fggLSunrJB41C24MV7C, SWE-2. Warm readiness 17 checks passed. UI prompt requested only npm run build via Kalio, no source changes or native tools.

Observed manual HITL request: command npm, args [run, build], cwd E:/Projekty/home-site. Verified exact payload then clicked Confirm once.

Request Q4qWwdD-zYUKGamWcKzxO: audit confirms one terminal_spawn call/result, one terminal_output call/result, one requested+confirmed HITL, one process.cmd.invocation, real ACP turn completion and llm completion. No repeated spawn in this turn.

UI result QA339_BUILD_RESULT: terminal lSfKhn4fABI7J8vb7m_gE exited, exit code 0. Vite 5.4.21 transformed 26 modules; built in 413 ms. Artifacts index.html 0.62 kB, CSS 10.93 kB, JS 154.49 kB. This is agent-reported terminal output reconciled with Kalio's tool audit, not yet an independent terminal-status HTTP inspection. Screenshot devin-build.png.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Real Devin uses Kalio terminal | PASS | UI and audit |
| Manual approval remains enforced | PASS | Request before execution, exact payload checked, one confirmation |
| Home Site build | PASS at tool/UI boundary | Exit 0 and build output through terminal_output |
| Source changes | N/A | Not requested in this run |
| Home Site browser preview after QA reset | UNVERIFIED | Restore preview in next run |
| Console visibility for terminal build | UNVERIFIED | No window hook active during this build |

No overall completion or production readiness claim. QA remains running.
