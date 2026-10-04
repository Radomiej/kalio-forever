# QA246 — restore Home Site preview through Devin

2026-10-04. Fixed QA http://localhost:5288 / API :3316, AppData QA; same exact Devin swe-2 session and approved E:/Projekty/home-site. Warm GET-only readiness passed with one online idle host and a known epoch, no current run/children.

Playwright qa-devin-preview-recovery-live.spec.ts: **1 PASS, 8.0s**. Existing preview checked unreachable before launch to avoid duplicate. UI request allowed exactly one Kalio terminal_spawn: npm run preview -- --host 127.0.0.1 --port 57868 --strictPort; no files, build, install, commits or native tools.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| Manual approval and full exact payload | PASS | One pending spawn; zero CMD before confirmation |
| One approved preview process | PASS | One terminal_spawn tool_call, one process.cmd.invocation; terminal pwT8MTlsbD0FGav-aU_p5 reported running |
| Preview reachable and rendered | PASS | HTTP 200 at http://127.0.0.1:57868/; visible H1 and saved full-page screenshot |
| Response retained after F5 | PASS | Heading QA246_PREVIEW_RESULT_1791117217297; no Stop or connection status, no current run |
| Independent restart persistence | N/A | Preview is owned by QA backend, not a standalone hosted service; another backend restart stops it |

Durable turn WO4tzAEVEaAzmJZIbxX69. Assets: [approval](assets/preview-approval.png), [response after F5](assets/preview-response-after-f5.png), [Home Site](assets/home-site.png). Home Site screenshot visually inspected. Page is a fictional NEXORA demo; its form does not send messages. Responsive/keyboard/form validation coverage is recorded in QA236 and was not rerun here.

Combined session audit since this restart: two llm.turn.started and two llm.turn.completed, two process.cmd.invocation, two requested and approved confirmations, one ACP session started and one resumed. Audit label terminal_spawn also includes result entries; command-count assertions use type=tool_call. This is scoped evidence, not a global Windows process audit. QA and preview remain running for user review.
