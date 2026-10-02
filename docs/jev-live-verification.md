# Jev live verification — 2026-10-02

Verified at 2026-10-02T19:49:36.794Z, following user authorization for a real request.

## Environment

- Credential from standard QA API3316 / web5288; backend owns encrypted credential resolution.
- Current implementation in E:/Projekty/kalio-forever, commits ede6284 and 667c450; compiled DecisionSettingsService, HitlJevService, ArchitectureAutoRoutingService and JevDecisionsClient used directly.
- QA database opened read-only. No tool action or graph successor executed; no settings changed by this check. No credential secrets recorded.
- The standard QA server runs from a separate worktree and returns404 for /api/decision/config. These checks prove current backend code with that QA credential, not deployment of Decision Settings to that server.

## Results

| Request | Result | Interpretation |
| --- | --- | --- |
| OpenRouter key authentication | HTTP200, 405ms | Standard QA credential accepted |
| HITL noul: read README.md | HTTP200, 475ms, p(allow)=0.96 | Meets the0.90 approval threshold |
| Auto-routing choice: implement TypeScript and unit tests | HTTP200, 408ms, edge=implement, confidence=1 | Developer route selected by Jev; source=jev_choice, reason=confidence_met |

Requested model: typesafe/jev-1.13. Returned approval model: typesafe/jev-1.13-20260917. Both decisions used https://openrouter.ai/api/alpha/decisions through the production backend transport with its timeout, response validation and secret sanitization. Provider responses were real, not mocked.

## Corrected earlier evidence

The separate managed stack62074/62075 used a different, older credential. Its real request and key-authentication check returned401, API key expired. The earlier successful model-catalog probe did not prove key validity. Do not generalize that failure to standard QA3316/5288.

## Boundaries

The check establishes real noul and choice responses and their threshold/route interpretation. Full UI execution against the real provider, standard QA rollout, native TypeSafe entitlement, coverage/release gates, shared types PR review and overall RAD-15 closure remain separate acceptance rows.
