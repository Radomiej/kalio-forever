# QA148 — Real SWE-2 HomeSite preview recovery

2026-10-04. Checkout `codex/kalio-provider-runtime-ux`, HEAD before test `9bdf5095`; pre-existing large dirty runtime/UI tree preserved. Fixed QA UI http://localhost:5288, API http://127.0.0.1:3316/api, existing AppData QA database. No rebuild, reset, provider/token mutation or target source edit.

Installed `kalio-manual-qa` skill was absent; used its repository copy `docs/agent-skills/kalio-manual-qa.md`. Coding workflow, closure and design pitfall guards require real UI/tool/recovery evidence, not HTTP health alone.

Preflight: existing-session Devin readiness PASS, exact `swe-2`, strict profile, six allowed Kalio tools, manual confirmation, native filesystem/web/terminal disabled, known host epoch, no current run or children. This is not a pricing proof.

Before action, old HomeSite preview refused connection. Chromium test submitted the prompt through Kalio Talk, inspected the full arguments and exact audited payload before confirming one `npm run preview -- --host 127.0.0.1 --port 57868 --strictPort` in `E:/Projekty/home-site`. No process CMD audit event before confirmation; exactly one afterward. Only `terminal_spawn` and `terminal_output` were called. Test PASS 9.6s (scenario 8.7s).

Session `W4fggLSunrJB41C24MV7C`, turn `3yyUZJaV7HznXabpr0JjQ`, run `zvtDs3tbmRXGLpiR_WxQa`, Devin thread `sincere-limit`, epoch `W1QRx6O0PGROHcAdDTdl5`. Audit reports completed ACP turn and completed Kalio turn, two tool calls, zero thinking length. Agent response reports terminal `rP8bxOLNr-2sO-3eeYJOn`, PID 56092, running. Independent HTTP and rendered page prove preview serves the built site; prose alone is not the process-state oracle.

| AC / PIT | Status | Evidence | Remaining boundary |
| --- | --- | --- | --- |
| Real SWE-2 / PIT-08,36 | PASS QA | UI model label, readiness, ACP audit | Other models not tested here |
| Manual scoped command / PIT-03 | PASS QA | Exact payload checked; one confirmation and spawn | Reject/timeout covered separately, not replayed here |
| Response lifecycle / PIT-37 | PASS QA | Final heading survives F5; no Stop or reconnect banner | All runtime panels not exercised |
| Preview / PIT-04,05,18 | PASS QA | HTTP200 and rendered H1, screenshot | Full responsive/form audit not repeated |
| CMD burst attribution | UNVERIFIED | Exactly one audited CMD in this turn | OS short-lived console tracing still unavailable |
| Overall requested goal | OPEN | This recovery is a scoped real flow proof | Remaining integration/UX and clean delivery gates |

Screenshots: [approval](assets/preview-approval.png), [response after F5](assets/preview-response-after-f5.png), [HomeSite](assets/home-site.png). Desktop full-page screenshot visually inspected: company demo sections and explicit fictional-data/form disclaimers render. The upper hero has substantial empty right-side space; no styling changes made in this recovery run.

Preview is a child of the QA terminal lifecycle: a QA backend shutdown can stop it. Recovery is currently explicit through Kalio, not a claimed persistent deployment feature. QA remains available; provider settings were not changed.
