/**
 * Unit tests for chatUtils.ts
 *
 * buildTurnsFromHistory — reconstructs AgentTurns from persisted messages.
 * Key scenario: tool-only assistant messages (empty content + toolCalls array)
 * must produce a visible turn with tool items so RA-App widgets render after
 * session reload.
 */
import { describe, it, expect } from 'vitest';
import { buildConversationTimeline, buildTurnsFromHistory, computeAnsweredCallIds, mergeFetchedMessages } from './chatUtils';
import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';

function makeMsg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-default',
    sessionId: 's1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as ChatMessage;
}

// ─────────────────────────────────────────────────────────────────────────────
// mergeFetchedMessages
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeFetchedMessages', () => {
  it('REGRESSION: preserves an optimistic user prompt when fetched history is stale or empty', () => {
    const currentMessages = [
      makeMsg({ id: 'u-local', role: 'user', content: 'Build a calculator app', createdAt: 10 }),
    ];

    const merged = mergeFetchedMessages(currentMessages, []);

    expect(merged).toEqual(currentMessages);
  });

  it('REGRESSION: keeps local message metadata when the fetched copy lags behind', () => {
    const currentMessages = [
      makeMsg({
        id: 'a1',
        role: 'assistant',
        content: 'Local richer copy',
        thinking: 'thinking locally',
        streaming: true,
        createdAt: 20,
      }),
      makeMsg({ id: 'tr-local', role: 'tool_result', content: '{}', toolCallId: 'call-local', createdAt: 30 }),
    ];

    const loadedMessages = [
      makeMsg({ id: 'a1', role: 'assistant', content: 'Persisted text', createdAt: 20 }),
      makeMsg({ id: 'u1', role: 'user', content: 'Original prompt', createdAt: 10 }),
      makeMsg({ id: 'tr-local', role: 'tool_result', content: '{}', createdAt: 30 }),
    ];

    const merged = mergeFetchedMessages(currentMessages, loadedMessages);
    const mergedAssistant = merged.find((message) => message.id === 'a1');
    const mergedToolResult = merged.find((message) => message.id === 'tr-local');

    expect(merged.map((message) => message.id)).toEqual(['u1', 'a1', 'tr-local']);
    expect(mergedAssistant).toMatchObject({
      content: 'Local richer copy',
      thinking: 'thinking locally',
      streaming: true,
    });
    expect(mergedToolResult).toMatchObject({ toolCallId: 'call-local' });
  });

  it('REGRESSION: merged history can rebuild an anchored turn from a stale server snapshot', () => {
    const currentMessages = [
      makeMsg({ id: 'u-local', role: 'user', content: 'Build a calculator app', createdAt: 10 }),
    ];
    const loadedMessages = [
      makeMsg({ id: 'a1', role: 'assistant', content: 'Done.', createdAt: 20 }),
    ];

    const merged = mergeFetchedMessages(currentMessages, loadedMessages);
    const turns = buildTurnsFromHistory(merged, 's1');

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ promptMessageId: 'u-local' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTurnsFromHistory
// ─────────────────────────────────────────────────────────────────────────────

describe('buildTurnsFromHistory', () => {
  it('returns empty array for empty message list', () => {
    expect(buildTurnsFromHistory([], 's1')).toHaveLength(0);
  });

  it('skips user and tool_result messages', () => {
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'Hello' }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{}', toolCallId: 'call_1' }),
    ];
    expect(buildTurnsFromHistory(msgs, 's1')).toHaveLength(0);
  });

  it('creates one turn per agent cycle (all assistant messages between user messages)', () => {
    // Two assistant messages separated by a user message = 2 separate cycles
    const msgs = [
      makeMsg({ id: 'a1', role: 'assistant', content: 'Hello' }),
      makeMsg({ id: 'u1', role: 'user', content: 'Hi' }),
      makeMsg({ id: 'a2', role: 'assistant', content: 'Bye' }),
    ];
    const turns = buildTurnsFromHistory(msgs, 's1');
    expect(turns).toHaveLength(2);
    expect(turns.every((t) => t.done)).toBe(true);
  });

  it('always adds a text item even for assistant messages with empty content', () => {
    const msgs = [makeMsg({ id: 'a1', role: 'assistant', content: '' })];
    const turns = buildTurnsFromHistory(msgs, 's1');
    expect(turns[0].items.some((i) => i.kind === 'text')).toBe(true);
  });

  it('adds thinking item when assistant message has thinking field', () => {
    const msgs = [makeMsg({ id: 'a1', role: 'assistant', content: 'ok', thinking: 'let me think…' })];
    const turns = buildTurnsFromHistory(msgs, 's1');
    expect(turns[0].items.some((i) => i.kind === 'thinking')).toBe(true);
    expect(turns[0].items.some((i) => i.kind === 'text')).toBe(true);
  });

  it('does NOT add thinking item when thinking field is absent', () => {
    const msgs = [makeMsg({ id: 'a1', role: 'assistant', content: 'answer' })];
    const turns = buildTurnsFromHistory(msgs, 's1');
    expect(turns[0].items.every((i) => i.kind !== 'thinking')).toBe(true);
  });

  // ── REGRESSION: tool-only turns must produce visible items ──────────────────

  it('REGRESSION: tool-only assistant message (empty content + toolCalls) creates turn with tool items', () => {
    // This is the exact scenario that caused the RA-App home-launch bug:
    // The LLM calls list_raapps + run_raapp with zero text output.
    // Before the fix, if buildTurnsFromHistory was given this message it would
    // still produce a turn — but the live turn was being WIPED by setAgentTurns
    // when the session history fetch completed mid-turn.
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A for me' }),
      makeMsg({
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1777561572800_1', name: 'list_raapps', args: {} },
          { id: 'call_1777561575883_2', name: 'run_raapp', args: { id: 'qa-interactive' } },
        ],
      }),
    ];
    const turns = buildTurnsFromHistory(msgs, 'nWYWk2SG2AFCnY0TfYdVk');
    expect(turns).toHaveLength(1);
    expect(turns[0].done).toBe(true);
    expect(turns[0].sessionId).toBe('nWYWk2SG2AFCnY0TfYdVk');

    const toolItems = turns[0].items.filter((i) => i.kind === 'tool');
    expect(toolItems).toHaveLength(2);
    expect(toolItems[0]).toMatchObject({ kind: 'tool', callId: 'call_1777561572800_1' });
    expect(toolItems[1]).toMatchObject({ kind: 'tool', callId: 'call_1777561575883_2' });
  });

  it('turn id is deterministic and unique per turn index', () => {
    // Two assistant messages separated by a user message → 2 separate cycles
    const msgs = [
      makeMsg({ id: 'a1', role: 'assistant', content: 'first' }),
      makeMsg({ id: 'u1', role: 'user', content: 'follow-up' }),
      makeMsg({ id: 'a2', role: 'assistant', content: 'second' }),
    ];
    const turns = buildTurnsFromHistory(msgs, 's1');
    expect(turns[0].id).toMatch(/history-turn-0/);
    expect(turns[1].id).toMatch(/history-turn-1/);
    expect(turns[0].id).not.toBe(turns[1].id);
  });

  it('text item messageId matches the assistant message id', () => {
    const msgs = [makeMsg({ id: 'asst-msg-42', role: 'assistant', content: 'hi' })];
    const turns = buildTurnsFromHistory(msgs, 's1');
    const textItem = turns[0].items.find((i) => i.kind === 'text');
    expect(textItem).toMatchObject({ kind: 'text', messageId: 'asst-msg-42' });
  });

  it('tool items callId matches the LLMToolCall id', () => {
    const msgs = [
      makeMsg({
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc-id-99', name: 'vfs_read', args: { path: '/foo' } }],
      }),
    ];
    const turns = buildTurnsFromHistory(msgs, 's1');
    const toolItem = turns[0].items.find((i) => i.kind === 'tool');
    expect(toolItem).toMatchObject({ kind: 'tool', callId: 'tc-id-99' });
  });

  // ── REGRESSION: multi-iteration grouping ──────────────────────────────────

  it('REGRESSION: consecutive assistant messages (same agent cycle) are grouped into ONE turn', () => {
    // Root cause of the "bubbles go to the top / messages scrambled" bug.
    // An agent cycle with 3 LLM iterations (think+tool, think+tool, think+text)
    // produced 3 separate AgentTurns. The timeline rendered them interleaved with
    // unrelated user messages, scrambling the order.
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A for me' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'list_raapps', args: {} }] }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '[]', toolCallId: 'tc1' }),
      makeMsg({ id: 'a2', role: 'assistant', content: '', toolCalls: [{ id: 'tc2', name: 'run_raapp', args: { id: 'qa' } }] }),
      makeMsg({ id: 'tr2', role: 'tool_result', content: '{}', toolCallId: 'tc2' }),
      makeMsg({ id: 'a3', role: 'assistant', content: 'The app is running.' }),
    ];
    const turns = buildTurnsFromHistory(msgs, 's1');
    // Must be exactly 1 turn — not 3
    expect(turns).toHaveLength(1);
    expect(turns[0].done).toBe(true);
    // All tool items from a1 + a2 are in the single turn
    const toolItems = turns[0].items.filter((i) => i.kind === 'tool');
    expect(toolItems).toHaveLength(2);
    expect(toolItems[0]).toMatchObject({ kind: 'tool', callId: 'tc1' });
    expect(toolItems[1]).toMatchObject({ kind: 'tool', callId: 'tc2' });
    // Text item for final reply (a3) is present
    const textItems = turns[0].items.filter((i) => i.kind === 'text');
    expect(textItems.some((i) => i.messageId === 'a3')).toBe(true);
  });

  it('REGRESSION: multi-cycle conversation produces exactly N turns for N user messages', () => {
    // 3 user messages, each followed by 2 LLM iterations → must produce 3 turns
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'start' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'memory_search', args: {} }] }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{}', toolCallId: 'tc1' }),
      makeMsg({ id: 'a2', role: 'assistant', content: 'Answer 1' }),

      makeMsg({ id: 'u2', role: 'user', content: 'follow-up 1' }),
      makeMsg({ id: 'a3', role: 'assistant', content: '', toolCalls: [{ id: 'tc2', name: 'kv_write', args: {} }] }),
      makeMsg({ id: 'tr2', role: 'tool_result', content: '{}', toolCallId: 'tc2' }),
      makeMsg({ id: 'a4', role: 'assistant', content: 'Answer 2' }),

      makeMsg({ id: 'u3', role: 'user', content: 'follow-up 2' }),
      makeMsg({ id: 'a5', role: 'assistant', content: '', toolCalls: [{ id: 'tc3', name: 'run_raapp', args: {} }] }),
      makeMsg({ id: 'tr3', role: 'tool_result', content: '{}', toolCallId: 'tc3' }),
      makeMsg({ id: 'a6', role: 'assistant', content: 'Answer 3' }),
    ];
    const turns = buildTurnsFromHistory(msgs, 's1');
    // Exactly 3 turns — one per agent cycle, not one per assistant message
    expect(turns).toHaveLength(3);
    // Each turn has one text item for the final reply + one tool item
    expect(turns[0].items.filter((i) => i.kind === 'tool')).toHaveLength(1);
    expect(turns[1].items.filter((i) => i.kind === 'tool')).toHaveLength(1);
    expect(turns[2].items.filter((i) => i.kind === 'tool')).toHaveLength(1);
    expect(turns[0].items.some((i) => i.kind === 'text' && i.messageId === 'a2')).toBe(true);
    expect(turns[1].items.some((i) => i.kind === 'text' && i.messageId === 'a4')).toBe(true);
    expect(turns[2].items.some((i) => i.kind === 'text' && i.messageId === 'a6')).toBe(true);
  });

  it('REGRESSION: items within a grouped turn preserve iteration order (think→tool→think→text)', () => {
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'go' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '', thinking: 'deciding…', toolCalls: [{ id: 'tc1', name: 'memory_search', args: {} }] }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{}', toolCallId: 'tc1' }),
      makeMsg({ id: 'a2', role: 'assistant', content: 'Done', thinking: 'answering…' }),
    ];
    const turns = buildTurnsFromHistory(msgs, 's1');
    expect(turns).toHaveLength(1);
    const kinds = turns[0].items.map((i) => i.kind);
    // Order: thinking(a1), text(a1), tool(tc1), thinking(a2), text(a2)
    expect(kinds).toEqual(['thinking', 'text', 'tool', 'thinking', 'text']);
  });

  it('REGRESSION: a rebuilt agent turn stays anchored to the user prompt that actually started it', () => {
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'first prompt with no answer' }),
      makeMsg({ id: 'u2', role: 'user', content: 'second prompt that got the answer' }),
      makeMsg({ id: 'a1', role: 'assistant', content: 'answer for second prompt' }),
    ];

    const turns = buildTurnsFromHistory(msgs, 's1');

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ promptMessageId: 'u2' });
  });

  it('REGRESSION: timeline rendering keeps a later agent turn under the user prompt that owns it', () => {
    const messages = [
      makeMsg({ id: 'u1', role: 'user', content: 'first prompt with no answer' }),
      makeMsg({ id: 'u2', role: 'user', content: 'second prompt that got the answer' }),
    ];
    const turns: AgentTurn[] = [
      { id: 'turn-2', sessionId: 's1', promptMessageId: 'u2', items: [], done: true },
    ];

    const timeline = buildConversationTimeline(messages, turns).map((entry) =>
      entry.kind === 'user_message' ? `user:${entry.message.id}` : `turn:${entry.turn.id}`,
    );

    expect(timeline).toEqual(['user:u1', 'user:u2', 'turn:turn-2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeAnsweredCallIds (supplemental — main tests live in ChatInterface.test.tsx)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeAnsweredCallIds — edge cases', () => {
  it('empty messages returns empty set', () => {
    expect(computeAnsweredCallIds([])).toEqual(new Set());
  });

  it('tool_result is not answered when it is the last message', () => {
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'go' }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{}', toolCallId: 'call_x' }),
    ];
    expect(computeAnsweredCallIds(msgs).has('call_x')).toBe(false);
  });

  it('multiple user messages count independently', () => {
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'a' }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{}', toolCallId: 'call_a' }),
      makeMsg({ id: 'u2', role: 'user', content: 'b' }),
      makeMsg({ id: 'tr2', role: 'tool_result', content: '{}', toolCallId: 'call_b' }),
    ];
    const answered = computeAnsweredCallIds(msgs);
    // call_a: user u2 follows it → answered
    expect(answered.has('call_a')).toBe(true);
    // call_b: no user follows → not answered
    expect(answered.has('call_b')).toBe(false);
  });
});
