# QA336 — console/Terminal events captured during fixed QA restart

2026-10-04. Fixed QA 3316/5288, existing AppData database retained.

Before restart, both scoped Devin/Codex current-run endpoints returned HTTP 200 with zero bytes. Online SQLite backup `.tmp/qa-provider-backup/qa-before-336.db` completed; integrity check ok. Managed restart used existing dist, `--skip-build --force-restart --use-env-llm`, exact AppData QA root. Backend now PID 6836, frontend 45752; start 18:12:18.245 UTC. Both health/UI returned HTTP 200. Ordered-row SHA256 comparison: credentials, execution_profiles and app_settings all unchanged. Environment fallback remains mock, not proof of real agent use.

Event hook was ready before restart. Captured:

- 18:12:18.4753254 UTC: PID 49308, OBJECT_CREATE, ConsoleWindowClass.
- 18:12:18.5048278 UTC: PID 5048, OBJECT_CREATE, CASCADIA_HOSTING_WINDOW_CLASS.
- 18:12:18.5357481 UTC: PID 5048, OBJECT_SHOW, CASCADIA_HOSTING_WINDOW_CLASS.

Post-capture metadata: PID 49308 is conhost.exe, parent 59056, created at local 20:12:18. PID 5048 is existing WindowsTerminal.exe (parent 996, created 10:24:41 local). No command lines or titles collected. Attribution to a particular QA child or diagnostic shell is not yet established; temporal overlap alone is insufficient. Three events do not mean three distinct visible windows.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Capture transient window events during startup | PASS | Console creation plus Terminal creation/show events |
| Preserve QA provider settings | PASS | Three tables byte-equivalent by hash; backup integrity ok |
| QA available after restart | PASS | API/UI HTTP 200 |
| Identify launcher causing visible window | UNVERIFIED | Need parent 59056 ownership/correlation |
| Eliminate console flashes | UNVERIFIED | No launch behavior fix in this attempt |

Follow-up metadata resolved parent 59056: **esbuild.exe**, parent **45752**, which is the managed QA frontend Vite preview process. The captured conhost therefore belongs to frontend esbuild startup, not a Devin ACP child. This establishes ownership for this specific console creation; it does not independently prove that every historical flash has the same cause or that the Terminal SHOW belongs to this child.

Next fix boundary: frontend Vite preview/esbuild startup (including config loader and child spawning), not Devin native tools. No change to Devin permissions is justified by this capture.

Managed restart can stop app-managed Home Site preview terminals; preview restoration and real Devin ACP communication must be verified separately after restart.
