# QA269 — read-only graph audit: incorrect single-tool expectation

2026-10-04, Europe/Warsaw. FAIL / graph parity not yet proven. Chromium 1440x1000 on fixed QA localhost:5288 / API 127.0.0.1:3316/api. No new prompt, tool execution, approval, reset or provider mutation.

Chat checks passed for real Devin turn `3QuNk3QyDDWLd1YcjC5G9`: exact QA268 result, nexora-home-site, one execution-origin badge and fs_read. Graph assertion failed because the test expected `tool-group:<turn>` for one tool. Source `executionGraphModel.ts:651` groups only when collapseTools is enabled and graphToolItems.length > 1. Accessibility snapshot contains an individual fs_read execution step and package.json artifact, so missing group is not evidence of a missing tool.

Playwright reports 1 failed. The PowerShell wrapper returned exit 0 despite the child failure; test verdict comes from the runner output, not wrapper exit. Future wrapper must preserve child exit code explicitly.

Failure screenshot visually inspected; screenshot, error context and local ignored trace copied with absolute paths and byte lengths verified before another run. No repeat attempted. Next: assert individual-tool inspector under the actual single-tool contract, then verify a multi-tool build group separately. Do not change product grouping merely to satisfy this incorrect assertion.

| Area | Status | Evidence | Remaining |
|---|---|---|---|
| Saved chat | PASS | Exact result and Kalio tool-origin row | No new live run |
| Single-tool graph | UNVERIFIED | Individual fs_read exists in accessibility snapshot | Inspector/result and F5 not reached |
| Grouped graph | N/A for one call | Source explicitly groups >1 calls | Multi-tool turn still requires separate test |
| Overall goal | NOT CLOSED | No completion claim | Remaining QA/runtime requirements |
