# QA270 — saved real Devin single-tool graph parity

2026-10-04, Europe/Warsaw. **1 passed (3.4s), exit 0**. Chromium 1440x1000, fixed QA localhost:5288 / API 127.0.0.1:3316/api, existing real SWE-2 session. Read-only; no prompt, approval, provider mutation or project change.

Corrected QA269's invalid grouping expectation: one call uses `tool:<callId>`; multi-call groups are separate. Call ID was obtained from the bounded audit of QA268, not guessed. Test opens Tool details and Show raw, verifies exact E:/Projekty/home-site/package.json arguments and nexora-home-site result before and after F5. Saved chat shows the same result and one tool-origin badge. Entire session message snapshot is unchanged after inspection.

| Area | Status | Evidence | Remaining |
|---|---|---|---|
| Single-tool chat/graph parity | PASS | Exact saved call, path and result; F5 | No live graph-streaming assertion |
| Read-only boundary | PASS | Before/after messages identical; no Send action | UI view preference may persist |
| Visual evidence | Captured | assets/devin-read-graph-after-f5.png | Raw inspector is diagnostic, not polished tool summary |
| Multi-tool grouping | UNVERIFIED this run | Not exercised | Separate saved build group test required |
| Overall release | NOT CLOSED | Wider QA requirements remain | No full regression rerun |

No application code change or redeploy. Shell wrapper now explicitly propagates Playwright exit status. QA269 remains failed historical evidence; QA270 is its corrected test rerun.
