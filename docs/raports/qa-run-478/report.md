# QA478 — accurate Devin bridge explanation

2026-10-06, fixed QA localhost5288, Chrome, no backend/host restart.
Corrected the transport-specific help text to local MCP bridge. Actual ACP bridge
transport is negotiated and the tested QA470 used stdio; no transport behavior changed.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| Regression catches obsolete copy | PASS RED | card test initially failed finding local MCP bridge |
| Card and integration panel regression | PASS | 2 files / 17 tests |
| Frontend gates | PASS | typecheck/build exit0; unchanged >500kB bundle warning |
| Correct text served at fixed QA | PASS | after reload neutralCopy1, oldCopy0, settings.jpg |
| Credentials/permissions/host reset | N/A mutation | none requested or performed |

Files changed: DevinCliIntegrationCard.tsx (one wording change) and its test (two
assertions). No contract, token, permission or provider/default changes. Closed
settings after capture. Overall goal remains active.
