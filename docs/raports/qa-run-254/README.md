# QA254 — require known Devin turn before offering native audit

2026-10-04. Fixed P2 found in QA251: unknown runtime provider triggered a legacy fallback offering Devin audit. Removed the fallback; only exact per-turn devin-cli-acp may render the panel. No mutable session/persona provider inference added. Historical turns without provider evidence no longer claim Devin; their source audit remains accessible through Observability.

RED 14:49:22: unknown-provider test failed, 5 existing tests passed. Updated existing audit fixtures to explicitly name Devin rather than relying on unknown. GREEN 14:49:42: 62 tests / 3 files, 1.56s; frontend tsc exit0. Vite build passed, 3118 modules, 5.06s; existing large-chunk warning remains. Fixed QA preview serves new main index-DH-gzAeR.js; runtime-config restored to API/WS127.0.0.1:3316. Backend not restarted, provider settings and target preview preserved.

Isolated UI51672/API51673, own Playwright database, Chromium1280x720. regression-thinking-answer-lifecycle.spec.ts **1 PASS, 15.0s**. New assertions ensure no native-tool-audit-panel in active mock reasoning or streamed answer. All prior thinking/answer/final/F5 lifecycle assertions still PASS. Owned isolated session and stack cleaned up by fixture/runner.

| Acceptance | Status | Evidence / boundary |
| --- | --- | --- |
| Unknown provider does not claim native Devin tools | PASS | RED/GREEN and active browser mock checks |
| Known Codex does not offer Devin audit | PASS local | Component regression |
| Known Devin retains scoped audit/errors/refresh | PASS local | Component regressions; fresh real QA panel interaction remains to verify |
| Thinking lifecycle still works | PASS browser fixture | Same reasoning/answer/final/F5 flow |
| Real provider streaming after this frontend rebuild | UNVERIFIED | No fresh real prompt in this attempt |

Screens: [reasoning](assets/active-thinking.png), [answer](assets/answer-streaming.png), [final after F5](assets/final-after-f5.png). Full root suite not run. Remaining mixed worktree changes are not part of this commit; frontend build includes that previously documented checkout state.
