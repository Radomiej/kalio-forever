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
 *
 * A single agent cycle spans ALL assistant messages between two user messages
 * (multiple LLM iterations are grouped under one turn). This mirrors the live
 * streaming behaviour where `startAgentTurn` opens one turn and
 * `addTurnItem` appends items from every iteration until `finalizeAgentTurn`.
 *
 * Previous behaviour (one turn per assistant message) caused scrambled rendering:
 * the index-based timeline paired userMsgs[i] with agentTurns[i], so 3 agent
 * turns for 1 user message would pull unrelated user messages out of position.
 */
export function buildTurnsFromHistory(messages: ChatMessage[], sessionId: string): AgentTurn[] {
  const turns: AgentTurn[] = [];
  let turnIndex = 0;
  let currentItems: AgentTurn['items'] = [];
  let firstMsgId: string | null = null;

  const flushTurn = () => {
    if (currentItems.length === 0 || firstMsgId === null) return;
    turns.push({ id: `history-turn-${turnIndex++}-${firstMsgId}`, sessionId, items: currentItems, done: true });
    currentItems = [];
    firstMsgId = null;
  };

  for (const msg of messages) {
    if (msg.role === 'user') {
      // A user message closes the current agent cycle and starts a new one.
      flushTurn();
      continue;
    }
    if (msg.role !== 'assistant') continue;

    if (firstMsgId === null) firstMsgId = msg.id;
    if (msg.thinking) currentItems.push({ kind: 'thinking', messageId: msg.id });
    currentItems.push({ kind: 'text', messageId: msg.id });
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        currentItems.push({ kind: 'tool', callId: tc.id });
      }
    }
  }
  flushTurn(); // flush trailing cycle (last assistant messages with no subsequent user message)

  return turns;
}
