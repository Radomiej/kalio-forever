# QA162 — history audit prevented by stopped QA

2026-10-04. The read-only historical failure audit stopped before navigation: ECONNREFUSED 127.0.0.1:3316. No prompt, fixture or tool was created. This run does not prove UI behavior.

Managed status independently confirmed backend and frontend down (partial/stale state, previous PIDs 50280/40892). The existing backend log ended with the HomeSite preview terminal exit at 10:24:03, code 1073807364. The log does not establish why both QA processes stopped. No crash cause is claimed.

Frontend typecheck and build passed locally; runtime config was restored to authoritative fixed QA origins. Managed QA restart was requested only after confirming both services were down, using the same AppData data root without database reset.
