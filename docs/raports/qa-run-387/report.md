# QA387 — synchronized version observation and real Devin source audit

2026-10-04, fixed QA localhost:5288 / API 127.0.0.1:3316. Existing Home Site session W4fggLSunrJB41C24MV7C, exact SWE-2. Static readiness 17/17 PASS before UI prompt; six Kalio tools, manual approval, native filesystem/terminal disabled, one existing online host, no unresolved run.

## Windows observation

Hook READY 20:57:48.0516876 UTC, FINISHED 20:58:18.0671099 UTC, records=0. Hidden version probe started 20:58:01.316 and ended 20:58:01.344, fully inside observation interval; returned devin 3000.11.1 (cc4e349ca55e). This covers the individual version probe only, not host/MCP startup, reboot or vendor descendants. Console detector's short-lived real-console sensitivity remains unproven.

## Real UI audit

Submitted prompt through Kalio UI asking for exactly one fs_read of E:/Projekty/home-site/src/App.jsx, no writes/terminal/native tools. Final QA387_APP_AUDIT_RESULT reports source evidence for mobile Escape/focus return, form validation and explicit demo/no-send messaging. These are source-audit findings, not new interactive accessibility proof.

Durable final assistant nEC0g1JW2b9T2HxEVWBFl, turn RtufKZSKCiiXZ5i4bimoG, thinking length 177. Current-run endpoint returned empty after completion. Screenshot devin-audit.png records final UI.

[P2] Exact-one-read instruction was not followed: UI shows two fs_read entries; scoped audit records two tool_call/tool_result pairs at 1791147539109/1791147539123 and 1791147540616/1791147540618, both success. Do not classify as transport duplicate or model retry until the requested argument ranges and request correlation are inspected. No evidence of a write or spawn in this test.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real Devin communication | PASS for source-audit turn | UI final plus durable message and empty current run | Not universal stability proof |
| Exactly one read | FAIL | Two scoped call/result pairs and UI entries | Trace argument ranges/correlation before changing runtime |
| Source audit | PASS, source boundary only | Final report from actual fs_read | Browser behavior remains separate proof |
| No startup windows | UNVERIFIED overall | Version-probe interval had zero events | Full startup and detector sensitivity unresolved |

No reset, provider changes or target-project edits. Overall goal remains active.

Follow-up QA388 identifies separate call IDs and different arguments (whole-file request followed by lines 250–461), each with one success result. This is an extra provider-requested read in this sample, not evidence of duplicate bridge dispatch. The reason for the extra range remains unverified.
