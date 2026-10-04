# QA275 — HITL preparation failure reproduced

2026-10-04, Europe/Warsaw. Two isolated Chromium tests failed, terminal exit 1. API 62565, disposable Playwright storage, system Node outside sandbox, one worker, existing builds. Fixed user QA untouched.

Both manual confirmation and restart cases timed out before a tool was invoked: welcome-run-prompt disabled in a newly created session without execution profile. The restart action was not reached. Therefore neither failure proves a HITL/runtime recovery defect. Screenshots, error contexts and local ignored traces preserved in failures/<case>, absolute copies byte-length verified before rerun.

Correction in QA276 initializes an existing mock conversation explicitly bound to its test profile and designer persona; no production picker/mock policy is weakened. These tests concern tool confirmation/recovery, not the first-prompt creator contract covered separately by QA273–274.
