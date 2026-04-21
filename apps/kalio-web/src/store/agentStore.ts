import { create } from 'zustand';
import type { ToolMeta, ToolConfirmationRequest, ToolResult } from '@kalio/types';

export type ToolActivityStatus = 'awaiting_confirmation' | 'running' | 'success' | 'error' | 'cancelled';

export interface ToolActivity {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: ToolActivityStatus;
  startedAt: number;
  finishedAt?: number;
  result?: ToolResult;
}

interface AgentState {
  isStreaming: boolean;
  streamingMessageId: string | null;
  pendingConfirmation: ToolConfirmationRequest | null;
  availableTools: ToolMeta[];
  tools: ToolMeta[];
  /** Tool calls active in the current turn, in order */
  toolActivities: ToolActivity[];

  setStreaming: (streaming: boolean, messageId?: string) => void;
  setPendingConfirmation: (req: ToolConfirmationRequest | null) => void;
  setAvailableTools: (tools: ToolMeta[]) => void;
  setTools: (tools: ToolMeta[]) => void;
  addToolActivity: (activity: ToolActivity) => void;
  updateToolActivity: (callId: string, patch: Partial<ToolActivity>) => void;
  clearToolActivities: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  isStreaming: false,
  streamingMessageId: null,
  pendingConfirmation: null,
  availableTools: [],
  tools: [],
  toolActivities: [],

  setStreaming: (streaming, messageId = null) =>
    set({ isStreaming: streaming, streamingMessageId: messageId }),
  setPendingConfirmation: (req) => set({ pendingConfirmation: req }),
  setAvailableTools: (tools) => set({ availableTools: tools }),
  setTools: (tools) => set({ tools }),

  addToolActivity: (activity) =>
    set((s) => ({ toolActivities: [...s.toolActivities, activity] })),

  updateToolActivity: (callId, patch) =>
    set((s) => ({
      toolActivities: s.toolActivities.map((a) =>
        a.callId === callId ? { ...a, ...patch } : a,
      ),
    })),

  clearToolActivities: () => set({ toolActivities: [] }),
}));
