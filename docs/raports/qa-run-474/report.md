# QA474 — reconcile actual Devin bridge/tool audit for QA470

2026-10-06. Read-only scoped QA audit, no new prompt, restart or target changes.
Session W4fggLSunrJB41C24MV7C; durable turn 7GChxC0fph8aK_TMiMe3a.

| Acceptance | Status | Durable evidence |
| --- | --- | --- |
| Active Kalio bridge and native policy | PASS configuration recorded | WfHys3iWIwPp59B83ay4D: bridge enabled, stdio; filesystem/web/terminal false, source settings |
| Tools exposed via intended bridge | PASS | iKHjXmx5uKKA0SWFn3Xon: kalioToolCount 6, providerToolCount 0; two accepted mcp_approval events for kalio-runtime terminal_list/output |
| Actual Kalio dispatch results | PASS | matching call/result pairs mcp-18c6d5c1-449f-415c-9291-032fd50d0ae3-4 and -5, both success; same IDs in persisted messages |
| Final lifecycle and count | PASS | z_IX1GQsTYucCG6bUacCp: end_turn; wV9cjs7-IKX7hExmJpz4q: completed, toolCallCount 2; journal completed swe-2, retryCount 0 |
| Native approvals in this observed interval | none recorded | 23 audit rows in startedAt1791287273897 through completedAt+1000ms1791287281037, native_approval count0 |
| All historic/native activity absent | UNVERIFIED | no global negative claim, OS process traces and provider-internal activity not audited here |

Audit query returned 2000 most recent session rows with oldest timestamp
1791106418544, earlier than this turn. The 2000-row cap is a historical coverage
limit; it must not be interpreted as a complete lifetime audit. Only selected
metadata, decisions and counts were printed, not file contents or credentials.

ACP approval toolCallIds differ from Kalio dispatcher IDs. Correspondence here is
by exact durable turn, bridge server, tool name, ordering and time plus the
dispatcher call/result IDs. Do not falsely equate these different IDs.

The observed read-only turn successfully used Kalio tools, not a prose-only mock.
This closes the previously unverified audit-reconciliation row for QA470 only.
Console flashes and Jev integration remain open; overall goal stays active.
