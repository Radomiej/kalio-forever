# QA319 — instrument Devin startup probes

Date: 2026-10-04. Source changes only; no QA deployment or restart.

Added bounded backend log records under DevinMcpStartup for version, discover and verify probes. Start records include parent PID, direct child PID when Node exposes it, and windowsHide=true. Terminal records include success/failure and duration. No executable path, arguments, catalog entries, output, environment or credentials are logged. Existing private-MCP isolation, timeouts and fail-closed behavior remain intact.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| Stage records and secret exclusion | PASS (mock) | New regression failed before implementation, passed afterward. |
| Direct child PID recorded | PASS (mock) | Fixture PID=12345 asserted for all three start records. |
| Existing suppression and queue regressions | PASS | 11 tests across two files; subsequent PID-focused suppression run 9/9. |
| API typecheck | PASS | System Node TypeScript --noEmit, exit 0. |
| Explain visible QA startup windows | UNVERIFIED | Instrumentation not yet built/deployed; real OS child/window correlation required. |

No claim that direct PID identifies descendants or window visibility. Tests used mocked execFile; no real Devin commands, no provider settings changes and no Home Site mutations occurred.
