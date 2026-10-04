# QA274 — first-prompt and neighboring launch regression

2026-10-04, Europe/Warsaw. **3 passed (4.3s), exit 0**. System Node outside sandbox, isolated Chromium one worker, existing builds, API 51074. Command from apps/e2e: node scripts/run-playwright-with-stack.mjs ac-21-session-title.spec.ts regression-new-chat-profile-launch.spec.ts --project=chromium --workers=1 --reporter=line.

| Area | Status | Evidence | Remaining |
|---|---|---|---|
| AC21 title and F5 | PASS | Two AC21 cases rerun with explicit local HTTP provider | Deterministic fixture, not live LLM |
| Neighbor launch/hydration | PASS | Existing prebound mock launch test rerun | That test intercepts picker/session preparation; not an unmocked integration proof |
| Fixture cleanup | Updated and exercised | Server close in finally even if credential deletion throws | Deletion-failure fault injection not tested |
| Fixed QA/Home Site | Not modified | Disposable runner storage/random ports | No fresh health measurement |
| Full regression | NOT CLOSED | Focused rerun only | 18 original failed cases remain unresolved |

No production code change, redeploy, real agent call or target-project write. This follow-up verifies the final cleanup edits omitted from the QA273 execution snapshot. Screenshots are not newly claimed for this nonvisual cleanup slice; QA273 has the reviewed first-prompt/title artifact.
