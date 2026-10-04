# QA388 — distinguish extra Devin read from duplicated bridge dispatch

2026-10-04. Read-only inspection of scoped QA387 audit records and current FsReadTool source. No live prompt, configuration change, reset or target-project mutation.

## Authoritative correlation

| Call | Request | Result |
| --- | --- | --- |
| mcp-8d4070fb-a0ab-45ad-ab24-ce1d4edb4a94-5 | path E:/Projekty/home-site/src/App.jsx only | success, matching callId |
| mcp-8d4070fb-a0ab-45ad-ab24-ce1d4edb4a94-6 | same path, startLine 250, endLine 461 | success, matching callId |

The calls have different IDs and different arguments. Each has one matching result. This sample does not show duplicate dispatch of one request. The scoped llm_response records toolCallCount=2, consistent with the two UI tool entries.

`apps/kalio-api/src/modules/tool/tools/fs-read.tool.ts` returns the whole file when no line range is specified; it has a 512KB file-size rejection, not a default 250-line truncation. The tool itself therefore does not explain the second read as obligatory pagination. Provider-side presentation or reasoning remains unverified.

## Verdict

- PASS: request/result identity in this observed turn, with no duplicate of either callId.
- FAIL: Devin's literal exactly-one-read instruction from QA387.
- UNVERIFIED: why Devin requested the second range; no vendor trace was inspected.
- No runtime de-duplication or arbitrary call-count restriction added. Either would change valid agent workflows without fixing an established transport defect.

[P2] Keep provider instruction adherence separate from dispatch reliability. Startup console attribution, actual console detector sensitivity and full Home Site / Jev acceptance remain open. Overall goal active.
