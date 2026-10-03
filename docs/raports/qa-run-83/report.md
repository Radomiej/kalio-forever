# QA83 — Codex transport versus model availability

Date: 2026-10-03. Fixed user QA: UI localhost:5288, API 127.0.0.1:3316. Checkout baseline 3c4ed26 with existing uncommitted changes; not a clean release artifact.

## Evidence

- Focused API tests: codex-app-server.llm-source, codex-app-server.host, codex-mcp-policy.service: 3 files, 17 tests PASS, system Node, outside sandbox.
- Existing codex-strict profile: gpt-5.4, kalio_strict, chatgpt-default authentication. Inherited external MCP disabled.
- UI Agent runtimes / Codex / Recheck connected the host. This proves transport, not inference authorization.
- Explicit UI New created a test session, increasing chat count from 19 to 20. Selected exact option `Codex · gpt-5.4 Codex Strict`, Default persona, no project.
- Prompt: `Test QA83. Nie używaj narzędzi ani plików. Odpowiedz dokładnie: QA83_CODEX_OK`.
- Actual run showed pending and Stop, then finished with HTTP 400: `The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.` No requested final answer appeared. Stop/pending disappeared after the error.
- Prior attempt on the unselected Talk landing screen cleared the prompt without entering a conversation. Clicking explicit New allowed dispatch; this is a separate launch-flow observation requiring diagnosis.
- No QA reset, provider changes, credentials export, or HomeSite mutations performed in this pass.

## Findings and closure

| Priority | Finding | Impact | Resolution |
| --- | --- | --- | --- |
| P1 | Configured Codex model exposed although rejected for ChatGPT authentication | Real chat cannot answer with this offered choice | OPEN: discover account-compatible models from actual host; verify inference through UI |
| P2 | Landing-screen Run cleared prompt without a selected session | Draft can be lost and dispatch silently absent | OPEN: reproduce and test start-without-selected-session boundary |

Codex communication is NOT closed. Green adapter tests and Online status do not replace actual model proof. Native tools, Kalio tools, HITL, reload hydration, stop and follow-up remain to verify for Codex after resolving model availability.

## Environment policy

DEV is the implementation/resettable test environment. Fixed QA is the user-facing environment for verified deployments and should remain available. Preserve QA provider settings and credentials; notify before a necessary destructive reset and use a recoverable protected restoration path. Do not export secrets as plaintext JSON. Finish Devin first, then ChatGPT/Codex; defer secondary work.
