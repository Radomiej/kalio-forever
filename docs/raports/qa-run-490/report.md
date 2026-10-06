# QA490 — real Codex communication after QA restart

2026-10-06. Chrome fixed QA, session yvD83rgDA_ZHvUwJKlo_S.
UI selected Codex / gpt-6-luna. Sent one no-tools literal-response prompt.
Assistant iYedrFDwIVTV3YMde7Keq returned exactly QA490_CODEX_OK.
Scoped run Wwgtd0ucSxfwsw-4aJqqG, turn bA9viDLehJK4uIiCze4Mf:
provider codex-app-server, model gpt-6-luna, completed/completed, retryCount 0.
Both prompt/answer have no toolCalls. UI exact-response count one, Stop zero.
result.jpg captures settled response.

| Requirement | Status | Boundary |
| --- | --- | --- |
| Codex communication after restart | PASS live | exact answer plus actual provider run |
| Mock not substituted | PASS | codex-app-server recorded |
| Settled response/no duplicates | PASS UI | count one, Stop zero |
| Codex tool execution after this restart | UNVERIFIED | intentionally no-tools test |
| Console and Jev requirements | NOT DONE | not tested here |

No settings or target files changed. Earlier Codex tool read proof is separate;
this run establishes only post-restart basic communication.
