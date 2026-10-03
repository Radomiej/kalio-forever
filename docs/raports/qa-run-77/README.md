# QA run 77 — live new-chat wizard

Date: 2026-10-03. Runtime: fixed QA UI http://localhost:5288/, API http://127.0.0.1:3316/. Source baseline: 6b27cb7 plus existing working changes. Browser: Codex in-app browser, separate agent-created tab. No Run submission, token change, reset, or HomeSite write.

| AC / PIT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Fixed QA availability / PIT-29 | PASS | UI and /api/llm/config returned HTTP 200 | Global config remains mock/env; this does not identify an explicitly selected conversation runtime |
| Sequential mobile wizard / PIT-09 | PASS | 390x844: New hides conversation list; configuration step has no prompt, Next shows prompt and Back without configuration controls | Durable screenshots and 320px boundary still required |
| Persona independent from model / PIT-26 | PASS | Persona Default remained selected while exact Devin CLI · swe-2 was selected | Persona recommendation/manual override interaction not tested |
| Pricing disclosure / PIT-26 | PASS (UI only) | Selection displays free on Pro or higher through October 16, 2026 and pricing link | Billing entitlement and current vendor pricing not verified in this run |
| Back/Next preservation / PIT-37 | PASS | Selected swe-2 survives Back; exact unsent QA77 draft survives Next | F5 draft persistence not tested |
| Tablet sequential prompt / PIT-09 | PASS | 820x1180 shows step 2, Back, prompt and Run; no configuration/list alongside | Tablet first-step and overflow geometry still required |
| Header consistency / PIT-03 | FAIL [P2] | Header reads Local LLM after selecting Devin CLI · swe-2; context counter ~18k/32k also remains in empty new-chat screen | Investigate ownership of new-chat header and stale context before changing code |

This is an accessibility-state observation, not screenshot, inference, or no-CMD-spam proof. No model request was sent. Reset was unnecessary because both QA endpoints were reachable. Whole requested workflow remains open.

## QA78 correction

Source inspection shows useContextUsage estimates the base system prompt and full tool catalog even with no messages. The ~18k counter is therefore not evidence of leaked previous-chat history. New also creates an empty persisted session (the next browser observation showed 19 chats instead of 18); no Run/model request was sent. The runtime-label mismatch remains a confirmed independent defect, corrected and live-verified in QA78.
