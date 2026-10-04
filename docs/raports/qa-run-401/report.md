# QA401 — do not silently discard vanished-window events

2026-10-04. Checkout worktree 5a7e, baseline HEAD ebd86582 plus unrelated dirty changes preserved. Diagnostic-only change; QA, providers, Home Site and CLI hosts not restarted or modified. No live LLM call or browser action.

## Reproduced measurement defect

`watch-console-windows.ps1` filtered by GetClassName text without checking lookup failure. An event delivered after its window had already been destroyed was silently discarded. Thus a zero classified-console result could coexist with unexamined window events.

The callback now records failed class lookups as `class=unavailable`, retaining hwnd, event number, original eventTickMs and delivery UTC; summary explicitly reports `unclassified`. Unknown events are not classified as consoles or given invented PID/visibility. The self-test requires a recognized Static event, not merely any recorded event.

## Verification

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Do not discard destroyed-window events | PASS controlled Windows fixture | New behavioral test runs actual script: persistent hidden Static and immediately destroyed hidden Static | Does not identify actual transient consoles |
| Regression catches missing diagnostic disclosure | PASS | RED: 3 passed / 1 failed, missing summary; GREEN: 4/4 passed | Three pre-existing tests are static checks; the new test executes the artifact |
| No visible test windows | PASS for fixture design and held-control observation | Both controls omit WS_VISIBLE; held event visible=False | Not a real-console sensitivity test |
| Preserve safe diagnostic scope | PASS scoped diff review | No titles, arguments, credentials or process mutations added; hook cleanup retained | Global unknown events can include unrelated applications |

Direct one-second self-test at 2026-10-04T21:36:08.3333777Z: held Static CREATE, transient unavailable CREATE and DESTROY for the same hwnd, then `WINDOW_EVENT_HOOK_FINISHED records=3 unclassified=2` at 21:36:09.3457779Z. This demonstrates two events for one hidden destroyed window, not two visible consoles.

Command: system Node `--test scripts/watch-console-windows.test.mjs` outside sandbox, exit 0; direct `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/watch-console-windows.ps1 -Seconds 1 -SelfTest`, exit 0. Scoped git diff --check passed. No full application gate rerun: application code is unchanged; QA400's previous results remain separately timestamped evidence.

## Remaining

[P2] WIN-01/02 remain open. A positive unclassified count is missing classification evidence, not a console count. Even zero unknown events does not prove coverage of every console host/class or events outside the ready/finished interval. Need startup-phase clarification and real console/process attribution. Do not label this change as fixing console spam.

No screenshot: these are hidden diagnostic fixtures, not a UI flow. No deploy or external knowledge-service update. Overall user goal remains active.
