# QA407 — short startup console investigation

Date: 2026-10-05. Scope: read-only source inspection; no QA/Devin reset or Home Site modification.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Attribute brief visible consoles | UNVERIFIED | Event-only process observer failed: CIM access denied in sandbox; elevated attempt returned HRESULT 0x80041032 (call cancelled). | Capture process starts and parent identities alongside window events during an actual startup. |
| Inspect direct host launches | PASS (source only) | `devin-cli-acp.host.ts:231–237` and both `codex-app-server-process.ts` spawn sites specify `windowsHide: true`. | Descendant process behavior is not covered by this option. |
| Inspect fixed stack launches | PASS (source only) | `stack-manager.mjs` backend/frontend spawn options specify `windowsHide: true`; captureCommand and taskkill also hide windows. | Actual startup visibility remains unproven. |
| Identify additional candidates | PASS (inspection) | `kalio-cli.mjs` openBrowser launches cmd without windowsHide; foreground server intentionally uses windowsHide:false. `repo-preflight.mjs` launches package checks and SQLite probe without windowsHide. | These are candidates, not attributed causes. No direct reference to these scripts was found in stack-manager.mjs. Do not change them as an alleged QA fix without tracing the actual caller. |
| Confirm current QA runtime | UNVERIFIED | Stored PIDs 10288/59376 were absent from the shell's process view; localhost HTTP checks were denied by sandbox permissions. Browser still renders settings, currently Checking, and Home Site content. | A rendered existing document does not establish fresh backend health. No restart based solely on these failed observations. |

The previous unknown window events do not prove either console visibility or absence. No titles, command lines, credentials, or environment values were captured. No runtime fix or release-ready claim is made by this report.
