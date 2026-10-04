# QA386 — live QA availability and bounded version probe

2026-10-04. Fixed QA UI returned HTTP 200. Devin session W4fggLSunrJB41C24MV7C current-run endpoint returned an empty body, so no active run was observed. No restart or provider-setting mutation.

Read-only `devin --version` via system Node execFile with windowsHide=true succeeded: devin 3000.11.1 (cc4e349ca55e), startedAt 1791147409952, endedAt 1791147409979.

Twenty-second event hook returned READY and FINISHED records=0. However, approval/tool latency separated registration and the probe, and READY/FINISHED lacked timestamps. Exact overlap cannot be proven; this attempt must not count as evidence that the version probe creates no visible windows. Added UTC timestamps to both diagnostic boundaries for subsequent correlation.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| QA availability | PASS | Live UI HTTP 200 | Not full application acceptance |
| Version probe | PASS | Real executable output and timestamps | Not host startup or ACP communication proof |
| Console attribution | UNVERIFIED | No events; probe/observation overlap unproven | Timestamped bounded observation around actual startup |

Overall goal remains active. QA, credentials and Home Site were left untouched.
