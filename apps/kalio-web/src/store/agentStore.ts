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

export type LlmActivityStatus = 'running' | 'done' | 'error';

export interface LlmActivity {
  id: string;
  label: string;
  status: LlmActivityStatus;
  startedAt: number;
  finishedAt?: number;
}

interface AgentState {
  isStreaming: boolean;
  streamingMessageId: string | undefined;
  pendingConfirmation: ToolConfirmationRequest | null;
  availableTools: ToolMeta[];
  tools: ToolMeta[];
  /** Tool calls active in the current turn, in order */
  toolActivities: ToolActivity[];
  /** Auxiliary LLM sub-calls (title-gen, suggestions, etc.) */
  llmActivities: LlmActivity[];
  /** System prompt sent to LLM for the active session turn */
  systemPrompt: string | null;
  /** Tool names available in the active session turn */
  activeToolNames: string[];
  /**
   * Persistent callId → toolName lookup across ALL turns in the current page session.
   * Populated on tool:start, never cleared. Used by AgentTurnBubble to resolve
   * tool names for history chips when msg.toolCalls is not available in Zustand.
   */
  callIdToName: Record<string, string>;

  setStreaming: (streaming: boolean, messageId?: string) => void;
  setPendingConfirmation: (req: ToolConfirmationRequest | null) => void;
  setAvailableTools: (tools: ToolMeta[]) => void;
  setTools: (tools: ToolMeta[]) => void;
  addToolActivity: (activity: ToolActivity) => void;
  updateToolActivity: (callId: string, patch: Partial<ToolActivity>) => void;
  clearToolActivities: () => void;
  addLlmActivity: (activity: LlmActivity) => void;
  updateLlmActivity: (id: string, patch: Partial<LlmActivity>) => void;
  clearLlmActivities: () => void;
  setContext: (systemPrompt: string, toolNames: string[]) => void;
  registerCallId: (callId: string, toolName: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  isStreaming: false,
  streamingMessageId: undefined,
  pendingConfirmation: null,
  availableTools: [],
  tools: [],
  toolActivities: [],
  llmActivities: [],
  systemPrompt: null,
  activeToolNames: [],
  callIdToName: {},

  setStreaming: (streaming, messageId = undefined) =>
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

  addLlmActivity: (activity) =>
    set((s) => ({ llmActivities: [...s.llmActivities, activity] })),

  updateLlmActivity: (id, patch) =>
    set((s) => ({
      llmActivities: s.llmActivities.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    })),

  clearLlmActivities: () => set({ llmActivities: [] }),

  setContext: (systemPrompt, toolNames) => set({ systemPrompt, activeToolNames: toolNames }),

  registerCallId: (callId, toolName) =>
    set((s) => ({ callIdToName: { ...s.callIdToName, [callId]: toolName } })),
}));
