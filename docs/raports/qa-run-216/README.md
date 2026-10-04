# QA216 — frontend gate and fixed-QA deployment

Date: 2026-10-04. Scope: frontend build containing QA215 project-scope retry correction and existing dirty frontend changes. This is not a clean committed release.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Complete frontend tests after QA215 | PASS | 214 files, 1874 tests; start 13:13:31, duration 33.39s, exit 0. Complete ignored log `.tmp/qa216-frontend-vitest.log`. | Fixture warnings do not establish clean live behavior. |
| Frontend build | PASS | Vite 6.4.2, 3118 modules, 4.91s, exit 0. Main asset `index-B6W7ssXN.js`. | Existing minified chunk exceeds 500 kB; no performance claim. |
| QA serves new artifact | PASS | HTTP 200 at `http://localhost:5288/`; HTML references `index-B6W7ssXN.js`. | Browser interaction for retry remains unverified. |
| QA runtime origin | PASS | Served `runtime-config.js` restored after build to API/Socket.IO `http://127.0.0.1:3316`; HTTP 200. | No change to backend routing. |
| Backend availability | PASS | `/api/health` HTTP 200. Outside-sandbox process verification: backend PID 29748 and frontend PID 17424 both Node. | Availability is not real Devin/Codex execution proof. |
| Provider settings preservation | N/A for mutation | No backend restart, database edit, configuration write, or provider mutation performed in this run. | No fresh settings hash audit performed. |
| Real Devin / Codex run | UNVERIFIED | No new request sent. | Complete live acceptance separately. |

The sandbox could not see the two process IDs; outside-sandbox inspection confirmed both alive. That observation was not treated as a stopped stack and did not trigger a restart.

No screenshots were captured: this run verifies tests, build and HTTP artifact identity, not rendered interaction. No source changes or commits were added by this deployment step. Existing mixed work remains preserved.
