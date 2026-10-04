# QA255 — real saved-turn native-audit provider boundary

2026-10-04. Fixed QA localhost5288/API3316, AppData QA, Chromium1280x720. Frontend updated in QA254, fix commit9f683495. Read-only: no model prompt, target file, command, provider or backend restart.

qa-native-audit-readonly.spec.ts: **1 PASS, 3.1s**. Exact real Devin build turn HccFyxg08nDpfWthfFpDe in W4fggLSunrJB41C24MV7C has one collapsed native audit. Opening issues one successful request with exact sessionId/turnId and type=runtime_event. Refresh enabled, no error/limit alert. Closing and F5 retain collapsed state and do not refetch. Session message response byte-for-byte unchanged. Known Codex follow-up QA247_CODEX_FOLLOWUP_1791117414416 has no Devin audit panel.

| Acceptance | Status | Evidence / boundary |
| --- | --- | --- |
| Known Devin offers on-demand turn-scoped audit | PASS browser | One exact filtered request, successful API response |
| No auto fetch or new conversation turn | PASS browser/API | Request count stays one after F5; messages unchanged |
| Known Codex does not claim native Devin | PASS browser | No panel in exact Codex bubble |
| Native execution itself | N/A | Read-only inspection; lack of correlated audit is not proof no native process ever ran |

Screens: [Devin panel](assets/devin-scoped-audit.png), [Codex boundary](assets/codex-no-devin-audit.png). Devin screenshot visually inspected: empty correlated native evidence reported honestly, not an execution claim. Full root test gate started separately after this attempt; its result is not implied by this PASS.
