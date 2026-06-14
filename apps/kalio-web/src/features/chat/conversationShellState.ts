import type { ChatSession } from '@kalio/types';
import type { LiveTurnState } from './liveTurnState';

export type ConversationShellMode =
  | 'launch-form'
  | 'live-turn'
  | 'timeline'
  | 'pending-child-session';

export interface ConversationShellState {
  mode: ConversationShellMode;
}

interface ResolveConversationShellStateArgs {
  activeSession: ChatSession | null;
  activeSessionId: string | null;
  conversationTimelineLength: number;
  liveTurnState: LiveTurnState;
}

function isChildSession(activeSession: ChatSession | null): activeSession is ChatSession & { parentSessionId: string } {
  return typeof activeSession?.parentSessionId === 'string' && activeSession.parentSessionId.trim().length > 0;
}

export function resolveConversationShellState({
  activeSession,
  activeSessionId,
  conversationTimelineLength,
  liveTurnState,
}: ResolveConversationShellStateArgs): ConversationShellState {
  if (conversationTimelineLength > 0) {
    return { mode: 'timeline' };
  }

  if (isChildSession(activeSession)) {
    return { mode: 'pending-child-session' };
  }

  if (activeSessionId && liveTurnState.phase !== 'idle') {
    return { mode: 'live-turn' };
  }

  return { mode: 'launch-form' };
}
