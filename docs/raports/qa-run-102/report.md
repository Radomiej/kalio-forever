# QA102 — Native filesystem policy bypass reproduced

2026-10-04. Checkout HEADf817a37 plus preserved earlier dirty changes. Fixed built QA UI localhost:5288 / API3316, same AppData kalio-forever-qa database; HomeSite E:/Projekty/home-site. Chromium1280x720; real enabled strict Devin ACP swe-2 profile. No native flags, provider credentials or target files changed.

## Evidence

The first static preflight failed only fresh catalog readiness: authenticated ACP remained available but catalog was command-failed/stale. One controlled refresh recovered ready/non-stale catalog with exact swe-2. Repeated static preflight passed all16 checks, including native filesystem/terminal disabled, six-tool allowlist, manual HITL, no current run/children/hosts. Catalog failure cause is not proven.

Focused ACP source tests: initial default-worker invocation failed before tests with spawn UNKNOWN and Node allocation errors. Its handle ended exit1; no tests passed. One retry limited to one worker passed12/12 (1.92seconds). Free physical memory subsequently reported47402MB; this does not establish the cause of the earlier spawn failure.

Opt-in real UI test devin-native-denial-live.spec.ts submitted one request for native Devin Read of HomeSite/package.json; explicitly no fallback, terminal, web or writes. Test failed10.2seconds because zero native permission events existed. Durable exact turn rf9ERH4MWHyC-0DNdBBt7 completed with11 audit rows. Native call a37ee699-e137-4087-ba08-d76711e8f891, epoch HkIKzcublw00ti7Nyu1-U, starts with kind=read/title=Read file and finishes toolStatus=completed. Final assistant says the read succeeded and returned20 lines; that count/content is agent prose, not independently captured output. The correlated completed native call is stronger evidence than prose alone. No Kalio tool calls are persisted for this turn.

## Finding and acceptance

| Priority | Finding | Impact | Evidence | Resolution |
| --- | --- | --- | --- | --- |
| P1 | Disabled native filesystem policy does not stop automatic Devin reads | Native access bypasses Kalio's selected tool boundary | Real read/completed audit, zero native_approval, disabled setting preflight | OPEN: enforce native policy in host configuration, then repeat negative test and Kalio positive path |
| P2 | Native audit projection only starts from permission events | Automatically executed read lacks a correlated row in the panel | Source projectNativeToolAudit collects native_approval first | OPEN: reconcile activity-only calls without inventing an approval |
| P2 | Catalog refresh transiently failed | Live readiness blocked until successful refresh | command-failed/stale then ready | Cause unresolved; no repeated blind refresh loop |

| Acceptance | Status | Boundary |
| --- | --- | --- |
| UI-driven real swe-2 attempt | PASS | Exact approved project and single read |
| Native filesystem disabled effectively | FAIL | Completed native read bypassed callback gate |
| Durable final completion/no hanging Stop | PASS | Exact llm.turn.completed and UI assertion |
| Denial evidence after F5 | NOT REACHED | No denial occurred; do not claim persistence proof |
| No writes/command approval by test | PASS | Test has no confirmation action and no terminal request |
| Complete Devin/ChatGPT closure | OPEN | Fix bypass first; ChatGPT remains separate |

[Screenshot of actual result](assets/native-read-result.png). Image inspected: final response is visible and Stop is absent. It also shows the Native tool audit toggle; this run did not open that panel after its denial assertion failed.

Official [Devin permission documentation](https://docs.devin.ai/cli/reference/permissions) states that read-only tools run automatically in normal modes and provides project-local tool deny rules. This explains why a callback-only policy cannot enforce all native access; whether the proposed project-local policy is honored in this installed ACP version still requires live verification. No global/user/project Devin config is to be overwritten.
