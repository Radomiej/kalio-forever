# QA run 78 — selected runtime header

2026-10-03, fixed QA http://localhost:5288/. Source baseline 6b27cb7 plus working changes. No Devin request, reset, credential change, or HomeSite write.

Root cause: ChatInterface derived the header from the persisted session/persona even while the user changed the launch profile. Extracted the touched runtime-label slice into useConversationRuntimeLabel, shrinking the already oversized ChatInterface. Empty launch sessions use the selected profile; established conversations retain their persisted runtime.

| AC / PIT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Selected profile header / PIT-03 | PASS | Live IAB, existing empty QA77 session, selected exact SWE-2; chat-runtime-label became Devin CLI · swe-2 | Narrow screenshot and next-turn inference proof |
| Profile ownership regression / PIT-26 | PASS | 3 new selector tests plus 4 existing runtime-label tests | Full UI model/persona override matrix |
| Chat component regression / PIT-37 | PASS | ChatInterface.test.tsx: 93 tests | Live established-session twin |
| FE static gates | PASS with warning | typecheck exit 0; focused eslint exit 0, one existing hook warning | Full FE lint warnings remain |
| QA frontend artifact / PIT-29 | PASS | Build exit 0, 3110 modules, index-DwooXRXt.js, 8.81s; new browser tab consumed QA and showed corrected label | Chunk-size warning; dirty source is not clean committed release |
| Context counter diagnosis | CORRECTED | useContextUsage includes base system prompt and tool catalog with empty history | No evidence of stale previous-session context; badge UX not changed |

One implementation attempt. Tests were added with the extracted helper, not RED-first against the previous monolithic implementation. No durable screenshot was captured in this run. Whole goal remains active; this does not prove current Devin inference, CMD suppression, or all CTO requirements. Changes remain uncommitted pending coherent review of the existing owned chat diff.
