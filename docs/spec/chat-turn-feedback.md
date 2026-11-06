# Chat turn feedback

Existing conversations do not show a mode selector or a fixed-mode explanatory sentence. Mode is chosen on Home/New Chat and remains immutable for the conversation; hiding the control does not change backend enforcement or introduce a fork.

Context preview refresh keeps the last accepted preview visible with a quiet, accessible activity indicator. It does not repeatedly replace the panel with a yellow refresh message or imply progress percentages. Error and stale-result semantics remain distinct. The existing frontend-only trimming action is not backend context compaction; a durable compaction workflow remains separate work.

The conversation-level live-turn projection owns Pending and Waiting for approval feedback. An assistant turn containing no material text, reasoning, tools, argument progress, error, architecture result or continuation action must not render an additional blank bubble or loading dots. Native audit remains independently available when it has evidence.

Actual streamed text and reasoning are preserved. Tool argument progress, tool results and approvals remain visible rather than being replaced by an empty-state heuristic. A completed or failed turn must not retain Pending because an old message still has a streaming flag.

Starting a background conversation or child turn clears that session's tool activity without clearing argument progress in the visible conversation. The visible conversation's own lifecycle and connection reset still clear its progress.

The conversation timeline attributes a named architecture step to its bound session or node. Legacy router heuristics apply only to generic router steps without a bound session.

Recording a session status publishes the latest status and replay buffer in one store update. Subscribers cannot observe the new status with the previous replay buffer.

Project groups initialize when conversations arrive and expand the active group. Equivalent session updates preserve a manually collapsed inactive group and do not schedule redundant expansion updates during socket replay.

An accepted terminal runtime/session snapshot reconciles chunks whose message ownership binds them to that turn, even when `agent:done` never arrives. Reconciliation preserves the final text/reasoning as history and releases composer activity. A late `agent:done` is idempotent. Stale snapshots cannot release a newer turn, and other sessions/turns or unbound chunks are not discarded to hide an unresolved ownership problem.

Regression checks cover empty item lists and empty streamed text alongside the live-state caller, one Pending card, terminal removal, and preservation of material turn content. Browser acceptance uses a real CLI turn and manual HITL: Pending -> Waiting for approval -> Pending -> final success or failure. Mock/component tests alone do not establish this integration.

On compact Talk layouts, New Chat keeps a single mounted composer with a collapsible conversation settings section. The conversation sidebar restore control lives next to the active chat or graph title. Resizing the viewport and opening settings preserve the current prompt draft.

The Single Chat composer supports PNG, JPEG, WebP and GIF from the file picker or clipboard. Draft images remain local until send, then upload as multipart into the session VFS and travel in `chat:send` as attachment references. Codex sends the current image as an App Server image input. Devin ACP checks its advertised image-input capability before sending image content blocks and reports a refusal when unavailable. Claude Agent SDK and Devin API remain text-only through their current adapters. Direct LLM requests carry the existing multimodal message and the selected provider decides support. Kalio image tools return typed image content through Codex and MCP, plus file metadata. Devin's scoped audit shows reported skill and MCP discovery events separately from Kalio executions.
Sent image attachments are displayed in the durable user bubble through the session-scoped VFS serve route. The Files panel refreshes when attachments are added.
