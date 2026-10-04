# QA285 — normal Stop click and F5

Date: 2026-10-04, Europe/Warsaw. Isolated built stack API port 59602. Chromium, one worker. Same fresh backend build as QA284; deterministic local HTTP/SSE provider. No live LLM call, no QA reset, no target project edit.

Three tests passed in 5.2 seconds, exit 0. Workflow Bgf64C1XiK7Udh4C9gx7k, host dfIvKbzu3WbkgsAlJ3914.

Adjacent architecture runtime suite: 96/96 passed in 2.19s. With gateway/session-stop suites, 148 backend tests passed. Screenshot copy verified at 108315 bytes. The REST session-stop service still sequences architecture drain before subagent abort; this sibling requires a separate regression and correction before a comprehensive Stop closure claim.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| STOP-03 | PASS | Normal actionable click, no force; active HTTP stream observed before Stop, zero afterwards; exactly one Stop frame | Live Devin architecture role not exercised |
| STOP-04 | PASS | Explicit cancelled/user_stop assertions; Stop/pending/queue absent, composer enabled; same assertions after reload | Full Talk/Graph follow-up workflow gate not rerun |
| TITLE-01 | PASS | Both adjacent first-reply/title tests passed through local HTTP provider | Not real model quality proof |
| QA-DEPLOY | UNVERIFIED | Fixed 3316/5288 runtime left untouched | Deploy and verify preserved provider configuration later |

Screenshot: stopped-workflow-after-reload.png. Captured after successful F5 assertions. This run removes obsolete mock-script prompt text: request delay belongs exclusively to the local fixture, not production runtime.

See QA284 for cause, source change and command. Verdict: strengthened local browser slice PASS; overall requested Devin/Jev delivery not complete.
