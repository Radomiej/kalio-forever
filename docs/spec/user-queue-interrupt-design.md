# User Message Queue & Interrupt — Design Spec

**Status:** Draft, awaiting approval.
**Goal:** Support two UX patterns familiar from Copilot/Cursor/Windsurf:
- **Queue:** user sends a follow-up while the agent is mid-pipeline; it is held and automatically dispatched after the current `agent:done` (one logical pipeline finishes).
- **Interrupt:** user force-injects a new instruction that aborts the current pipeline at the next iteration boundary and starts a new pipeline with the injected message as the next user turn.

Out of scope here: multi-tool parallelism (already partially supported via `state.toolCalls` sequential dispatch). Treated as separate spec when needed.

---

## 1. Behaviour matrix

| State of session | Incoming `chat:send` mode | Action |
|------------------|---------------------------|--------|
| Idle (no active turn) | `interrupt=false` (default) | Run immediately |
| Idle | `interrupt=true` | Run immediately (no-op flag) |
| Active turn in progress | `interrupt=false` | Append to per-session queue. After current `agent:done`, drain head-of-queue and start a new turn. |
| Active turn in progress | `interrupt=true` | Abort current turn at next iteration boundary. Drop any earlier queued items? **No** — keep them. The interrupt message becomes the new head-of-queue. After abort finishes, drain. |

Queue is FIFO and per-session.

---

## 2. Wire contract changes

### 2.1 `@kalio/types` extension

```ts
'chat:send': {
  sessionId: ID;
  content: string;
  personaId: ID;
  attachments?: ChatAttachment[];      // (already planned in image spec)
  interrupt?: boolean;                  // NEW — default false
};

'chat:queued': {                        // NEW — server → client ack
  sessionId: ID;
  queueLength: number;                  // total pending including this one
  position: number;                     // 1-indexed position of this message
};
```

`chat:queued` lets the FE show "queued (2/3)" badges without local state guesswork.

No new event for interrupt — it just causes the existing `chat:error` (with `code: 'INTERRUPTED'`) for the aborted turn followed by a fresh `agent:start` for the new one. The FE already handles both.

### 2.2 No DB schema change

Queued/interrupt messages are persisted as **regular** `role: 'user'` rows with their normal `createdAt` (the moment they were *dispatched*, not the moment they were enqueued). Rationale:

- Keeps history reconstruction trivial: order by `createdAt`.
- Avoids a special role that the LLM would have to be taught about.
- The "queued" / "interrupted" flavour is a UX concern, not a model-context concern. The LLM sees a normal conversation: it produced an answer, the user replied.

If we ever want telemetry on queue depth, add a nullable `meta JSON` column later. Not now.

---

## 3. Backend components

### 3.1 New: `SessionPipelineService` (in `chat/`)

Single per-session FSM in front of `ChatService.handleTurn`. Replaces direct gateway → ChatService coupling.

```ts
@Injectable()
class SessionPipelineService {
  // Per-session state
  private active = new Map<string, { abort: AbortController; donePromise: Promise<void> }>();
  private queues = new Map<string, ChatSendPayload[]>();

  constructor(private readonly chat: ChatService) {}

  async submit(payload: ChatSendPayload, emit: EmitFn): Promise<void> {
    const sid = payload.sessionId;
    const isActive = this.active.has(sid);

    if (payload.interrupt && isActive) {
      this.active.get(sid)!.abort.abort();
      await this.active.get(sid)!.donePromise.catch(() => undefined);
      // fall through to immediate dispatch
    } else if (isActive) {
      const q = this.queues.get(sid) ?? [];
      q.push(payload);
      this.queues.set(sid, q);
      emit('chat:queued', { sessionId: sid, queueLength: q.length, position: q.length });
      return;
    }

    await this.runOne(payload, emit);
    await this.drain(sid, emit);
  }

  private async runOne(payload, emit) { /* delegates to chat.handleTurn, tracks active map */ }
  private async drain(sid, emit) { /* head-of-queue loop until empty */ }
}
```

Key points:
- `active.get(sid).donePromise` resolves *after* `handleTurn` finishes (success or error) and the `active` slot is cleared.
- `drain` only runs after the current turn's `agent:done` has been emitted, guaranteeing the FE never sees overlapping `agent:start`/`agent:done` brackets for the same session.
- Interrupts honour `controller.signal` already wired into `ChatService.handleTurn` — the existing iteration-boundary abort check (`if (controller.signal.aborted) break;`) is the natural break point. **No mid-iteration aborts** to keep the assistant message persistence consistent.

### 3.2 `ChatGateway.handleChatSend` change

```ts
async handleChatSend(client, payload) {
  const emit: EmitFn = (event, data) => client.emit(event, data);
  await this.pipeline.submit(payload, emit);
}
```

Trivial. Pipeline owns lifecycle; gateway just forwards.

### 3.3 `ChatService.handleTurn` signal contract

Already aborts at iteration boundary. One refinement: when aborted, emit `chat:error` with `code: 'INTERRUPTED'` (instead of generic `LLM_ERROR`) and still emit `agent:done`. That lets the FE distinguish a deliberate interrupt from a real failure.

---

## 4. Frontend (minimum)

- Send button stays enabled even while streaming.
- If `isStreaming === true` at submit time, FE sends `chat:send { interrupt: false }`. Display the optimistic user bubble immediately (so it appears even though dispatch is delayed).
- Optional "Stop & rewrite" button next to the streaming bubble: sends `chat:send { interrupt: true }` for the next typed message; otherwise just "Stop" sends a no-op interrupt with empty content (handled BE-side as plain abort + no new turn — see §6).
- Listen for `chat:queued`, surface a small badge "Queued (n)".

---

## 5. Persistence ordering

Within a session, the DB rows after a queue+drain look exactly like a normal conversation:

```
user("first")           t=0
assistant("answer 1")   t=2
tool_result(...)        t=3
assistant("done")       t=5   ← agent:done #1
user("second" queued)   t=5+  ← persisted at dispatch time, not enqueue time
assistant("answer 2")   t=8
...
```

`loadHistory` sorts by `createdAt`, the LLM sees a clean dialogue. Same for an interrupt — the only difference is that `assistant("done")` may be missing if the abort hit before the final iteration; the partially-streamed assistant message that was persisted by `DoneHandler` per iteration still exists, which is correct behaviour (the model can see it tried).

---

## 6. Edge cases

- **Empty interrupt** (`content === ''`, `interrupt: true`): abort current, do not enqueue or start a new turn. Implements a pure "Stop" button.
- **Multiple rapid interrupts**: each one aborts the in-flight + replaces head-of-queue's intent. Implementation: just `submit()` again; the natural locking via `donePromise.await` serialises them.
- **Disconnect mid-pipeline**: when client socket disconnects, gateway calls `pipeline.abortAll(sid)` from `handleDisconnect`. Queued items for that session are dropped (no client to deliver chunks to).
- **Backpressure**: cap queue at 10 per session; reject overflow with `chat:error { code: 'QUEUE_FULL' }`.

---

## 7. Tests (V-Model)

| Layer | Spec | Asserts |
|------|------|---------|
| Unit | `session-pipeline.service.spec.ts` | (a) idle submit → runs immediately. (b) submit during active → enqueues, emits `chat:queued`. (c) drains queue head after `agent:done`. (d) interrupt aborts, starts new turn after current finishes. (e) FIFO order preserved. (f) queue cap enforced. (g) multiple sessions isolated. |
| Integration | `chat.service.event-ordering.spec.ts` (extend) | After abort, `chat:error { code: 'INTERRUPTED' }` precedes `agent:done`. |
| Integration | `pipeline-end-to-end.spec.ts` | Three rapid `submit` calls during one active turn → exactly three sequential `agent:start`..`agent:done` brackets, no overlap, FIFO content order preserved. |

No FE tests required for v1 (UX polish only).

---

## 8. Risks

| Risk | Mitigation |
|------|-----------|
| Race: queue item starts before previous `agent:done` finishes propagating to FE | `runOne` awaits `handleTurn` fully (including the synchronous emit calls). Socket.IO TCP ordering preserves event order. |
| Memory leak from never-drained queues on dead sessions | `handleDisconnect` purges per-session state. Add periodic GC if needed. |
| Interrupt mid-tool-execution leaks resources | Tools currently aren't cancellable. Aborts only fire at iteration boundary, never mid-tool. Document this; future spec to add `AbortSignal` to tool execution if needed. |

---

## 9. Acceptance criteria

- [ ] User types message during streaming → bubble appears, `chat:queued` event received, message dispatches automatically when current pipeline ends.
- [ ] User clicks "Interrupt & resend" with new content → current pipeline aborts within ~1 iteration, new pipeline starts with the new content.
- [ ] Empty interrupt acts as pure Stop.
- [ ] DB history after queue+drain is indistinguishable from a sequential conversation.
- [ ] No overlapping `agent:start`/`agent:done` brackets ever observed in event log.
- [ ] All previous 86 chat tests still pass; new specs from §7 are green.

---

## 10. Comparison to known systems

| System | Queue | Interrupt | Notes |
|-------|-------|-----------|------|
| OpenAI Realtime API | `response.cancel` event | Same | Wire-level only; no client persistence semantics. |
| Vercel AI SDK | Buffered via `useChat.append` | `stop()` then `append()` | Client-side serialisation, no server queue. |
| Cursor / Copilot | Soft queue (observed UX) | "Stop" button + new prompt | Closed-source; behaviour matches our design. |
| LangGraph | Checkpoint replay | `interrupt_before` config | Heavyweight, not aligned with our streaming-first model. |

This spec adopts the OpenAI/Vercel **client-driven cancel** semantics with our own **server-side queue** so the FE can fire-and-forget while we guarantee delivery order.
