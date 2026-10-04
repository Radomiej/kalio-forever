# QA118 — Codex catalog-based selector (local gates)

2026-10-04. HEAD8edcbf8 plus preserved dirty work. Connects picker to GET-only cached Codex catalog per enabled saved integration; missing/unchecked catalogs do not advertise saved Codex models. Explicit Recheck uses existing model/list-check endpoint, not polling/spawning on focus. New discovered choices resolve through validated account/model backend endpoint. Original profiles remain unchanged. Earlier pending exact-search ranking changes and regression tests are included in this same picker slice.

Fail-first new discovered-model test failed while old model remained selectable. After implementation10/10 picker/new-chat tests PASS1.36s; web tsc exit0 and Vite build PASS7.64s/3116modules before final test-only addition, existing chunk warning. Runtime config restored to API3316 after build. Regression proves missing catalog hides saved choices, one GET without implicit POST, explicit refresh, exact account resolution and existing search ranking. Hook guards stale async read completion and scopes catalogs to current accounts; separate concurrency/unmount regression is still needed.

No live generation. Browser/catalog/backend deployment proof is separate from these local tests. Full integration, ChatGPT tool/HITL and OS-wide CMD stress remain OPEN.
