# QA97 — Queue preflight and hydration failure

2026-10-03, fixed QA5288/API3316, HomeSite session W4fggLSunrJB41C24MV7C, exact swe-2 strict profile. Starting HEAD9960705. No prompt was submitted, no target file or tool was executed by this attempt.

[P2] Idle Devin reset PATCH settings{} returned HTTP500: AggregateError Devin ACP reset failed, inner process-tree shutdown did not close within10seconds. Static gate consequently failed one row (host remained). A bounded sample of children of owned API19616 showed preview cmd11752 and devin16152. After status offline and idle session verification, one reset retry succeeded, hostCount0 and subsequent static gate16/16 PASS. Cause of the first timeout is not proven; no claim of a fix and no shared process termination.

Real Playwright queue test then failed before sending its first prompt: Devin CLI · swe-2 chat-header label absent. Snapshot showed the selected New Chat launch screen including the Provider and model combobox, not the existing conversation. Both QA UI and API returned200 later; session still has the correct explicit Devin profile. No screenshot of a queued prompt exists because the test did not reach enqueueing.

| AC | Status | Evidence | Next |
| --- | --- | --- | --- |
| Static configuration | PASS after retry | 16checks | Reset reliability remains P2 |
| Existing-session hydration | FAIL this attempt | Launch screen instead of chat header | Explicitly await Chat message control on next attempt |
| Queue execution | UNVERIFIED | No prompts submitted | Repeat only after actual chat hydration |

Failure screenshot was produced in ignored Playwright test-results, but copying it to the report failed because the destination assets directory did not yet exist. The next run cleared test-results before recovery; no saved screenshot is claimed for QA97. The observed accessibility snapshot and failure are documented above. API current-run later empty. No DB reset, provider change or pricing claim. The next test waits for the actual hydrated chat control, not a fixed sleep; if it remains absent, diagnose product hydration rather than forcing a prompt through the launch screen.
