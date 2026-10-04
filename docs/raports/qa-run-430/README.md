# QA 430 — transient-window attribution diagnostic

Date: 2026-10-05 Europe/Warsaw. Measurement: 2026-10-04 22:58:20–22:58:35 UTC.
Target: existing fixed QA, API `http://127.0.0.1:3316/api`, backend PID 22164.

## User correction

Four or five console windows can still briefly appear at startup. This remains an open defect; a sample with no captured windows does not override the user's observation.

## Change and regression

`scripts/watch-console-windows.ps1` now attempts to resolve the process from the WinEvent event-thread ID when the window has already disappeared or its class is inaccessible. The thread handle is always closed. Unavailable class and visibility remain unknown; a recovered PID does not classify the window as a console.

Regression uses real Win32 events from hidden Static controls, not source-text assertions. Destroy-before-message-delivery reproduces the missing PID. The test failed before the change (`vanished control must retain process attribution`) and passed afterward. The existing 400ms Toolhelp process-snapshot regression also passed.

Command: system Node `--test scripts/watch-console-windows.test.mjs scripts/measure-process-snapshots.test.mjs`: final repeat 6 PASS, 0 FAIL, 0 skipped, approximately 4.0 seconds. Three preserved tests inspect source invariants; three exercise actual Windows behavior. This does not prove sensitivity to visible consoles on the user's desktop. Full application gate was not rerun for this diagnostic-only change; no application source or built QA artifact changed.

## One controlled Recheck

Both hidden diagnostic processes reached readiness before POST `/api/cli-agents/refresh`. Response HTTP 201:

| Agent | Available | Reported version |
| --- | --- | --- |
| Copilot | true | 1.0.23 |
| Gemini | true | 0.52.0 |
| Claude | true | 2.1.220 |
| Codex | true | 0.155.1 |

Both monitors exited 0, with empty stderr. No QA restart, provider configuration mutation, live LLM request or target-project edit occurred.

Process monitor: 486 samples, maximum observed gap 46.163ms. Four direct `cmd.exe` children of backend PID 22164 appeared over 2.57 seconds:

| Chain | First observed UTC |
| --- | --- |
| 22164 → cmd 53208 → node 37532 → copilot 59876 → copilot 10388 | 22:58:20.740 |
| 22164 → cmd 21032 → node 25716 → node 53148 / cmd 9824; node 53148 → cmd 46132 | 22:58:21.688 |
| 22164 → cmd 52140 → claude 49164 | 22:58:23.047 |
| 22164 → cmd 29800 → node 39608 → codex 40492 | 22:58:23.307 |

Console hosts were observed under each direct CMD chain, including an additional host under nested CMD 46132. Process order and probe order agree, but no visible-window attribution was captured. The hook reported 0 matching window events and 0 unclassified events during this run. This is NOT proof that no window flashed or that startup is fixed.

Separate docker/conhost descendants of PID 16952 and CMD/ARP/findstr descendants of PID 1860 were observed; they were not children of this QA backend. No action taken against unrelated processes.

## Acceptance

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| WIN-01: retain available process identity after window destruction | PASS for hidden controlled window | RED → GREEN real-event regression | exited/inaccessible event thread still yields PID 0 |
| WIN-02: correlate QA probe process chains | PASS for this Recheck | actual PID/parent snapshots after both readiness barriers | sampling can miss shorter processes and PID reuse |
| WIN-03: attribute user's visible startup windows | UNVERIFIED | no matching event during this Recheck | fresh startup with pre-armed monitor and external visible-window sensitivity proof |
| WIN-04: no user-visible console flashes at startup | UNVERIFIED | no app-side fix claimed | reproduce, attribute, fix responsible launcher, reverify |

[P2] Required before production or explicit acceptance: WIN-03/WIN-04. QA remains running. Home Site/Devin/Goal/Jev completion is not established by this diagnostic slice.
