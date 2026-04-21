import { create } from 'zustand';
import type { ToolMeta, ToolConfirmationRequest, LLMStreamChunk } from '@kalio/types';

interface AgentState {
  isStreaming: boolean;
  streamingMessageId: string | null;
  pendingConfirmation: ToolConfirmationRequest | null;
  availableTools: ToolMeta[];
  setStreaming: (streaming: boolean, messageId?: string) => void;
  setPendingConfirmation: (req: ToolConfirmationRequest | null) => void;
  setAvailableTools: (tools: ToolMeta[]) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  isStreaming: false,
  streamingMessageId: null,
  pendingConfirmation: null,
  availableTools: [],
  setStreaming: (streaming, messageId = null) =>
    set({ isStreaming: streaming, streamingMessageId: messageId }),
  setPendingConfirmation: (req) => set({ pendingConfirmation: req }),
  setAvailableTools: (tools) => set({ availableTools: tools }),
}));
