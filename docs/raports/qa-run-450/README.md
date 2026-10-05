# QA 450 — replace PowerShell port probes and observe restart

2026-10-05 Europe/Warsaw. User reports four or five fleeting startup windows. This remains an open observation, not a dismissed report.

Changed `scripts/stack-port-owners.mjs`: one direct `System32/netstat.exe -ano -p tcp` query per lifecycle stage, `windowsHide: true`, no PowerShell or command shell. Fresh ownership retained; malformed output, zero listener PID and conflicting listener owners fail closed. IPv4/IPv6, unrelated ports, established connections and localized headings covered. No app contracts, database settings or target-project files changed.

RED: updated regression fixtures failed 3 tests against the old PowerShell implementation. GREEN: 7/7 port-owner tests, including two actual Windows listeners and their closure; 34/34 runtime script tests. `git diff --check` passed (CRLF conversion warnings only).

One ordinary fixed-QA restart, no concurrent test/preflight. Backup `.tmp/qa-provider-backup/qa-before-450.db`, 7,221,248 bytes, sensitive and ignored. Active-run guard passed. Credentials/app_settings/embedding_credentials/execution_profiles digests unchanged, row counts 1/4/0/21. Launcher PID 17448 exit 0; API PID 23200, UI PID 56164, both HTTP 200. Existing global mock fallback retained; this does not change explicit Devin/Codex session profiles.

Observers ready 2026-10-05T00:35:23.977Z, ended 00:36:03.987Z, both exit 0 with empty stderr. Process snapshots: 1294 samples, maximum gap 46.5832 ms. Six direct netstat starts and no PowerShell descendants recorded for the launcher. Backend still starts cmd-based CLI version probes (Copilot/Gemini/Claude/Codex); no Devin conversation initiated in this measurement.

Window observer recorded nine unclassified create/destroy events between 00:35:44 and 00:36:01. Identified event PIDs 29692, 22760 and 62240 do not occur in the recorded owned descendant list; one PID unavailable. This does NOT establish they are unrelated: short-lived processes can escape snapshots. Class/visibility unavailable, so no visible-console classification and no claim that all flashes are fixed.

| AC | Status | Evidence / remaining |
| --- | --- | --- |
| PORT-OWNERS | PASS | 7 tests, real Windows open/close, successful fixed-QA restart |
| NO-POWERSHELL-PROBES | PASS | Six native netstat starts, no launcher PowerShell descendants |
| QA-AVAILABLE | PASS | API/UI HTTP 200, UI http://localhost:5288/ |
| QA-PROVIDERS | PASS | Backup plus unchanged digests |
| NO-VISIBLE-FLASH | UNVERIFIED | Nine unclassified events; source and visibility still unresolved |
| HOME-PREVIEW | UNVERIFIED after restart | Backend-owned preview may have stopped; restore only through approved Kalio UI flow |

Verdict: partial runtime improvement, not closure of the user's startup-window defect. No commit or production deployment in this attempt. Next: attribute remaining fleeting windows and inspect backend version-probe descendants without assuming Devin caused them.
