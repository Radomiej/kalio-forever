# QA212 — graph model audit truncation, confirmed diagnosis

Date: 2026-10-04. Fixed QA database read-only inspection with system Node/better-sqlite3. No records or settings changed; no model invocation. Session W4fggLSunrJB41C24MV7C, hot and archive sources.

## Evidence

- `recordedTurnModel` consumes only runtime_event entries labelled llm.turn.started with matching session and turn ids.
- `useExecutionGraphTurnModels` requests all runtime_event labels for the session, source all, limit 2000.
- Audit endpoint filters type/session/turn/time/source but offers no exact label filter. Limit is applied after hot/archive merge and sorting.
- Read-only database count: 97 llm.turn.started entries in this session across both sources.
- Reproduction of the endpoint's latest-2000 query: 2000 rows, only 95 llm.turn.started entries. Two required identity records are excluded by unrelated event volume.
- Largest label counts: devin-cli-acp.tool 1006; devin-cli-acp.mcp_approval 237. Audit data bodies, credentials and prompt text were not printed.

[P2] Confirmed model-history incompleteness from broad audit pagination. This is not proof that tool history or the actual provider run failed.

## Proposed bounded correction

Add an optional exact label filter to the existing audit query/controller, parameterized in the shared SQL predicate for hot and archive. Graph requests label llm.turn.started. Existing callers without a label retain current behavior. Keep warning/failure behavior if the filtered evidence itself reaches its limit; do not fabricate runtime models or increase the limit indiscriminately.

Verification required: real SQLite controller regression with older matching events behind newer unrelated events; archive and session isolation; literal label escaping; FE request filter and session switch behavior; affected typechecks/builds; real QA graph after deploy and F5 without losing the expected model evidence. Backend deployment must preserve QA provider configuration and restore the managed HomeSite preview if shutdown terminates it.

Status: diagnosis PASS; correction not yet implemented or deployed. The overall goal is open.
