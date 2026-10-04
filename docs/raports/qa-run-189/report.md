# QA189 — complete frontend regression after turn-runtime audit scoping

2026-10-04. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-test HEAD 297f7c94 plus preserved mixed dirty work. No source edits during execution. Fixed QA localhost:5288/API3316 remains on existing backend QA167/frontend QA188; no reset, deploy, provider mutation or live agent prompt. This is a local full-suite gate, not new browser/provider proof.

Command in apps/kalio-web, outside sandbox with system Node on PATH: node node_modules/vitest/vitest.mjs run --reporter=dot. Exec handle 80334 explicitly returned exit0. Start 11:59:23, duration 34.27s; 214 test files passed, 1869 tests passed. The run includes the new runtime-provider hook and native panel/history regressions.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Complete current frontend regression | PASS | 214 files / 1869 tests, exit0 | Local fixtures do not substitute for real providers |
| Immutable provider projection regressions | PASS within full gate | Hook/panel/history suites included | Live streaming timing separately scoped |
| QA rendered provider parity | Previously PASS, not rerun here | QA188 two read-only browser tests | Current run makes no additional browser claim |
| Warning-free harness | UNVERIFIED | act warnings, ChatInterface mock missing getProjects, expected fixture failures observed | Diagnostic output truncated; not every warning classified |

Read the observed complete getProjects stack: projectStore.loadProjects calls the named API export, missing in ChatInterface.test.tsx's full-module mock, then ProjectPicker logs the rejected load. This is fixture incompleteness, not evidence that the real project endpoint failed. No warning suppression or broad mock cleanup included. Large captured output was truncated by the tool; final aggregate/exit was observed directly, but this report does not claim all diagnostic lines were reviewed.

Screenshots N/A: no new UI action/change in this attempt. Durable screenshots for current QA are in QA188. Full original goal remains active: current success/negative real provider slices are recorded, but full runtime/source closure, settings acceptance and broader console/lifecycle evidence are still incomplete.
