import { useCallback, useLayoutEffect, useRef } from 'react';
import type { ChatMessage } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';

interface UseChatAutoScrollParams {
  activeSessionId: string | null;
  messages: ChatMessage[];
  activeToolActivities: ToolActivity[];
}

export function useChatAutoScroll({
  activeSessionId,
  messages,
  activeToolActivities,
}: UseChatAutoScrollParams) {
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return;
    }

    const list = messageListRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [messages, activeToolActivities]);

  useLayoutEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [activeSessionId]);

  const handleMessageListScroll = useCallback(() => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }

    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 96;
  }, []);

  return {
    messageListRef,
    handleMessageListScroll,
  };
}
