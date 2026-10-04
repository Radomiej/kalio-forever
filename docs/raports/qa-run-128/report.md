# QA128 — Bounded CMD census during status reads

2026-10-04, fixed QA API 127.0.0.1:3316/api. No generation, settings changes or process termination.

Inspected Codex host: openSessionCount counts registered thread IDs, not active turns. Current prelaunch gate is deliberately stricter than ordinary follow-up; do not interpret a saved idle thread as a running generation. No readiness policy changed here.

First bounded read-only census around 20 status GETs (ten Devin cached status, ten native integration inventory), window 1791081956710–1791081957631: no new surviving CMD between samples. Subsequent metadata census found 106 CMD total; 66 direct children of PID12332, identified as codex.exe (parent27248). Parent identity does not establish which Codex task/MCP owns them; no command lines collected.

Added scripts/measure-qa-status-cmd.ps1 for bounded repeatable sampling: maximum 40 GETs, PID/creation-time identity, aggregate parent counts, no secrets or process termination. Actual run ten iterations window1791082012043–1791082014623: 106→107, new CMD PID59024 parent11536. This second result prevents claiming no process growth. Parent attribution and longer/event-based measurement remain required.

Parent11536 was node.exe with parent8380; ownership not established. Exact-window QA runtime audit returned zero entries, including zero process.cmd.invocation events. Absence from audit is not proof against unaudited process creation.

Sampling sees only surviving processes at boundaries, not brief flashes between samples. No causal claim that Kalio or Devin created the new process. Existing 66 direct Codex children are a significant lead for investigating agent/MCP lifecycle; never kill shared processes based only on these counts. Stop further repeated census/status bursts now that growth was observed; investigate ownership next.

Overall CMD closure UNVERIFIED; full goal remains active.
