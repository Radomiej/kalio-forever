# QA321 — real Devin cold start after diagnostic deployment

Date: 2026-10-04. Fixed QA 3316/5288, existing SWE-2 session W4fggLSunrJB41C24MV7C, exact project E:/Projekty/home-site.

Initial preflight incorrectly selected warm-host resume mode after stack restart and failed its live-host condition. UI Recheck refreshed status/catalog but did not create a host. Existing cold-start mode (without --resume-session) passed all 17 checks; no gate modification or bypass.

UI prompt requested exactly one Kalio fs_read of package.json, no native tools, writes, terminal or web. UI displayed QA321_DEVIN_READ_RESULT and nexora-home-site, one fs_read marked Kalio, no Stop control. Scoped current-run endpoint returned HTTP 200 with zero body bytes.

New live diagnostic records: parent PID 56760; version PID 59552 / 29 ms; discover PID 2264 / 409 ms; verify PID 59792 / 559 ms. All windowsHide=true, all successful. These prove short direct-child probes exist, not visible console windows or descendant attribution.

| Requirement | Status | Remaining |
| --- | --- | --- |
| Real SWE-2 cold-start read through QA UI | PASS | Visible final answer and tool origin. |
| Capture short startup probes without polling | PASS | Direct Node child PID logged at launch. |
| Explain/eliminate visible startup consoles | UNVERIFIED | No OS window/descendant correlation. |
| Preserve project | PASS (requested operation scope) | Read-only test; no writes/terminal requested. |

No blanket claim of full Devin stability, completed Jev integration or production readiness.
