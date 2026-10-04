# QA409 — hide browser-opening cmd helper

Date: 2026-10-05. Local source/test boundary, not fixed-QA deployment or OS window proof.

The installed CLI's `openBrowser` directly spawned `cmd.exe /c start` on Windows without `windowsHide`. Added `windowsHide: true` to that spawn only. Foreground server console behavior is intentionally unchanged. This script has not been established as the caller responsible for the reported four or five transient QA startup windows.

Regression executes the existing openBrowser function in a VM, with the process-spawn boundary intercepted to avoid actually opening a browser/server. It asserts the emitted Windows command, exact URL, one launch, detached/ignored stdio, unref, and windowsHide. Adjacent cases exercise KALIO_NO_OPEN and macOS/Linux commands. It does not test OS visibility.

RED: Windows regression failed because windowsHide was undefined; two adjacent tests passed. GREEN: all three tests passed after the one-line change. System Node used. `node --check scripts/kalio-cli.mjs` and `git diff --check` passed. Full repository suite not rerun for this slice; whole-goal readiness remains unverified.

| Acceptance | Status | Remaining |
| --- | --- | --- |
| Hide launcher cmd via spawn contract | PASS (unit boundary) | Real installed launcher/browser opening and visible-window capture. |
| Keep no-open and other platform commands | PASS (unit boundary) | No installed runtime launched. |
| Attribute and eliminate reported QA consoles | UNVERIFIED | Process/window startup capture still required; QA407 describes CIM limitation. |

No QA/Devin reset, provider mutation, target-project edit, installer replacement, or deployment performed.
