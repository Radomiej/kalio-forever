# QA110 — Native exec denied; timestamp reconstruction defect

2026-10-04. HEAD eaa4144 plus preserved dirty changes. Same fixed QA UI5288/API3316/AppData DB, no stack restart or DB reset. Idle Devin host reset succeeded; static16-check preflight PASS. Real UI exact swe-2 prompt requested one native exec in E:/Projekty/home-site, only node -e to print QA110_NATIVE_EXEC_MARKER. No native terminal enable, writes, installs, web or Kalio fallback authorized.

Test FAIL14.0seconds at UI status assertion, after native negative assertions passed. Exact turn uxcZ4DTu4jXXoz1nUKpok,15 audit rows, native call040e25c5-4022-42cb-8feb-adb5b7d14f4b. Failed event5K2REHEloao_03PPBex0Q and execute metadata event ndIuC4-RtM7bMsIU-Tev3 share createdAt1791078298886. Failed output flags outputPresent=true/permissionMentionedInFailure=true; no completed exec, no native approval. Final agent prose quotes a project-local deny-rule message; that quotation is supporting prose, not independently retained raw output.

[P2] UI incorrectly showed running: metadata/terminal events were sorted by random id for timestamp ties, discarding failure before metadata and overriding approved-path completion too. Native exec negative proof passed its audit assertions, but end-to-end acceptance remains FAIL until visible status is repaired.

Screenshot [result before panel](assets/native-execute-result.png) saved. Failure-panel screenshot was not preserved: Copy-Item used repo-relative paths from apps/e2e cwd, failed, and the next run cleared test-results. Do not treat the missing screenshot as evidence. Exact failure output and timestamp audit establish the defect; QA111 captures the corrected panel. Added an AGENTS rule requiring absolute verified artifact copies before another test run.
