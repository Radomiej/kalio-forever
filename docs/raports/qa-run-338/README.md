# QA338 — real cold Devin ACP read after preview fix

2026-10-04. Fixed QA, real Devin ACP profile swe-2, exact approved Home Site session W4fggLSunrJB41C24MV7C. Static cold-host readiness passed all 17 checks, including no hosts, no unresolved run, six approved Kalio tools, manual write/spawn approval, native filesystem/terminal disabled.

Window hook ready before UI prompt: exactly one Kalio fs_read of E:/Projekty/home-site/package.json, no terminal/writes/native tools. UI final QA338_DEVIN_READ_RESULT, actual name nexora-home-site; Stop buttons 0. Screenshot devin-cold-read.png.

Audit request TdAE4zFSOdewRc95G3U9o: one fs_read call/result, real ACP session.resumed/turn.started/turn.completed and llm.turn.completed. Native tool audit UI label is not itself proof of native tool execution; actual file read is labeled Kalio and reconciles to tool_call/result. No write or terminal request observed in this turn.

Backend startup parent 45956: version child 36512 (23 ms), MCP discovery 54140 (2122 ms), verification 6476 (519 ms), all windowsHide=true. This is a cold host loading an existing external session, not a brand-new conversation.

Overall goal remains open: Home Site preview restoration, further workflows and Jev acceptance remain separate gates. Do not substitute this successful read for generated-project build/write verification or full application readiness.

45-second window capture completed normally, exit 0, zero console/Terminal events. Captures overlapped all three startup probes and the observed final response. Together with QA337 this closes the measured single QA restart + cold Devin read scenario, not all historical/intermittent launch paths.
