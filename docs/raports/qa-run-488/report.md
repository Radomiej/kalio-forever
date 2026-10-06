# QA488 — real Devin cold start and Home Site recovery

2026-10-06, after QA487 restart. Exact session W4fggLSunrJB41C24MV7C,
Home Site E:/Projekty/home-site, swe-2, Chrome UI.
Cold preflight passed 17/17 with zero existing hosts; no --resume-session.

Prompt requested terminal_list and one preview start only if absent. Devin
reported no running preview and requested manual confirmation. Tester verified
command npm, args run preview -- --host 127.0.0.1 --port 57868 --strictPort,
cwd exact Home Site, then clicked Confirm. No permission expansion.

Settled QA488_RESULT reports terminal ae_Xyw8EdRQ9zdYjG5QZW running,
URL http://127.0.0.1:57868/. UI exposes terminal_list, terminal_spawn,
terminal_output as Kalio tools and no Stop/pending at completion.
Reloading the actual Home Site tab rendered NEXORA navigation, hero and services.
home.jpg preserves that rendered page. No target file edit or install this run.

| Requirement | Status | Boundary |
| --- | --- | --- |
| Devin cold communication after QA restart | PASS live | real UI request, approval, response |
| Preview recovery through Kalio | PASS live | exact command and running terminal result |
| Actual generated website available | PASS browser | preview reload rendered company page |
| No native tools/spawn retries | UNVERIFIED audit | UI shows three Kalio calls; audit reconciliation not repeated |
| Console flashes resolved | NOT DONE | separate unresolved diagnostic |

This restores user-facing QA and Home Site; it does not prove all outstanding
Jev, Codex, console or release requirements. No QA configuration changes.
