# QA107 — Safe ACP failure diagnostics, local gate

2026-10-04. HEAD37e015b plus preserved dirty changes. Local verification only: no QA restart, new Devin prompt, target mutation or provider change in this attempt. QA continues to run QA104 policy enforcement plus QA104 frontend activity-only visibility; the new diagnostic fields are not yet deployed.

Installed ACP SDK1.4.0 ToolCallUpdate supports rawOutput and content. Host now forwards them in memory. The source persists only outputPresent and permissionMentionedInFailure booleans. The latter means a failed output mentions permission/denied/not allowed, not a proven decision source. Raw output, file contents, diffs, paths and credentials are not added to audit storage.

Helper deliberately examines string output, known error/message fields and ACP text content; it does not serialize arbitrary objects or file diffs. Text examination is bounded4096characters per candidate. Successful output cannot set the failure flag. Unknown failures remain false, not assumed permission failures.

Fail-first helper3/3 RED; implementation3/3 GREEN. Focused helper/source/host19/19 PASS (2.16seconds). API build0issues,678 files, exit0. After host contract test was extended to assert rawOutput/content forwarding, helper/host7/7 PASS (1.36seconds); focused ESLint helper/spec/host/spec exit0. No full-suite or live diagnostic proof. No screenshots: no browser action in this attempt.

| Acceptance | Status | Remaining |
| --- | --- | --- |
| SDK output forwarding | PASS local | Actual installed Devin output shape still unknown |
| Safe boolean-only audit summary | PASS local | Live output may be absent or unfamiliar; do not infer denial |
| Native category policy enforcement | UNVERIFIED full scope | QA104 failed read; diagnostic deployment and category/toggle tests |
| QA availability/HomeSite | Unchanged by this attempt | Last live checks QA106 HTTP200; no fresh availability claim here |

This is diagnostic support for the QA102/104 failure boundary, not a claim that all native tools are blocked. The broader Devin and ChatGPT acceptance remains OPEN.
