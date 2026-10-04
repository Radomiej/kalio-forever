# QA250 — active reasoning captured; fixture observation timeout

2026-10-04. Isolated UI61556/API61557. Existing mock fixture initialized before UI prompt. Active Thinking observed once with loading and no pending duplicate; [active screenshot](assets/active-thinking.png).

Attempt FAIL: default 5-second heading observation was shorter than the deliberately configured 6-second reasoning hold. No application fix made; observation timeout changed to 15 seconds. Diagnostic holds are only test scheduling, not runtime stabilization.

[Failure screenshot](assets/fixture-observation-timeout.png) saved before retry, 57993 bytes. Test stack stopped; QA/provider settings untouched. Answer/final/F5 still unproven in this attempt.
