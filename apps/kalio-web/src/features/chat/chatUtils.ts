import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';

/**
 * Returns a Set of toolCallIds for which a user message appears AFTER
 * the corresponding tool_result — i.e., the user already submitted an answer.
 */
export function computeAnsweredCallIds(messages: ChatMessage[]): Set<string> {
  const answered = new Set<string>();
  let hasUserAfter = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      hasUserAfter = true;
    } else if (msg.role === 'tool_result' && msg.toolCallId && hasUserAfter) {
      answered.add(msg.toolCallId);
    }
  }
  return answered;
}

/**
 * Reconstructs a list of AgentTurns from persisted messages.
 * Each assistant message becomes a completed turn with a synthetic ID.
 * Tool calls within an assistant message are appended as tool items.
 */
export function buildTurnsFromHistory(messages: ChatMessage[], sessionId: string): AgentTurn[] {
  const turns: AgentTurn[] = [];
  let turnIndex = 0;

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const turnId = `history-turn-${turnIndex++}-${msg.id}`;
    const items: AgentTurn['items'] = [];

    if (msg.thinking) {
      items.push({ kind: 'thinking', messageId: msg.id });
    }
    items.push({ kind: 'text', messageId: msg.id });

    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        items.push({ kind: 'tool', callId: tc.id });
      }
    }

    turns.push({ id: turnId, sessionId, items, done: true });
  }

  return turns;
}
