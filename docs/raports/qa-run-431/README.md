# QA 431 — pre-armed startup measurement and real Devin recovery

Date: 2026-10-05 Europe/Warsaw. Checkout `codex/kalio-provider-runtime-ux`, HEAD at start `d9eabd1b`, pre-existing foreign dirty work preserved. No application source/build changed in this run.

Fixed QA UI `http://localhost:5288/`, API `http://127.0.0.1:3316/api`, data `%LOCALAPPDATA%/kalio-forever-qa`. Default direct-provider fallback remains mock; the tested conversation explicitly uses real Devin ACP `swe-2`, not mock. IAB desktop viewport; mobile/layout regression was not rerun.

## Restart and preservation

Before restart both scoped conversation current-run endpoints were empty. Durable database counts: completed 204, cancelled 2, failed 1, interrupted 23, interrupted_needs_retry 1; no active/nonterminal run. MCP service inventory showed DEV Kalio idle and no registered fixed QA service, so the repository-owned stack manager was used. No unrelated service was restarted.

SQLite online backup `.tmp/qa-provider-backup/qa-before-431.db`, 7,053,312 bytes. Sensitive local backup remains ignored and is not committed. Before/after ordered-row SHA-256 comparison was equal for credentials (1 row), app_settings (4), embedding_credentials (0), execution_profiles (21). No credential values printed, exported to plaintext JSON or sent to an agent.

Hidden launcher command: system Node `scripts/stack-manager.mjs start --backend-port 3316 --frontend-port 5288 --data-root C:/Users/Radomiej/AppData/Local/kalio-forever-qa --skip-build --force-restart --runtime direct`. Exit 0, empty stderr. Old API PID 22164; new API PID 33020, preview PID 27052. HTTP API health and UI both 200. Backend log `.tmp/qa-stack-logs/backend-1791155024731-26560.log`.

## Startup measurement

Window hook and Toolhelp process monitor reached readiness before starting the launcher, UTC 23:03:44.683. Both ran for 45 seconds and exited 0 with empty stderr. Process monitor: 1452 samples, maximum sample gap 47.453ms.

Launcher PID 26560 produced ten short PowerShell children for listener ownership checks: 32016, 868, 39004, 59968, 43284, 20512, 8916, 24980, 52404, 20752. It also produced two taskkill children during the authorized shutdown. Source inspection identifies repeated per-port `resolveListeningPid` calls in state-owner refresh, force restart, free-port validation and subsequent owner refresh. Windows implementation launches a hidden PowerShell `Get-NetTCPConnection` per query. This is demonstrated process churn, not demonstrated visible-window flicker.

New API PID 33020 produced four direct CMD children at 23:04:00.197–23:04:02.913 UTC:

| Probe chain | PIDs |
| --- | --- |
| Copilot | CMD 51532 → Node 8904 → Copilot 34800 → Copilot 11972 |
| Gemini | CMD 31808 → Node 35384 → Node 56384 / CMD 46748; Node 56384 → CMD 35620 |
| Claude | CMD 35776 → Claude 17748 |
| Codex | CMD 31848 → Node 38424 → Codex 13976 |

Window hook recorded 15 events whose class was unavailable. The improved event-thread fallback recovered PID for 8 of them. Three recovered PIDs (32016, 868, 59968) match launcher PowerShell children. Other recovered PIDs (46320 and 16848) do not match the recorded launcher/backend descendants; no ownership claim is made. Seven events remained PID 0. No event established a known console class or visible state. Therefore **the user's four/five visible startup windows remain UNVERIFIED and unresolved**. A window destroyed before delivery is not negative evidence, and recovered PID does not establish class/visibility.

## Real Devin cold recovery through UI

Read-only cold Devin preflight: 17/17 PASS, authenticated fresh catalog contains exact `swe-2`, zero hosts before the canary, strict six-tool persona, manual write/terminal confirmations. The shell command containing the preflight plus an optional log-text search returned exit 1 because the subsequent search found no matching console log; the preflight itself explicitly passed. No readiness exception or provider substitution was used.

Exact session `W4fggLSunrJB41C24MV7C`, profile `devin-local-441b1fa56f117064487b71b4eb1cf33e`, project `E:/Projekty/home-site`. Submitted from Talk: one Kalio terminal_spawn `npm run preview -- --host 127.0.0.1 --port 57868 --strictPort`, then terminal_output, no source edits/install/deploy/commit/native tools requested.

Inspected actual HITL payload and clicked Confirm once. Final `QA431_RESULT` reported terminal `eZhsD1bKyRnedrALH8FLv`, status running, URL `http://127.0.0.1:57868/`. Independent HTTP HEAD returned 200, and existing Home Site tab reloaded into the real NEXORA page.

Durable run: turn `CaELD7s-uHdWwEmJJudTR`, provider `devin-cli-acp`, model `swe-2`, status completed, started 1791155135549, completed 1791155163595. Current-run endpoint empty afterward. After F5 final response retained the same terminal ID, Stop count 0, Confirm count 0. Execution Graph shows completed turn and one collapsed two-call group; inspector labels terminal_spawn and terminal_output as Kalio/completed. This is proof for this recovery flow, not all Devin/Goal/Jev scenarios or vendor free pricing.

Screenshots:

- [Reviewed command approval](assets/01-preview-approval.png)
- [Devin final result](assets/02-devin-result.png)
- [Restored Home Site](assets/03-home-site.png)
- [Grouped tools on graph](assets/04-graph.png)

## Closure matrix

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| BOOT-01: monitor before real QA startup | PASS | readiness barrier, launcher exit 0, 45-second measurements | no visible-console sensitivity guarantee |
| BOOT-02: preserve provider settings | PASS | online backup and four table digest comparisons | backup not a tested restoration/export UX |
| BOOT-03: attribute/eliminate visible flashes | UNVERIFIED | launcher PowerShell and API CMD process chains; unavailable window events | visible attribution; reduce redundant launcher queries without stale owner cache |
| DEVIN-01: recover real scoped conversation after restart | PASS for preview canary | preflight, UI approval, durable ACP/swe-2 completed run | broader lifecycle/architecture requirements remain |
| CHAT-GRAPH-01: completed response and tools after F5 | PASS for this turn | same terminal ID, no active approval/Stop, two completed grouped Kalio calls | Architect/child workflow parity not covered |
| SITE-01: working generated website preview | PASS for availability | HTTP 200 and rendered NEXORA page | full responsive/a11y regression and live production deployment not covered |

[P2] Required before prod or explicit acceptance: visible-console attribution and elimination. The next safe implementation candidate is batching launcher listener queries within each stage, retaining fresh ownership checks before any termination; do not add a stale global PID cache. QA and Home Site preview are left running. Goal/Jev integration and full objective remain incomplete.
