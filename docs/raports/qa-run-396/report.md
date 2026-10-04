# QA396 — Codex runtime identity and durable UI parity

2026-10-04. Fixed QA existing Codex session yvD83rgDA_ZHvUwJKlo_S; no new prompt or target edit.

Durable assistant I3NO8oub1pIqRyzvQitAe, turn eJB1WsjJluQmib8Nwh7Y9, prompt SFAbyUEGgJy6z_oYhgUNW. Exact-turn runtime started event at 1791148545887 records gpt-6-luna; completed event at 1791148557721 records completed. Scoped audit interval contains one fs_read call exec-29d25275-cea9-455f-ae26-4b80c0bf7d9e for E:/Projekty/home-site/package.json, one matching success result. Tools do not themselves carry data.turnId; correlation here uses exact session/time interval plus message turn ownership, not a fabricated tool field.

After F5 latest bubble retained QA395_CODEX_RESULT, name nexora-home-site, build vite build, Kalio-labelled fs_read; Stop count zero. Graph showed corresponding final QA395 result, fs_read step and actual gpt-6-luna turn model. Shared persona name Devin SWE-2 QA remains displayed as actor name, not provider identity. No persona rename applied: it is also used by approved Devin session.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Actual Codex model | PASS for QA395 | Exact turn started event gpt-6-luna | No universal runtime claim |
| One read, no duplicate | PASS for observed turn | One scoped call/result pair, matching ID | Other turns independent |
| Final after F5 | PASS | Preserved assistant reply, Stop=0 | Queue/drain cases separate |
| Chat/Graph parity | PASS for QA395 | Graph model, fs_read and final result; screenshot | Not all architecture workflows |

QA remains available and settings preserved. Startup-window cause, Jev integration and remaining full acceptance gates are not closed. Overall goal active.
