# QA263 — saved provider persistence without selectable mock

2026-10-04, Europe/Warsaw. PASS for all nine isolated LLM panel cases; full release remains NO-GO.

QA257's fallback-switch case expected `provider-row-env` even when the environment provider was mock. The current product intentionally shows a test-only notice instead of an activation control. This was an obsolete expectation, not proof that provider persistence was broken.

The replacement test verifies the observable current contract: create/activate a saved provider, see its configured model, reload, verify the exact active credential ID from the backend and active badge from UI, then verify the model remains selected. Mock activation controls are absent before and after F5; the test-only notice is explicit. The test rejects non-isolated storage before mutation, restores the previous active credential and deletes only its own credential in `finally`, including failure during setup. Non-mock environment fallback remains a separate component/unit-test boundary, not newly proven here.

System Node outside sandbox, one worker, existing builds:

`node scripts/run-playwright-with-stack.mjs llm-panel.spec.ts --project=chromium --workers=1 --reporter=line`

`KALIO_PLAYWRIGHT_SKIP_BUILD=1`; isolated UI/API `51047/51048`. Terminal **9 passed (8.4s), exit 0**, 15:35:05. No LLM generation was requested by this settings-only sweep, and no fixed QA providers/credentials or Home Site files changed.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Saved provider/model survives F5 | PASS | Backend exact active credential ID plus rendered active badge and runtime model field | Actual generation through that provider not covered |
| Mock not selectable | PASS | Explicit QA-only notice, activation controls absent | Non-mock environment fallback separate |
| Adjacent provider UI | PASS | All nine cases including add/cancel/delete/context slider | Live integration/reconnect not proved by settings CRUD |
| Full suite | FAIL / not rerun | QA257, focused repairs QA258–263 | 20 original failed cases remain unresolved |

No production code or rendered styling changed. Prior RED screenshot/context/trace remains in QA257; no new visual-change screenshot or QA deployment is claimed.
