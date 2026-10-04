# QA294 — hide generic CLI version probes

2026-10-04. Local source/test boundary; fixed QA not restarted or deployed.

Found an unhidden launch in CLIAgentProbeService: execFile used only timeout=5000. The cached initial list probes four adapters. Added windowsHide=true without changing cache, queue, arguments, timeout or approvals.

Regression asserted hiding on every adapter launch while preserving four initial calls and no new calls for repeated reads. System Node outside sandbox: RED one failure/one pass (missing windowsHide), GREEN two passes, exit0, 1.25 seconds.

Inspection also found generic CLI task spawn in cli-agent.service.ts lacks windowsHide; this separate path is not fixed in this slice. Native Devin/Codex launches and installed MCP SDK 1.29.0 stdio transport already hide direct launches. No OS trace attributes the user's transient windows conclusively.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Hide version probes | PASS | RED then GREEN regression | Live startup proof |
| Preserve caching/serialization | PASS | Both existing tests pass | Full regression gate |
| Typecheck | FAIL | tsc --noEmit exited1 with errors across API files | Rerun outside sandbox and establish baseline before deployment |
| Fixed QA deployment | UNVERIFIED | No restart/deployment | Build and gated deploy |
| All console flashes eliminated | UNVERIFIED | Windows event capture unavailable in QA293 | Trace startup and generic task path |

Verdict: local probe fix verified, overall CMD issue still open. Do not describe the user observation as resolved.
