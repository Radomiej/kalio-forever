# QA410 — full local gate and live Devin admission failure

Date: 2026-10-05. System Node; root gate run outside sandbox. No fixed QA restart or target-project mutation.

`node scripts/run-test-gate.mjs` exited 0:

- types and SDK build passed; repository preflight passed.
- selected root script tests: 119 passed.
- shared contracts: 16 passed.
- API: 276 files passed, one file skipped; 2968 tests passed, three skipped (`devin-cli-config.live.spec.ts`).
- Web: 215 files / 1889 tests passed.
- Playwright stack/wrapper launcher tests: 14 passed. This is not the browser E2E suite.

The new QA409 browser-launcher regression is not listed in the current root gate; its separate 3/3 run remains the evidence for that change. Root gate file has pre-existing foreign changes and was not edited here. Test output chunks were truncated, so only observed final summaries and exit status are claimed; no claim of exhaustive log inspection.

Live static preflight used the exact existing Devin session W4fggLSunrJB41C24MV7C, warm resume, swe-2, approved E:/Projekty/home-site. It exited 1: 16 checks passed, catalog freshness check failed. No prompt sent.

Follow-up read-only status query confirmed:

```
authenticated=true
acp=true
probeChecked=true
modelCatalogStatus=command-failed
modelCatalogStale=true
modelCatalogDiscoveredAt=1791150083784
hostCount=1
```

| Acceptance | Status | Remaining |
| --- | --- | --- |
| Full configured local test gate | PASS | Does not replace rendered E2E, live provider tests or deployment proof. |
| Fresh catalog admission before real Devin run | FAIL | Trace catalog command failure; preserve cached models but do not call them fresh. |
| New real Home Site execution | NOT RUN | Catalog admission must pass first. |
| Brief console attribution | UNVERIFIED | QA407 remains applicable. |

[P2] Catalog command failure is an active QA finding despite earlier CLI-ready/cached-model UI. No reset or credential change was attempted to conceal it.
