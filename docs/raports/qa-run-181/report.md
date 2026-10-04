# QA181 — real Devin missing-file recovery, harness failure

2026-10-04. Fixed QA :5288/:3316, existing QA175 frontend/QA167 backend, AppData kalio-forever-qa; exact real swe-2 in W4fggLSunrJB41C24MV7C, approved E:/Projekty/home-site. Pre-test HEAD bb741455 and preserved unrelated dirty files. Chromium 1280x720. Warm read-only static preflight passed.

UI submitted QA181_ERROR_1791106578162. Devin performed two fs_read calls: unique intentionally nonexistent project file, then package.json. Two durable results were saved and final response arrived. Initial Playwright failed because the test expected a spaced `not found`, while actual persisted error is `{status: error, errorCode: TOOL_EXECUTION_FAILED, errorMessage: NOT_FOUND: <approved missing path>}`. This is a harness error, not evidence of an app regression.

Screenshot assets/assertion-failure.png preserved from the failed test (102062 bytes) before another run cleared test-results. Initial run: 1 failed, 5.7s. No full success claim; remaining assertions were not reached. QA182 and QA183 verify this same recorded turn without sending another prompt. No reset, provider change, write, terminal spawn, install or target-project commit.
