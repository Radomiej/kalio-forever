# QA226 — reviewed launch-source commit boundary

Date: 2026-10-04. Reviewed only launch hook, ChatInterface caller/test and composer actions. Remaining mixed frontend changes are not part of this commit scope.

The launch hook requires an explicit runtime, saves selection before activation/send, fences duplicate clicks, reuses a failed draft only within the same project ID/path and creates a fresh scoped draft after a project change. Composer actions read the current session store at invocation, rather than the render-time session list, so the just-activated session is used. ChatInterface fixture profiles explicitly model the runtime selection rather than pretending no profile exists.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Source/caller review | PASS | Full hook and tests plus caller/composer diffs read before staging. |
| Focused tests | PASS | 2 files, 99 tests, 3.11s, start 13:41:44; system Node outside sandbox. Log `.tmp/qa226-launch-tests.log` ignored. |
| Retry scope regression | PASS locally | Prior QA215 RED for ID/path changes then GREEN; included hook cases rerun. |
| Full frontend/static/build | PASS historical current source | QA216 full suite 1874; QA223 final typecheck/build. No source changes in this run. |
| Real initial launch/project-switch failure-retry | UNVERIFIED | Recent live QA covers existing sessions, not this exact browser failure-retry path. |
| Clean committed release | UNVERIFIED | Other mixed changes remain dirty and contribute to served QA223 artifact. |

Test output includes expected failed-selection logs and existing ChatInterface fixture warnings; no warning-free claim. This commit is source hygiene for a verified local slice, not whole-goal completion. NewChatScreen/ChatInterface.Parts and other lifecycle/provenance changes remain outside this staged set; their ownership and complete gates must be reviewed separately.
