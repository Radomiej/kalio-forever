# QA264 — tool-intent fallback fixture repair

2026-10-04, Europe/Warsaw. Runtime assertions PASS; screenshot evidence rejected and repaired in QA265.

The failed QA257 case created an empty session without an execution profile. It now uses the isolated existing-conversation fixture with the original designer persona. The helper accepts a persona argument while retaining the default used by earlier cases. Global credential creation/activation was removed: the explicit execution profile is session-bound. The pending tool bubble, not the initialization answer, is the assertion target.

Command, system Node outside sandbox, one worker, existing builds:

`node scripts/run-playwright-with-stack.mjs mock-tool-intent-fallback.spec.ts ac-01-streaming.spec.ts ac-08-ws-error-handling.spec.ts --project=chromium --workers=1 --reporter=line`

`KALIO_PLAYWRIGHT_SKIP_BUILD=1`; isolated API `51067`. Terminal **7 passed (7.1s), exit 0**, 15:38:01. Six prior cases protect default-persona helper behavior; the designer case verifies visible `Preparing raapp_create`, confirmation event, no `tool:arg_progress` for that tool, and no chat error.

## Artifact issue discovered during visual review

The screenshot was taken after the helper's `finally` deleted the session, so the pending bubble was gone. `assets/tool-intent-progress-proof.png` is preserved as rejected evidence: it does **not** prove visible tool intent. Assertions alone were not promoted to visual acceptance. QA265 moves capture inside the approval-wait phase and reruns the exact case.

No fixed QA provider/configuration change, live Devin call or target-project write occurred. Full suite was not rerun.
