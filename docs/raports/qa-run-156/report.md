# QA156 — responsive draft retained

2026-10-04, fixed QA :5288, rebuilt frontend. Playwright Chromium: 1 passed (3.1s).

Desktop 1440/1024 shows the combined persona/model/prompt surface. Crossing the compact boundary retains the selected Devin SWE-2 and draft instead of hiding the creator behind the conversation list. The compact wizard controls are tested. No model run was submitted. Exactly one owned empty draft (4pfou5DkKi3YlQXPy7HEM) was created and cleaned by the test.

Screenshots are in assets/. This proves the tested viewport transition, not every responsive or accessibility state.
