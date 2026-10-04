# QA361 — real Devin build after context protection deployment

Date: 2026-10-04. Fixed QA UI localhost:5288, API 3316. Existing AppData QA database retained; no database reset.

API local gate: 53/53 focused context/preview/resume/Devin adapter tests passed; Nest build passed, TSC zero issues, SWC 682 files. Uncommitted source deployed by managed restart with skip-build.

Static Devin preflight: 17 checks passed, exact swe-2, E:/Projekty/home-site, six approved Kalio tools, manual HITL, native filesystem/terminal disabled.

Real UI request in session W4fggLSunrJB41C24MV7C: exactly one npm run build, manually confirmed once. Audit window 1791142764758–1791142798335: one terminal_spawn, one process.cmd.invocation, one terminal_output; ACP and LLM completed. Terminal eXGPfvhdjKj4amhOfVHKj exited 0. Vite 5.4.21, 26 modules, 461 ms. Screenshot: build-result.png.

Console event hook ready before request, 60-second observation completed with records=0. This is bounded evidence for this run, not proof that all startup flashes are eliminated.

Not proven: backend restart while awaiting approval. Devin's prose incorrectly claims that boundary was tested; this run restarted QA before submitting its prompt. No direct causal proof yet that context compaction caused the duplicate command in QA359. Home Site preview still requires restoration through Kalio.
