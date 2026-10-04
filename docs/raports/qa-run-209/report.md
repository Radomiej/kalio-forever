# QA209 — chat/graph review and Jev configuration discovery

Date: 2026-10-04. Target: fixed QA UI localhost:5288, API 127.0.0.1:3316. Review only; no live LLM run, reset, provider mutation or deployment in this attempt.

## Evidence

- Focused frontend history/tool-card tests: 5 files, 127 tests PASS, exit 0, 12:45:59, duration 3.13s.
- Entire chat graph test directory: 17 files, 209 tests PASS, exit 0, 12:47:27, duration 4.02s.
- Warnings remain: AgentFlow async updates outside act; architecture hydration fixture logs `projection.chat.messages is not iterable`. Green assertions do not establish a clean hydration path.
- Read-only live `/api/runtime/profiles`: 21 profiles; no named/model Jev entry. Exact Devin swe-2 and Codex gpt-6-luna profiles enabled.
- Read-only `/api/personas`: no match for Jev in name/model/id. This does not inspect every persona override or provider catalog.
- Read-only `/api/architecture-registry/schemas`: 51 schemas, no literal Jev reference in returned schema JSON. Indirect provider/persona resolution remains unverified.
- `/api/llm/config`: provider mock, model mock, source env. Explicit execution profiles are a separate boundary.

## Acceptance and findings

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| CHAT-GRAPH-01 shared state | UNVERIFIED | Execution graph consumes session messages, turns, runtime activities and projections | Same real Devin turn in Talk/Graph before and after F5, approval and Stop |
| CHAT-GRAPH-02 compact tools | Partial | Group payload retains call ids, args, results and statuses | Grouping currently depends on zoom <=0.85; zooming expands individual tool nodes |
| CHAT-GRAPH-03 accessible tool details | Partial | Inspector group shows names/status; raw developer payload includes details | Per-call disclosure without requiring raw payload |
| CHAT-GRAPH-04 architecture component ownership | PASS, source only | ExecutionGraphBoard vs separate ArchitectGraphCanvas | They are not one shared editor; graph runtime projects architecture runs |
| JEV-01 configured runtime | UNVERIFIED | No direct Jev profile/persona/schema reference found | Inspect custom provider models and exact role resolution before choosing model |
| JEV-02 scoped AutoApprove | UNVERIFIED | useArchitectRunOptions defaults both flags false and emits explicit opt-in context | Backend policy and real limited DEV scenario; no global QA auto-approval |

[P2] Zoom-driven expansion contradicts the requested consistently grouped chat graph.

[P2] Grouped tool argument/result discovery requires raw developer data rather than ordinary per-call details.

[P2] Architecture hydration warning must be traced to fixture vs product boundary before claiming chat/graph parity.

No performance benchmark, browser screenshot, live Jev invocation or account pricing verification was performed. No screenshots are attached because this attempt did not operate the browser. Devin/ChatGPT live proof from older reports is not a new run in QA209.
