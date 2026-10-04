# QA126 — Devin audit reconciliation and new Codex UI launch

2026-10-04. Persistent QA UI http://localhost:5288/, API http://127.0.0.1:3316/api. Chrome desktop, same QA database and provider settings. Pre-existing dirty work preserved.

## Devin QA125 audit

Exact session W4fggLSunrJB41C24MV7C, window 1791081493317–1791081498783, turn _GSLX-jr042fva6X9uiPn. Returned 17 entries: one tool_call, one successful tool_result for package.json fs_read, one llm.turn.completed with toolCallCount=1, thinkingLength=0, textLength=101; zero process.cmd.invocation entries. Bridge reported six Kalio tools, zero declared provider tools and filesystem/web/terminal=false. This is logged invocation evidence, not an OS-wide process census or proof all native categories are impossible.

PowerShell's initial @(...Invoke-RestMethod...) wrapped the JSON array and produced invalid aggregate counts; corrected by assigning the returned array directly and recomputing. Only corrected counts above are accepted evidence.

## Real new Codex conversation

Fresh explicit catalog refresh followed by Codex profile static readiness PASS. Chrome Talk → New → persona Devin SWE-2 QA → Home Site → search gpt-6-luna → select Codex → enter no-tool prompt → Run. Unlike persona recommendation swe-2-medium, the chosen conversation model was Codex gpt-6-luna.

Created session yvD83rgDA_ZHvUwJKlo_S. API verifies persona oiod04Nvs_F0T_yKVuP4g, profile codex-local-1bd82ba45243e8a3a0c4aa0478538f67, kind codex-app-server, model gpt-6-luna and kalio_strict. Audit turn -FreDC5rvkQHZItdfT7EE started with that model and completed with zero tool calls. Rendered answer: QA126_CODEX_OK. (Model added a period; exact literal response requirement was not met.) Reload → Talk retained one exact answer paragraph, Stop agent count zero.

| Requirement | Status | Boundary |
| --- | --- | --- |
| Devin read audit reconciled | PASS | Exact logged turn/window |
| Persona recommendation overridden by user-selected Codex | PASS QA | Durable profile plus actual completed turn |
| New Codex response survives F5 | PASS QA | One visible answer, no Stop |
| Exact literal model output | FAIL | Added period; not transport loss |
| Codex Kalio tools/manual approvals | OPEN | No tools requested here |
| CMD stress, full native policies, complete goal | OPEN | No broad conclusion |

No project writes or terminal actions requested. No saved screenshot in this attempt. No production or full-release claim.
