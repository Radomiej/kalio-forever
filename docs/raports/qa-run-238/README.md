# QA238 — live-turn selector ownership closure

2026-10-04. Reviewed complete dirty diff of liveTurnState.ts and its tests. Selector now distinguishes awaiting_confirmation from running_tool and suppresses placeholder content when actual assistant thinking/text chunks are materialized.

Focused verification: liveTurnState.test.ts and ChatInterface.Parts.test.tsx, 32 PASS / 2 files, 1.41s at 14:16:00; no fixture warnings in this run. Earlier QA237 broader suite remains 128 PASS with documented fixture warnings.

The status consumer in ChatInterface.Parts.tsx already renders waiting-for-approval text without loading dots in the current worktree/served frontend. Its dirty diff also includes independent draft-retention behavior. It is deliberately not blanket-staged in the selector-only commit. That component ownership/commit and full active-thinking browser proof remain open.

Boundary: focused source/tests and repository hygiene, not new live provider execution, deployment receipt, every runtime surface or whole-product completion. Real approval/F5 evidence from QA225/229/235 remains scenario-specific.
