/**
 * Unit tests for chatUtils.ts
 *
 * buildTurnsFromHistory — reconstructs AgentTurns from persisted messages.
 * Key scenario: tool-only assistant messages (empty content + toolCalls array)
 * must produce a visible turn with tool items so RA-App widgets render after
 * session reload.
 */
import { describe, it, expect } from 'vitest';
import { buildTurnsFromHistory, computeAnsweredCallIds } from './chatUtils';
import type { ChatMessage } from '@kalio/types';

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

  it('creates one turn per assistant message', () => {
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
    const msgs = [
      makeMsg({ id: 'a1', role: 'assistant', content: 'first' }),
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
