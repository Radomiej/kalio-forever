# QA204 — current New Chat breakpoint and draft proof

2026-10-04, fixed QA backend e53b3377/frontend QA188, source HEAD7a276e87 with preserved remaining UI changes. Actual Chromium interaction; no LLM prompt submitted. Test created owned empty draft7blUsJGt4Z4X5UEQ7I5a5 and finally deleted only that draft after verifying empty messages, no current run and no children. Other sessions/providers/project files untouched.

| Acceptance / pitfall | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Desktop simultaneous configuration and prompt | PASS | 1440/1024 visible persona/model/prompt, Next/Back hidden;1440 screenshot visually inspected | Keyboard/text enlargement not tested here |
| Compact wizard below1024 | PASS | 1023/820/390/320 exclusive setup/prompt views, Back/Next retain draft;390 screenshot visually inspected | Physical mobile browser not proved |
| Selected SWE-2 and draft survive viewport transition | PASS | Exact Devin label/value retained, final return1024 retains draft, only one session created | New live launch not executed |
| PIT-09/PIT-24 responsive geometry | PASS for document width | scrollWidth<=innerWidth at all six widths | Individual child-bound/focus checks not included |
| SWE-2 cost information visible | PASS as UI rendering | Existing conditional Pro-or-higher/October16 note asserted | Not independent current pricing/account eligibility verification |

Playwright qa-launch-breakpoint-draft.spec.ts explicit opt-in/report204:1passed2.6s,exit0. Six screenshots saved in assets/launch-WIDTH.png;1440 and390 visually reviewed. No code edits in this run. Reviewed launch hook and caller diffs for subsequent coherent source closure; not staged yet.

[P3] Desktop screenshot shows Recheck Codex models while Devin is selected. This may represent a Codex-only catalog action rather than a wrong request, but its placement/label is confusing. Inspect action ownership before changing behavior; no claim it refreshes Devin. Goal remains active.
