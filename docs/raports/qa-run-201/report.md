# QA201 — stale last-turn test assumption reproduced

2026-10-04, fixed QA backend e53b3377/frontend QA188. Read-only Chromium native-audit test failed after30.2s waiting for QA181 turn OzSjtuCsZ7ZITyzYOVqvH, because the clicked panel belonged to the newest turn, not QA181. Exit1; handle17954 observed to explicit completion. No new prompt, provider change, tool command or project write.

Failure screenshot copied before the next test cleared test-results, exact file verified104011bytes: assets/wrong-last-turn.png. This is a test-selector defect, not evidence that the application cannot load audit. Next change scopes the panel to the exact QA181 response heading and matches both sessionId and turnId in the HTTP response.
