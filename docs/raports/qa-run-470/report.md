# QA470 — warm Devin terminal read and graph parity

Date: 2026-10-06. Fixed QA UI localhost:5288, API 127.0.0.1:3316/api.
Real Chrome UI, existing approved Home Site session; no restart or target edits.
Immediately before execution, warm readiness passed 17 checks for exact swe-2.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Existing Devin host completes real read-only tool turn | PASS | durable run jlDbpARLTfTJOSZMHZrvj, turn 7GChxC0fph8aK_TMiMe3a, completed, devin-cli-acp/swe-2, retryCount 0 | broader reliability is not proven by one turn |
| Existing preview read without duplicate spawn | PASS | terminal_list and terminal_output only; terminal 1KWdrpbWPRgFlEQSgza1g running, exitCode null, Vite URL 57868 | no new build or target edits in this run |
| Final reply survives F5 and graph round-trip | PASS | QA470_RESULT heading count 1, Stop button count 0 after reload and return to Chat | historical Thinking disclosures are not equivalent to active thinking |
| Compact graph preserves tools and final outcome | PASS scoped | one collapsed group of two calls; terminal_list, terminal_output; same final result | provider/model and persona presentation FAIL below |
| Graph displays durable model and persona correctly | PASS after settle / P3 loading defect | initial post-F5 snapshot showed oiod04Nvs_F0T_yKVuP4g and Runtime model unavailable; a subsequent settled graph shows Devin SWE-2 QA - swe-2 | distinguish loading from absent evidence; no persistent history loss proven |
| No visible console flashes | UNVERIFIED | no desktop visibility measurement in this read-only test | existing startup defect remains open |

Screenshots: result.jpg (expanded actual terminal output), graph.jpg.
Tool badges explicitly identify Kalio dispatch. This does not independently prove
the absence of all provider-native activity; no audit reconciliation was done here.
No QA reset, permissions change, new preview, or file access was requested.
QA and existing preview intentionally remain available. Overall goal remains active.

Follow-up correction (2026-10-06): the exact audit query used by the graph returned
175 entries, including llm.turn.started for this exact turn with model swe-2.
The graph reads identity asynchronously through useExecutionGraphTurnModels.
Once settled, the same latest turn displays Devin SWE-2 QA - swe-2 and Turn completed.
The initial snapshot was not proof of a persistent hydration failure. The remaining
defect is misleading loading presentation, not missing persisted model data.
No source change or QA restart was made for this investigation.
