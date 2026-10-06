# QA487 — real fixed-QA startup capture

2026-10-06, capture READY 12:28:10.430 UTC, observer finished 12:29:40.444 UTC.
QA stopped and restarted through the managed direct runtime, no build/database
reset or Devin chat. All three launcher/observer exits zero, no stderr.
New backend PID54860, frontend PID52048. UI localhost5288 returned HTTP200.

Backup .tmp/qa-backups/qa-1791289683225-56068.db passed integrity_check.
Before/after configuration unchanged: app_settings 4 rows and execution_profiles
21 rows, matching SHA256 digests recorded in prior QA reports.

Raw ignored artifact .tmp/startup-captures/capture-1791289780480-20932.json.
32 window events, all unclassified. Exact PID correlation with process samples:
- 19 OBJECT_DESTROY events: powershell.exe parent13376;
- 6 callbacks: pwsh.exe parent16264 (two CREATE, four DESTROY);
- 1 callback: docker.exe parent64800;
- 6 callbacks without sampled process match.

Parent13376 was previously independently identified as mcp-dev-servers. These
19 matching callbacks are not descendants of new QA backend54860. This narrows
ownership of captured churn, not proof of console visibility: no window class
or original visible state could be recovered. No claim that all flashes belong
to this parent, or that the console defect is fixed.

| Requirement | Status | Evidence / remaining |
| --- | --- | --- |
| Actual startup observed, not idle substituted | PASS | managed restart after both READY barriers |
| QA configuration preserved | PASS | backup integrity and exact matching digests |
| QA UI available after restart | PASS HTTP | port5288 HTTP200; browser revalidation pending |
| Captured process owner narrowed | PASS scoped | 19 exact PID matches, parent13376 |
| Visible flash/callsite proof and fix | UNVERIFIED | unknown classes, external owner scope pending |
| Devin/Home Site restored after restart | UNVERIFIED | no new provider run or preview recovery this capture |
