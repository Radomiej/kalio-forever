# QA199 — real ChatGPT project read after deployment

2026-10-04, fixed QA backend e53b3377/frontend QA188. Refreshed chatgpt-default model catalog explicitly; exact Codex static resume readiness passed for profile codex-local-1bd82ba45243e8a3a0c4aa0478538f67, model gpt-6-luna, session yvD83rgDA_ZHvUwJKlo_S and E:/Projekty/home-site.

Actual UI prompt marker QA199_CODEX_READ_1791109651185, turn ftYDGEc-5uRfNtz6DfuDE. Playwright qa-codex-project-read-live.spec.ts explicit opt-in, 1 passed in11.4s. Handle18157 observed running then terminal exit0, no restart on yield.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real new ChatGPT/Codex response | PASS | Actual package read reports nexora-home-site and vite build | Not all provider operations |
| Kalio tool provenance and bounded execution | PASS | Exactly one fs_read in durable history/audit; zero process.cmd.invocation | Not OS-wide/native denial proof |
| F5 history and idle state | PASS | Kalio origin retained, Stop absent, screenshot visually inspected | Other consumers not rerun |

Screenshot assets/codex-project-read-after-f5.png. No source writes, terminal commands, new files, provider changes or native tools requested. During this run HomeSite preview57868 refused connection after QA restart; recorded and recovered separately in QA200, not hidden by this green test. Goal remains active.
