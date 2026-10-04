# QA287 — real Devin preview and Home Site browser checks

Date: 2026-10-04, Europe/Warsaw. Fixed QA UI http://localhost:5288/, API http://127.0.0.1:3316/api. Persistent AppData QA, source runtime deployed in QA286 at 997bfd3a. Foreign work preserved; no target source edits, builds, installations, commits or provider changes in this attempt.

## Real provider and approval

Existing-session static readiness passed all 17 checks immediately before the UI action. Approved session W4fggLSunrJB41C24MV7C uses exact Devin swe-2, strict bridge and E:/Projekty/home-site. Native filesystem/terminal remain disabled.

Through Talk, requested exactly one Kalio terminal_spawn: npm args [run,preview,--,--host,127.0.0.1,--port,57868,--strictPort], cwd E:/Projekty/home-site. The inline approval appeared with full correct arguments. Captured screenshot, then clicked Confirm under existing user authorization. Devin called terminal_output and returned heading QA287_PREVIEW_RESULT, terminal VwXRUqXO7Rvub_B39E5MO, status running. Browser successfully loaded NEXORA at http://127.0.0.1:57868/.

Scoped audit since the latest llm.turn.started: turn MJN0Rb25mVTMTJjKj5rVO, exact swe-2, 28 rows, two tool calls and matching results (terminal_spawn, terminal_output), one llm.turn.completed. Spawn call mcp-e68e3650-d554-4c06-9eb4-776ce62bf00f-2 reports success. No repeated spawn appears in this scoped turn. This does not establish a machine-wide CMD-spam diagnosis.

## Browser acceptance

In-app browser; tested rendered website, not only HTTP health. Temporary viewport overrides reset afterwards.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| PREVIEW-01 | PASS | Inline manual approval, scoped spawn/output audit, running terminal, rendered NEXORA | Backend restart stops owned preview; not an independent persistent website service |
| FORM-01 | PASS | Synthetic Test QA / qa@example.com; submit displays explicit demo/no-message-sent notice | Not a real email delivery feature |
| FORM-02 | PASS | Reset then empty submit: three visible field errors, three required invalid inputs, focus on imie | Other malformed input combinations not exhaustively tested |
| MENU-01 | PASS | 390px open then same toggle closes normally; no force-click | Other mobile devices not tested |
| MENU-02 | PASS | Reopen then Escape closes, active element aria-label Otwórz menu | Full keyboard traversal not retested |
| WIDTH-01 | PASS | 320px scrollWidth305, 390px375, 1440px1425: no document horizontal overflow | This does not prove every child layout or contrast requirement |
| CONTENT-01 | PASS | Rendered services, portfolio, opinion and contact; fictional projects/company/contact and no-send demo disclaimers visible | Complete content/design/accessibility audit remains open |
| DELIVERY-ALL | UNVERIFIED | This attempt proves real preview/tool approval and selected website interactions | Codex current-build proof, full runtime gate, remaining QA issues and Jev loop remain open |

Screenshots:

- [Approval](assets/preview-approval.png)
- [Devin result](assets/preview-result.png)
- [Initial desktop](assets/home-desktop.png)
- [1440px](assets/home-desktop-1440.png)
- [390px menu open](assets/home-mobile-menu-open.png)
- [390px](assets/home-mobile-390.png)
- [320px](assets/home-mobile-320.png)

First six captures were byte-verified (95931 / 260284 / 265897 / 15117 / 98475 / 99245 bytes respectively in file-name inventory); 1440px capture also saved. Mobile menu screenshot visually inspected. No defect was reproduced in the specific interactions above, so no speculative target-source fix was made. Full original objective remains active.
