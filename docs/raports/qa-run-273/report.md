# QA273 — first-prompt title with an explicit local HTTP provider

2026-10-04, Europe/Warsaw. **2 passed (2.8s), exit 0**. Isolated Chromium, one worker, existing builds, API 56902. System Node outside sandbox; apps/e2e/scripts/run-playwright-with-stack.mjs ac-21-session-title.spec.ts. Fixed QA and Home Site unchanged.

QA272 reproduced the obsolete preparation failure. Minimal test-only repair provides a random-port loopback HTTP server with OpenAI-compatible SSE and deterministic response, registered as an explicit Ollama credential/profile only in isolated Playwright storage. The ordinary provider/model picker selects e2e-title-provider before the first prompt. No initialized conversation or previous assistant turn substitutes for this contract; no mock becomes selectable in production. The actual backend adapter logs HTTP 200 streaming for the selected model.

| Area | Status | Evidence | Remaining |
|---|---|---|---|
| First-prompt title | PASS | New Chat changes to bounded summarized title after UI send | Deterministic local provider, not live LLM quality |
| F5 | PASS | Header retains final title after reload | No concurrency assertion |
| HTTP adapter boundary | PASS | Real loopback SSE, backend Ollama adapter | External service not contacted |
| Visual evidence | PASS | Captured screenshot copied byte-verified and inspected | Desktop only |
| Overall release | NOT CLOSED | 18 original QA257 failures remain unresolved; full suite not rerun | Remaining runtime and workflow gates |

Local server and fixture credential are cleaned in finally; profile remains confined to disposable runner storage. No app source, QA provider setting or target-project file changed. Cleanup was subsequently tightened to invoke provider.close even if session cleanup fails; no different product behavior is introduced.
