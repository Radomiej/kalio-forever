# QA160 — real ChatGPT/Codex after QA restart

2026-10-04, fixed QA :5288/:3316. Chromium: 1 passed (11.6s).

Existing conversation yvD83rgDA_ZHvUwJKlo_S, exact gpt-6-luna, local ChatGPT auth profile chatgpt-default. After backend restart the authenticated model-catalog check connected one host and returned seven models. Static readiness passed before live execution.

PASS: two UI-submitted no-tool turns, recovery and warm follow-up, both completed normally and survived F5. Host process epoch stayed unchanged across both turns. Audit asserted two llm.turn.completed entries, zero tool calls and zero process.cmd.invocation entries. No changes to HomeSite were requested.

Evidence: assets/codex-recovery-after-f5.png. This proves the tested communication/reconnect flow, not all tools or external account/model pricing behavior.
