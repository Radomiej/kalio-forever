# QA334 — warm Devin status recheck with window-event capture

2026-10-04. Fixed QA UI http://localhost:5288/. In-app browser, existing configured Devin host.

Started `scripts/watch-console-windows.ps1 -Seconds 30` outside sandbox; verified `WINDOW_EVENT_HOOK_READY` before clicking the Devin article's Recheck in Agent runtimes. UI changed Online -> Checking -> Online, retaining 773 discovered models and one model host. Screenshot: `devin-recheck.png`.

Capture exited 0 with `WINDOW_EVENT_HOOK_FINISHED records=0`. This is a warm status-recheck observation only, not a cold QA startup or cold Devin ACP startup. Event delivery against a known visible console is still unvalidated; zero records cannot close the user's startup-flash defect.

No token generation, host reset, provider changes, native-tool enablement, Home Site modification or paid agent prompt occurred.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Warm Devin recheck responds | PASS | Observed Checking -> Online in UI |
| Window-event capture overlaps recheck | PASS | Hook ready before click; normal 30-second completion |
| No captured classic/Terminal console event in this interval | Observed | Zero records; diagnostic sensitivity unproven |
| Cold startup flash eliminated | UNVERIFIED | Requires cold-start capture and validated event sensitivity |
