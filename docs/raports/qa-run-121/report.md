# QA121 — Mock launch fixture rejected as intended

2026-10-04. Isolated random-port stack web50655/API50656, per-run storage data/playwright-stack/1791080466728-56068, no QA database/provider changes. API build679files/TSC0issues and FE3116modules/build5.58s; existing chunk warning. No real model or target project access.

Initial new-chat mock fixture exposed only its own mock profile under a nonmock picker label, then attempted normal profile PATCH. Test failed29.1s awaiting answer; browser displayed409. Source sessions.service.ts rejects selected direct-llm/mock before changing an empty user session. This is intended policy, not a demonstrated product bug. No assistant response expected. Do not weaken that guard to make a live-readiness fixture green.

Failure screenshot copied by absolute path and verified57827bytes before the next run cleared test-results: [failure](assets/launch-failed.png). Test setup corrected in QA122 by prebinding only the disposable test session at creation, as established mock fixtures do. This does not prove production profile reassignment.
