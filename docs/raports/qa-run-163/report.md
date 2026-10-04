# QA163 — real user-only interrupted history after F5

2026-10-04, rebuilt frontend index-290-Dh3j.js on fixed QA :5288/:3316. Chromium: 1 passed (3.1s).

Read-only evidence from actual failed Devin run QA155: session W4fggLSunrJB41C24MV7C, turn 2KjSTYt3_JEoRRsbNVD9D, prompt YNXYWz8UJdEP7yh3upgIl. Backend history has the user prompt and no assistant for that turn; journal status is interrupted. After F5 the prompt is immediately followed by an agent error bubble showing Interrupted, with no loading indicator or Stop agent button. No model prompt, tool or fixture was created.

Evidence: assets/user-only-error-after-f5.png, visually inspected. Frontend now includes durable user turn IDs in the scoped journal lookup and projects a terminal error without fabricating assistant text. Active/queued/completed/waiting runs do not create phantom terminal bubbles; newest revision wins; session isolation, chronology and existing partial-turn deduplication are tested. Three focused frontend test files: 22 passed. Typecheck and build passed.

Remaining: QA process-lifetime issue observed in QA162 needs a separate cause/proof; latest provider-neutral interruption wording is still source-only. HomeSite preview was stopped with the previous backend and must be restored through approved Kalio tools before claiming it is available again.
