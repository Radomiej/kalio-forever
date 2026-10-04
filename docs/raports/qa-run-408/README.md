# QA408 — fresh browser recovery and Devin status

Date: 2026-10-05. Fixed QA: http://localhost:5288/. Real persisted Home Site conversation; no new LLM run, reset, permission change, token action, build or target file edit.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Reload existing QA | PASS (browser) | Reload of tab 6 succeeded. Home Site conversation and QA403_RESULT restored with actual historical Kalio fs_read bubble. | Historical messages are not a new agent execution. |
| Read runtime status after reload | PASS (browser) | Opened Settings → Agent runtimes. Devin shows CLI ready, Logged in, ACP available, 1 model host, 773 discovered models, bridge enabled. All three native-tool switches remain off. | CLI ready is not proof of a new prompt round trip or an actively working model. |
| Preserve evidence | PASS | assets/devin-fresh-status.png; browser warn/error log query returned []. | Console log capture is not native-window monitoring. |
| Short startup consoles | UNVERIFIED | No startup performed in this check. QA407 attribution constraints still apply. | Event-based process and window capture at the actual failing startup. |

This fresh browser check supersedes the uncertainty about whether the previously displayed QA document was merely stale. It does not establish OS PIDs, all API endpoint health, live Devin task completion, or whole-product readiness. QA407 shell process/HTTP observations were permission-limited and must not be treated as proof that the QA stack stopped.
