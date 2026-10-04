# QA362 — Devin pending approval survives backend restart

2026-10-04. Fixed QA localhost:5288/API3316; same AppData database, no reset. Deployed context protection source remains uncommitted. Local gate previously passed: 53 tests and API build/typecheck.

Warm static preflight: 17 PASS, existing exact SWE-2 session W4fggLSunrJB41C24MV7C and approved E:/Projekty/home-site scope.

UI prompt requested exactly one npm run build. Before restart, scoped current run mYvEfslQOOCPq45_W65El / turn RSRgmADepW0Zo8_f0KI0v was waiting_for_human, tool_pending, provider devin-cli-acp/model swe-2, external thread sincere-limit. Managed force-restart retained the database. After reload Home showed exactly one pending terminal_spawn. Open navigated to the correct chat; arguments verified, then Confirm clicked once.

Audit from 1791142892652 to 1791142957419: one terminal_spawn tool_call, one process.cmd.invocation, ACP session.resumed, one terminal_output call/result, ACP and LLM completed. No duplicate spawn or second approval. Terminal tVAybjuBBv2DttS5Hna0M exited 0; Vite 5.4.21, 26 modules, 479 ms. Current run response empty after completion. Screenshot recovery-result.png.

PASS: durable approval hydration on Home/chat, one approved execution after restart, committed terminal ID reused, real output read and completed turn.

Boundary: no console hook in this restart test; QA361 has separate bounded 60-second zero-event evidence. One successful recovery does not establish universal Devin stability or definitively attribute QA359's duplicate to compaction. Home Site preview still must be restored through Kalio; remaining responsive/full workflow checks remain open.
