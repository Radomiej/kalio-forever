# QA342 — repair relative API regression in native preview config

2026-10-04. Fixed QA. Attempting Codex validation exposed a regression introduced by the QA337 preview config: Agent runtimes showed Unexpected token '<' and no native profiles. Chat uses explicit API origin; this settings consumer uses relative /api and received SPA HTML because preview proxy was omitted.

Added explicit preview proxy for /api to API origin and /socket.io to WS origin with websocket forwarding. Regression assertions first failed on missing targets, then all 37 script tests passed. Restarted managed QA after both scoped sessions were idle, retaining existing database.

Actual frontend-origin /api/health: HTTP 200, application/json. /socket.io/?EIO=4&transport=polling: HTTP 200 with Engine.IO open handshake. Websocket upgrade separately unverified. Browser F5 -> Settings -> Agent runtimes now displays saved Devin bridge/token state, Codex 1 profile and Claude Code 5 profiles with no HTML/JSON error. Screenshot integrations-proxy-fixed.png. Cold host status Not checked is expected in this screenshot; not a successful Codex communication claim.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Relative API consumer routing | PASS | HTTP JSON and real settings UI |
| Socket.IO polling proxy | PASS | Engine.IO open handshake |
| Websocket upgrade | UNVERIFIED | Not independently tested |
| Codex real run | UNVERIFIED | Preflight found cold host; test interrupted by proxy bug |
| Console measurement after this restart | UNVERIFIED | No hook running in this attempt |

Managed restart stops preview terminals; Home Site restoration remains required. This report corrects QA337's narrower routing proof: runtime-config HTTP alone did not prove relative API consumers.
