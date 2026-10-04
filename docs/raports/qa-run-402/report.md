# QA402 — reset/recheck observation and cold-start readiness gap

Correction from QA403: this attempt used the wrong readiness mode, `--resume-session`, which deliberately requires a warm host. The existing cold-start variant without that flag passes with zero hosts while keeping all project/tool/HITL checks. No preflight implementation defect or relaxation is required. The original attempt below remains as historical evidence, not the current diagnosis.

2026-10-04. Fixed QA UI localhost:5288, API 127.0.0.1:3316/api; existing Home Site session W4fggLSunrJB41C24MV7C. Baseline d1413cb1 plus unrelated dirty changes preserved. No current run before reset (HTTP body length 0). Earlier user approval permits host reset. No QA restart or project mutation.

## Actions and bounds

1. Opened Settings → Agent runtimes → Devin Details in existing IAB tab 6. One swe-2 host online, CLI 3000.11.1, native filesystem/web/terminal unchecked, local bridge configured.
2. Started revised watch-console-windows.ps1 before reset: READY 2026-10-04T21:38:40.4273145Z, FINISHED 21:39:40.4424705Z.
3. Source inspection confirmed PATCH runtime/devin-cli/settings with {} preserves boolean values, performs no bridge-token action, and resets Devin registry. Used this API because Devin card has no separate reset control. Reset start 21:39:07.7571215Z, end 21:39:08.3319781Z. Safe settings response before/after identical. This comparison does not export or compare raw credentials.
4. Scoped UI Recheck. Fresh static readiness: 16 PASS / 1 FAIL, failing exact online swe-2 host/known epoch. Therefore **no live prompt sent**.
5. Fresh UI showed 0 model hosts, Active hosts None, while executable/catalog status says Online/Logged in/ACP available (773 models). Backend hosts array empty. Closed settings; existing QA399 final still visible. This is not proof of a newly started ACP host.

## Window evidence

Observer recorded 14 events, all class=unavailable; no classified console events. They span 21:39:01.3253174Z through 21:39:39.9636047Z and include CREATE/DESTROY pairs sharing hwnd. Some occur before reset. Multiple shell diagnostics also ran in this interval. Missing class/PID/visibility prevents attributing them to Devin, to consoles, or to user-visible windows. **14 events does not mean 14 console windows.** Previously these events would have been silently discarded.

The interval covers reset and check, not an actual cold prompt/agent-host startup. Cannot conclude console spam is fixed or caused by Devin.

| AC | Status | Evidence | Next |
| --- | --- | --- | --- |
| Reset while preserving safe settings | PASS | {} reset, safe before/after equality, UI flags unchanged | Raw credential identity not read |
| Observe reset/recheck window events | PASS scoped capture | 14 unclassified events in ready/finished interval | Determine class/process/visibility |
| Real cold Devin task | BLOCKED for this attempt | Preflight requires online host immediately after reset; hosts empty | Inspect cold-start admission contract without bypassing tool/security gates |
| QA remains accessible | PASS UI | Existing final still displayed after closing settings | No new live communication proof |

[P2] Readiness currently assumes a warm host and prevents the requested cold canary. [P2] Executable/catalog Online and host availability are different states; this card still requires careful interpretation. Do not change model/permissions or repeatedly restart to make the gate pass.

Screenshot [chat after reset](assets/chat-after-host-reset.png) preserves existing result, not a new-run result. No build/deploy, token generation, new approval, external sync or source change. Overall goal active.
