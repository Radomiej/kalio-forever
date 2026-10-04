# QA262 — approval arguments and workflow admission review

2026-10-04, Europe/Warsaw. Five isolated Chromium cases PASS; full release remains NO-GO.

## Cause and repair

QA257's full-arguments and AC02 arguments cases expected the old initially collapsed preview and `args-expanded`. Current approval UI deliberately expands `Full tool arguments` immediately so the user can inspect content before accepting. The tests now verify initial full visibility, collapse to preview, re-expansion and exact argument values. They do not click Confirm merely to satisfy this review case.

The long-content test verifies F5 hydration, keyboard focus/Control+End, no horizontal overflow, and all 2000 characters at widths 320/390/820. Screens are written to the explicitly supplied QA run; without that variable they stay in Playwright output rather than overwriting historical QA63 assets. Existing AC02 isolated mock initialization changes were included and the entire four-case AC02 file was exercised in this run.

## Verification

System Node, outside sandbox, one worker, existing builds:

`node scripts/run-playwright-with-stack.mjs ac-02-hitl-confirmation.spec.ts regression-full-tool-arguments.spec.ts --project=chromium --workers=1 --reporter=line`

`KALIO_PLAYWRIGHT_SKIP_BUILD=1`, `KALIO_FULL_ARGS_REPORT_RUN=262`; isolated UI/API `51997/51998`, storage `data/playwright-stack/1791120667314-40480/`. Terminal **5 passed (9.4s), exit 0**, 15:31:20. The 320px screenshot was visually inspected: wrapped payload is contained, review buttons visible, approval wait explicit. Expected nonexistent-file reads occur before write approval in negative fixtures; no clean-log claim.

| AC / PIT | Status | Evidence | Remaining |
|---|---|---|---|
| Complete pre-approval arguments / PIT-07 | PASS | Initially expanded region, exact values, collapse/reopen | Fixture, not real Devin call |
| Mobile/tablet, F5 and keyboard / PIT-09 | PASS | 320/390/820, focusable scrolling panel, end marker and no overflow | Physical-device proof not claimed |
| HITL confirm/cancel states / PIT-03 | PASS | All four AC02 cases green | Separate live-provider acceptance |
| Full browser gate / PIT-01 | FAIL / not rerun | QA257 plus focused recoveries | 21 of the original failed cases remain unresolved |

## Workflow review, not a fix claim

The creator sends its selected execution profile through `ChatInterface.Parts` to `useChatLaunchSend`, which persists it before `handleComposerSend`. The latter routes non-single-chat mode through `launchWorkflowPrompt`. Therefore the picker is not merely a local button-unlock flag. This source trace does not prove every architecture role honors that profile; backend role resolution and actual launch still need inspection. No production admission rule was loosened and mock remains excluded from normal UI selection.

## Fixed QA read-only status

After the isolated run, `/api/runtime/devin-cli/status` reported authenticated, catalog ready, one online exact `swe-2` host, epoch `AmLccYWAxQlNJM6XKlrGL`. No reset or new prompt was sent. This is host-status evidence, not successful generation, model pricing or proof of absent OS-wide console spam. Fixed QA providers and Home Site sources were untouched.
