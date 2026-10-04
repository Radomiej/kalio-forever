# QA108 — Real native read failure with permission evidence

2026-10-04. HEAD6be0022 plus preserved dirty work. Fixed built QA localhost:5288/API3316 restarted on the same AppData QA database, no data reset. Exact owned PIDs44428/54252 and launcher45452 verified, session idle, canonical stop and old-launcher exit before hidden replacement launcher43836. New safe diagnostic fields deployed. Fresh static16-check preflight PASS before one authorized UI SWE-2 attempt.

Chromium1280x720 test devin-native-denial-live.spec.ts PASS13.0seconds (test12.1). Exact turn NQfni7nmLhpw9lwMgmsQZ,15 scoped audit rows. One native read call0d3add51-8bf3-4558-98d0-23de9e88e3b0; no completed update for that read; failed update id h5WhWcZmr6halWshmjmMT has outputPresent=true and permissionMentionedInFailure=true. Zero native_approval is expected for a hard CLI failure, not proof of user rejection. This is provider-result evidence of a failed permission-related read, not captured raw error text or proof of every native tool category.

Test now accepts either a correlated policy-decline callback or a correlated failed native read with actual output mentioning permissions. It rejects prose-only refusal, missing native attempt, ordinary failed status, and completed native read. Exact audit response and call id required in UI; failed native row visible after F5. No writes, terminal requests or command confirmations in this test. No result text/path/credentials added to audit; only boolean diagnostic flags.

| Acceptance | Status | Remaining |
| --- | --- | --- |
| Controlled direct native read negative path | PASS scoped | One package.json attempt on this installed version, not all filesystem tools |
| Native failed outcome visible after F5 | PASS | UI actual observed status, no invented approval reason |
| Provider profiles retained | PASS |19 profiles same SHA256 DF8DD360EF8A6B12FAA2EDBA7E6913D5F8110A4331E45A26BDCE79065D11714B; not full credential inventory |
| Safe diagnostics live | PASS scoped | Actual failure output reported via two booleans only |
| All native categories/toggles | UNVERIFIED | Native write/exec/web and enabled ask/resumed grants transitions remain |
| Complete Devin/ChatGPT closure | OPEN | Do not promote one negative test to broad acceptance |

Screenshots: [result](assets/native-read-result.png), [native failure after F5](assets/native-denial-after-f5.png). Automated assertions passed; no separate visual design audit in this attempt. Preview was stopped by QA restart and restored separately in QA109.
