# QA188 — hide Devin audit using the immutable turn runtime

2026-10-04. Fixed QA UI http://localhost:5288/, API :3316, AppData kalio-forever-qa. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-edit HEAD 027427ef plus preserved mixed dirty work. Backend QA167 unchanged; frontend rebuilt index-DoDTxWPE.js and runtime-config restored to :3316. No reset, provider/config change, new LLM prompt, target write or terminal spawn.

Actual latest Codex journal GET for turn u_n4TG4duuGRZXn6FgtLL records provider codex-app-server. llm.turn.started has model but no provider, so model-name inference and mutable session/persona bindings were rejected. Existing history hydration already fetches exact scoped ChatRunSnapshot records. Project its provider into the local AgentTurn presentation; panel uses that value or an exact matching live runtime snapshot. No extra HTTP calls/polling, persisted schema change, or shared type edit. Unknown legacy turns retain the audit disclosure, marked TODO legacy fallback, to avoid hiding historical native evidence.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Historical runtime identity | PASS locally | Successful journal projection, session/turn isolation, no input mutation | Missing provider in old journal stays unknown |
| Live runtime identity | PASS locally | Exact live session/turn only; unrelated newer turn cannot override historical provider | Live browser timing separately scoped |
| Known Codex hides Devin panel | PASS | Panel regression; current QA187 result retains Kalio fs_read but no Devin panel before/after F5 | Unknown legacy Codex remains inspectable by design |
| Known Devin retains audit | PASS | Current QA181 turn opens exact scoped audit before/after F5 with scope/absence warnings | Other native categories separately scoped |
| Gates | PASS | 77 tests/4 files plus 3 hook tests; tsc exit0; build 3118 modules | Existing bundle-size warning |

Chromium 1280x720, read-only qa-native-audit-scope-readonly.spec.ts: 2 passed (4.2s). Screenshots assets/codex-without-devin-audit.png and assets/devin-audit-scope.png saved; Codex screenshot visually inspected. Source-only trailing fallback comment added after build, behavior identical. No full release/goal completion claim; remaining mixed source/settings/lifecycle coverage stays open.
