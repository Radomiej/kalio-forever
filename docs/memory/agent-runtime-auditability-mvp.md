# Agent Runtime Auditability MVP

Date: 2026-06-04

Decision:
- Keep `ArchitectureRuntime` as the MVP execution engine.
- Treat `AgentFlowRuntime` as the parent-visible audit/projection layer for `run_sub_agentflow`, snapshots, lifecycle, and manual QA.
- Do not introduce a new `runtime_missing` run status. Represent stale/lost runtime as `run.status=blocked` plus `flow:runtime_missing`, `lifecycle=runtime_missing`, and `data.reasonCode=runtime_missing`.

Audit Contract:
- `SubAgentFlowResult` should carry `parentSessionId`, `parentToolCallId`, `childSessionId`, `openChatSessionId`, and `openGraphRunId` when emitted through runtime/tool boundaries.
- `AgentFlowTraceItem.type` remains the compatibility event string.
- `AgentFlowTraceItem.lifecycle` is the canonical audit lifecycle label for manual QA and future automated checks.
- Synthetic terminal/stale events should include `data.reasonCode`.

Manual QA Checklist:
- Start from Kalio FE parent chat.
- For normal user workflow QA, select the workflow from Talk; the Architect graph editor is only a preset/dev surface.
- Trigger `run_sub_agentflow`.
- Confirm parent result has parent/child/open graph lineage.
- Open child AgentFlow graph from parent history/tool bubble.
- Confirm waiting flow shows `waiting_on_orchestrator` plus waiting/return event.
- Resume and confirm `flow:resume_input`.
- For stale/lost runtime, confirm blocked status plus `runtime_missing` event/reason.
- Before paid/live XiaomiMiMo runs, require `agentflow:paid-readiness` to pass the runtime-shaped completion smoke; a model-list pass alone is not enough.
- XiaomiMiMo `451 Unavailable For Legal Reasons` is a provider access blocker, not runtime success/failure evidence for implementation quality.
- Synthetic completion smoke can pass while a full ArchitectureRuntime orchestrator request still fails; paid readiness must also block on fresh parent-chat Architecture provider-failure projections.
- For `Goal Master Delivery Loop`, the orchestrator slot should use `agent-orchestrator`; the root Architecture session may still show `default`, so manual QA must inspect slot session personas too.
- Subagent LLM audit rows should record both effective runtime provider/model/source and requested persona model; this exposes model drift before persona-level model routing is implemented.
- Persona model routing is now request-scoped for subagent LLM calls: high-level seeded roles use `mimo-v2.5-pro`, execution/research/design/QA roles use `mimo-v2.5`, and bootstrap fills only empty stored seeded models.
