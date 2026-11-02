# Chat mode locking

## Behavior

- A new, empty chat keeps the runtime selector editable.
- After a chat has messages or turns, its runtime selector is locked and the composer explains that a new chat is needed to choose another mode.
- Restored sessions derive workflow mode from their persisted architecture run projection (`ChatMessage.architectureRun.schemaId`). Sessions without that durable workflow evidence use Single Chat.
- The lock is reconstructed from the session’s hydrated messages and turns; it is not persisted as component-only mode state.

## Interrupted chat resume boundary

The backend exposes current and historical chat run snapshots, including `interrupted_needs_retry`, `safeResume`, and `revision`. It currently has no user-invocable resume endpoint for a normal chat LLM turn. The AgentFlow resume endpoint is a separate workflow contract, and approved-tool continuation is an internal continuation path. The UI therefore keeps the existing recovery guidance and does not offer a generic Resume action or resend the original prompt.

To support an explicit chat Resume action, the backend must expose a session/run/turn/revision-scoped operation that atomically claims only a safe recoverable turn, rejects stale revisions and duplicate claims, resumes from the durable checkpoint without resending the prompt, and returns or emits the updated run snapshot.
