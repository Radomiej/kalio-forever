# QA122 — Mock launch/hydration gate with prebound fixture

2026-10-04. Same source build, isolated web56386/API56387 and fresh per-run storage; no fixed QA mutation or live model. Mock fixture profile is prebound in intercepted session creation, backend identity/execution remain direct-llm/mock. Picker GET exposes this fixture only under a nonmock label; production excludes mock. These two harness changes are explicit test setup, not implementation or real-Codex proof.

Chromium test PASS2.4s(test1.6s), runnerexit0 and isolated children stopped. UI Run activates the newly created session, persisted session profile matches fixture, actual mock assistant response exists, exact turn-scoped audit has one llm.turn.completed, Stop gone. F5 renders saved response and no stale responding indicator. No tool/HITL coverage in this test. Initial fixture refusal documentedQA121; no passing screenshot captured.

Restored/verified dist runtime-config API/ws3316 after isolated build. Final fixed UI5288/API3316health/HomeSite57868 HTTP200. Mock gate is supporting evidence only: account/model admission, actual Codex chat launch/profile assignment and tools/HITL still require real UI tests; do not claim all live prerequisites are closed solely from this fixture.
