# QA304 — UI-saved architecture variant workflow passes

2026-10-04. Isolated Chromium mock stack API49694/UI49693, per-run database under data/playwright-stack/1791132313682-40464. Fixed user QA not restarted. System Node outside sandbox; KALIO_PLAYWRIGHT_SKIP_BUILD=1 reuses fresh API/frontend builds.

QA292 RED: profileless empty session left welcome Run disabled. Replaced only fixture preparation with existing repository createExistingMockConversation, binding an explicit isolated mock execution profile and durable seed. Replaced welcome-only option-presence assertion with chat-architecture-select value assertion for the existing-chat surface. Kept UI variant maxToolAttempts7, completed run/schema/graph and completed timeline assertions.

Command: node scripts/run-playwright-with-stack.mjs architecture-chat-subagent-turn.spec.ts --grep 'saves an Architect UI variant' --project=chromium --workers=1 --reporter=line. Terminal exit0,1 passed7.8s. HostfqczVsZEX7SaYXi_-bmZG, workflowQeu1KTyIAjaPTZA0vhFSb. No passing screenshot captured by this test; QA292 preserves failing screenshot.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Save UI variant | PASS | Persisted maxToolAttempts7 assertion | No authoring redesign |
| Execute selected variant | PASS mock | Explicit selection, completed run/schema/graph/timeline | Real Devin/Jev goal loop not proven |
| Fixture profile | PASS | Isolated helper rejects non-Playwright DB | Other old fixtures remain |
| Fixed QA | Unchanged | No stack-manager restart | Separate live gates |

Verdict: isolated saved-variant workflow PASS; overall goal active.
