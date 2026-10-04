# QA385 — transient console-window diagnostic refinement

2026-10-04. User still observes four or five brief windows during startup. No QA restart, provider reset, live LLM request or target-project mutation in this slice.

## Evidence

- Installed MCP SDK stdio transport sets `windowsHide: process.platform === 'win32'`. Kalio's MCP factory delegates to that transport; absence of the option in the factory is not evidence of a missing hide flag.
- Devin MCP startup executes version, discover and verify stages as separate CLI processes, each with `windowsHide: true`. Their count is consistent with the report but does not establish window ownership or causality.
- Enhanced the existing event-hook diagnostic with HWND, sampled visibility and Windows event tick timestamp. Existing PID, class and event code remain. No titles, command arguments or credentials are captured.
- Fail-first static regression: 2 PASS / 1 FAIL before change, 3/3 PASS after change.
- Real two-second hook self-test outside sandbox: READY, one Static CREATE event at 2026-10-04T20:55:17.2864915+00:00, visible=False, followed by FINISHED records=1. No visible diagnostic window was requested.

## Acceptance

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| WIN-01 richer bounded event capture | PASS | 3 static tests plus real hidden-control callback | Visibility is sampled at delivery, not original event time |
| WIN-02 identify reported brief console owner | UNVERIFIED | No startup reproduction in this slice | Validate actual console event delivery and correlate a reproduced HWND/PID with startup stage |
| WIN-03 eliminate user-visible startup windows | UNVERIFIED | No runtime workaround applied | Establish cause before claiming a fix |

[P2] Reported startup windows remain unresolved. Class lookup may fail after destruction; the hidden Static self-test does not prove detection of a short-lived real console. This is diagnostic improvement, not no-spam or production-readiness proof. Overall Home Site / Devin goal remains active.
