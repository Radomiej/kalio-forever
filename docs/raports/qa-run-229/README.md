# QA229 — real Devin SWE-2 after fixed-QA restart

Date: 2026-10-04. Fixed QA http://localhost:5288/, API http://127.0.0.1:3316/api. Real Devin ACP, exact swe-2, approved project E:/Projekty/home-site. Existing session W4fggLSunrJB41C24MV7C.

| Acceptance | Result | Evidence |
| --- | --- | --- |
| Cold-start safety gates | PASS | Static readiness with zero hosts; exact profile/project, six tools, native tools disabled, manual HITL |
| Real build initiated through Kalio UI | PASS | qa-devin-approved-build-live.spec.ts, 1 PASS in 10.8s |
| No CMD before manual confirmation | PASS | Session/time-scoped audit assertion: zero process.cmd.invocation |
| One spawn and one CMD after confirmation | PASS | Same test, exact npm args [run,build], approved cwd |
| Pending confirmation survives F5 | PASS | One Confirm control, unchanged tool call audit |
| Actual build completes | PASS | terminal_output exitCode 0, Vite 5.4.21, 26 modules, built in 413ms |
| Completed result survives F5 | PASS | build-result-after-f5.png visually inspected; Kalio-origin tool badges, no connection warning |
| Warm host and drained execution after run | PASS | Resume readiness: one online SWE-2 host with epoch, no current run or child executions |

Initial warm-resume preflight failed because the backend restart cleared the in-memory host. Settings showed zero hosts; Recheck did not start a model host. The existing cold-start mode then passed all safety gates before the prompt was sent. No gate or permission was weakened. After the UI prompt recreated the host, warm-resume readiness passed.

Screens: assets/build-awaiting-confirmation.png, assets/build-pending-after-f5.png, assets/build-result-after-f5.png. Own temporary in-app browser tab closed; user tab and fixed QA remain available.

Boundary: one authorized build and session-scoped CMD audit, not an OS-wide process-spam measurement or proof of every native-tool path. No source edits, installs, deploys, or commits were requested in the target Home-site repository. Whole-product readiness and ChatGPT cold-start verification remain separate requirements.
