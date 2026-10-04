# QA366 — complete chat module local regression

2026-10-04. Command run outside sandbox with system C:/Program Files/nodejs/node.exe from apps/kalio-api:

`node node_modules/vitest/vitest.mjs run src/modules/chat`

Exit0, 61 test files passed, 644 tests passed, duration12.93s. Includes durable journal recovery, runtime snapshots/HITL/watchlist, stop, pipeline queue, history/context previews, SQLite message repository, gateway and child continuation tests. Expected failure-path fixture logs are not live QA errors.

This validates local module regression after active-turn context protection and atomic historical tool-exchange removal. Real Devin build/restart recovery and chat/graph F5 evidence is separate in QA361/362/365. Not full application E2E, production proof or all live provider workflows. QA and Home Site preview were not restarted by this test command.
