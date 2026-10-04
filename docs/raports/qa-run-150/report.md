# QA150 — Codex denial test interrupted by an ambiguous test selector

2026-10-04, same fixed QA and preserved AppData settings, model `gpt-6-luna`, existing session `yvD83rgDA_ZHvUwJKlo_S`. Initial preflight invocation used incorrect CLI argument names; corrected invocation then required a fresh catalog. Catalog refresh returned seven models without resetting the host; full readiness passed before prompt submission.

Real UI test failed in 9.0s (scenario 7.0s): global `getByRole('region', { name: 'Full tool arguments' })` matched two regions because existing chat history contains tool details. This is test locator ambiguity, not proof of duplicate execution. Failure screenshot was visually inspected in Playwright test-results; not copied into this durable folder before the next test, so that saved report screenshot is missing.

Cleanup clicked Cancel on the pending request and Stop on the remaining turn. Independent GET of `/sessions/yvD83rgDA_ZHvUwJKlo_S/runs/current` returned empty body; current-session readiness passed before retry. No approval was issued. This attempt does not prove complete denial/follow-up acceptance.

Correction scopes the arguments region to the single tool bubble containing the current Cancel button. Retry uses QA151, preserving this FAIL record. Product-wide CMD absence is not claimed.
