import type { ChatMessage } from '@kalio/types';

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
