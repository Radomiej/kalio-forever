# QA88 — Devin Markdown boundary regression and real HomeSite audit

## Scope

Preserve the block boundary between Devin prose before a tool and its final response. QA86 showed a final heading glued to the preceding paragraph after F5. Ordinary streamed tokens must remain contiguous.

## Current evidence

- Regression reproduced in the real `DevinCliAcpLLMSource` adapter with a controlled external ACP host: `Checking output.## Preview ready` instead of two separated Markdown blocks.
- Adapter now emits missing line breaks at the first text chunk after a newly observed ACP tool. Repeated status updates for the same tool do not introduce new boundaries.
- Focused source/host tests: 16 passed, including streamed code-fence fragments without tool boundaries and repeated tool updates during text streaming.
- Backend lint and typecheck: exit 0.
- Read-only live checks: QA UI `http://localhost:5288/`, API `/api/llm/config` on port 3316, HomeSite preview on port 57868: HTTP 200.
- No provider settings, credentials, QA data, or HomeSite files changed.
- Full root `pnpm test` gate: exit 0; backend 2906 passed / 3 opt-in live tests skipped, frontend 1827 passed, launcher contract suite 14 passed.
- Nest build: 0 type issues, 674 files compiled.
- Fixed QA restarted from the new dist. Launcher PID 32388, backend 41100, frontend 23396, same AppData database. DEV also started on 3016/5188; its legacy Devin configuration was not changed and no live Devin prompt was sent there.
- Actual QA SWE-2 UI canary: one Kalio `fs_read` of `E:/Projekty/home-site/package.json`, final `nexora-home-site`, turn `BYWSsytLDaOInUQ59mCD7`. Persisted assistant message `b69F5aY7ZG0JCXSi-SLPG` contains `\n\n## QA88_RESULT`.
- Opt-in Playwright real conversation test: 1 passed (8.3 seconds); heading, terminal turn state and no stale responding placeholder survived F5 at 390/820/1440.
- Preview restored through a separate real Devin UI turn with manual confirmation of exact `npm run preview -- --host 127.0.0.1 --port 57868 --strictPort`. Test: 1 passed (9.2 seconds). Audit has one `process.cmd.invocation` for turn `QtdPCGywtpFIkQl_a6iEk`, not repeated spawns. This is scoped invocation evidence, not an OS-wide no-spam claim.
- Read-only HomeSite and graph browser audit: 3 passed (4.4 seconds). Company site passed responsive, keyboard/menu, demo form, reduced-motion and intact hero-word checks.

## Acceptance matrix

| Area | Status | Remaining proof |
| --- | --- | --- |
| Adapter regression | PASS | None for covered cases |
| Ordinary token concatenation | PASS | Unit regression |
| Live Devin response and F5 | PASS | Real QA turn, durable content, rendered headings at three widths |
| Full local project test gate | PASS | Root command exit 0; not full Playwright or production |
| QA deployment of this fix | PASS | New backend, strict SWE-2 profile and same QA database |
| HomeSite preview | PASS | UI-approved restore, HTTP 200, two real browser tests |
| Graph runtime label | FAIL | P2: uses persona recommendation instead of selected runtime/model; new follow-up required |

## Screenshots

- [Before the read-only turn](assets/before-read-only-turn.png)
- [Final response before F5](assets/completed-before-f5.png)
- [Hydrated mobile](assets/hydrated-390.png), [tablet](assets/hydrated-820.png), [desktop](assets/hydrated-1440.png)
- [Preview command approval](assets/preview-approval.png), [preview result](assets/preview-completed.png)
- [Execution Graph with incorrect persona model label](assets/real-execution-graph.png)
- [HomeSite 320px](assets/home-site-320.png), [390px](assets/home-site-390.png), [desktop](assets/home-site-1440.png)

## Boundaries

Existing previously stored glued replies were not migrated. The regression fix applies to new turns. No encrypted provider export was needed or created. A pre-restart hash comparison was not completed because an incorrect profiles endpoint returned 404; do not claim byte-for-byte provider integrity. Post-restart strict profile, persona/tool/HITL configuration and bridge/catalog preflight passed all 16 checks. Chrome/IAB MCP inventory was empty, so authorized repository Playwright drove the real QA UI. Mock helper stack URLs are not the canary target.

This report is not a release-ready or full Devin integration acceptance claim.
