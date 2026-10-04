# QA394 — file-result integrity at Kalio MCP boundary

2026-10-04. Local API transport fixture, random HTTP port, no live LLM or Home Site access. Added a regression preserving all 461 lines, Unicode text and final-line marker through real MCP Client/StreamableHTTP transport against KalioMcpBridgeService. Dispatcher is a fixture returning known content; this proves serialization/transport integrity, not filesystem reading or Devin ingestion.

Source service toMcpResult serializes success data with JSON.stringify, no slicing. Stdio proxy registerKalioBridgeProxy forwards the remote result unchanged. No production code changed; existing behavior passed immediately, so this is a boundary acceptance test rather than fail-first bugfix.

Service 22 tests plus proxy 3 tests: 25/25 PASS, 68.25 seconds total. Existing approval-beyond-default-deadline test accounts for 65 seconds; it was not hung and was not restarted. API typecheck exit 0, diff check clean.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Whole-file MCP data and tail preservation | PASS fixture boundary | Exact 461-line content round-trip with Unicode | Not provider-side display/context proof |
| Approval/proxy regressions | PASS | 25 tests including delayed human approval | Existing live acceptance remains separate |
| Explain second QA387 read | UNVERIFIED vendor boundary | No truncation at inspected Kalio adapters | Cannot infer Devin reasoning from this test |

No QA restart, provider change or target-project edit. Overall goal remains active.
