# QA471 — distinguish graph identity loading from missing evidence

2026-10-06, fixed QA localhost:5288; existing real Devin QA470 history.
No backend restart, target edits, provider reset or new live agent prompt.

The audit hook now keys settled evidence by session and lifecycle. It exposes
loading separately, retains same-session recorded evidence during refresh, and
never leaks evidence between sessions. Graph projection shows Loading runtime
model while pending; settled missing evidence remains Runtime model unavailable.
Existing cancelled-turn projection changes were preserved.

| AC | Status | Evidence / remaining |
| --- | --- | --- |
| Pending vs settled-empty distinction | PASS unit | regression RED: undefined instead of true; GREEN afterwards |
| Graph loading vs missing presentation | PASS unit | direct projection assertion covers both labels |
| Exact-session audit and error behavior | PASS unit | existing hook regressions retained |
| Local gate | PASS | initial 2 files / 10 tests, frontend typecheck and build exit 0; strengthened rerun 3 files / 42 tests |
| Fixed QA reload / completed real turn | PASS scoped | Chrome shows Devin SWE-2 QA - swe-2, Turn completed, one collapsed two-call group, QA470_RESULT |
| Delayed loading presentation in real browser | PASS observed in QA475 | natural initial graph snapshot shows Loading runtime model, subsequent snapshot settles to gpt-6-luna; no artificial delay interception |
| Console flashes / Jev goal integration | UNVERIFIED | unchanged and outside this correction |

Vite preview serves rebuilt dist without process restart. Existing runtime-config
middleware retains authoritative QA API origin; generated static default is not
the served runtime config. Build warning: main chunk exceeds 500kB, not introduced
or addressed here. Commit scope excludes the pre-existing cancelled-turn hunk;
broader goal remains active.
