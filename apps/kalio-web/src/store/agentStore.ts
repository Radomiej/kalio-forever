import { create } from 'zustand';
import type { AgentRunContext, ToolMeta, ToolConfirmationRequest, ToolResult } from '@kalio/types';

export type ToolActivityStatus = 'awaiting_confirmation' | 'running' | 'success' | 'error' | 'cancelled';

export interface ToolActivity {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  sessionId?: string;
  agentRun?: AgentRunContext;
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
  /** Pending tool confirmations keyed by sessionId — one per session at most */
  pendingConfirmations: Record<string, ToolConfirmationRequest>;
  availableTools: ToolMeta[];
  tools: ToolMeta[];
  /** Tool calls active in the current turn, in order */
  toolActivities: ToolActivity[];
  sessionToolActivities: Record<string, ToolActivity[]>;
  /** Auxiliary LLM sub-calls (title-gen, suggestions, etc.) */
  llmActivities: LlmActivity[];
  /** System prompt sent to LLM for the active session turn */
  systemPrompt: string | null;
  /** Tool names available in the active session turn */
  activeToolNames: string[];
  sessionContexts: Record<string, { systemPrompt: string | null; activeToolNames: string[] }>;
  /**
   * Persistent callId → toolName lookup across ALL turns in the current page session.
   * Populated on tool:start, never cleared. Used by AgentTurnBubble to resolve
   * tool names for history chips when msg.toolCalls is not available in Zustand.
   */
  callIdToName: Record<string, string>;
  /** Canvas panel open state — true when the canvas is visible */
  canvasOpen: boolean;
  /**
   * All agent loops currently active on the BE, keyed by sessionId.
   * Populated by agent:start / agent:done events across ALL sessions.
   */
  activeAgentLoops: Record<string, { sessionId: string; turnId: string; startedAt: number; agentRun?: AgentRunContext }>;

  setStreaming: (streaming: boolean, messageId?: string) => void;
  setPendingConfirmation: (sessionId: string, req: ToolConfirmationRequest | null) => void;
  setAvailableTools: (tools: ToolMeta[]) => void;
  setTools: (tools: ToolMeta[]) => void;
  getToolActivitiesForSession: (sessionId: string | null) => ToolActivity[];
  addToolActivity: (activity: ToolActivity) => void;
  updateToolActivity: (callId: string, patch: Partial<ToolActivity>) => void;
  clearToolActivities: (sessionId?: string) => void;
  addLlmActivity: (activity: LlmActivity) => void;
  updateLlmActivity: (id: string, patch: Partial<LlmActivity>) => void;
  clearLlmActivities: () => void;
  getContextForSession: (sessionId: string | null) => { systemPrompt: string | null; activeToolNames: string[] };
  setContext: (systemPrompt: string, toolNames: string[], sessionId?: string) => void;
  registerCallId: (callId: string, toolName: string) => void;
  setCanvasOpen: (open: boolean) => void;
  toggleCanvas: () => void;
  addActiveAgentLoop: (sessionId: string, turnId: string, agentRun?: AgentRunContext) => void;
  removeActiveAgentLoop: (sessionId: string, agentRun?: AgentRunContext) => void;
  hasActiveLoopForSession: (sessionId: string | null) => boolean;
  /** Accumulated CLI agent output per callId (populated by cli_agent:progress) */
  cliAgentOutput: Record<string, string>;
  appendCLIAgentChunk: (callId: string, chunk: string) => void;
  clearCLIAgentOutput: (callId: string) => void;
}

function upsertActivity(list: ToolActivity[], activity: ToolActivity): ToolActivity[] {
  if (!activity.callId.trim()) {
    return [...list, activity];
  }

  return list.some((item) => item.callId === activity.callId)
    ? list.map((item) => (item.callId === activity.callId ? { ...item, ...activity } : item))
    : [...list, activity];
}

export const useAgentStore = create<AgentState>()((set, get): AgentState => ({
  isStreaming: false,
  streamingMessageId: undefined,
  pendingConfirmations: {},
  availableTools: [],
  tools: [],
  toolActivities: [],
  sessionToolActivities: {},
  llmActivities: [],
  systemPrompt: null,
  activeToolNames: [],
  sessionContexts: {},
  callIdToName: {},
  canvasOpen: false,
  activeAgentLoops: {},
  cliAgentOutput: {},

  setStreaming: (streaming, messageId = undefined) =>
    set({ isStreaming: streaming, streamingMessageId: messageId }),
  setPendingConfirmation: (sessionId, req) =>
    set((s) => {
      if (!sessionId.trim()) {
        return s;
      }

      if (req === null) {
        const next = { ...s.pendingConfirmations };
        delete next[sessionId];
        return { pendingConfirmations: next };
      }
      return { pendingConfirmations: { ...s.pendingConfirmations, [sessionId]: req } };
    }),
  setAvailableTools: (tools) => set({ availableTools: tools }),
  setTools: (tools) => set({ tools }),
  getToolActivitiesForSession: (sessionId) => {
    if (!sessionId) return [];
    return get().sessionToolActivities[sessionId] ?? [];
  },

  addToolActivity: (activity) =>
    set((s) => {
      // If the same callId already exists (e.g. added by onToolConfirmation before tool:start fires),
      // replace it instead of appending — prevents duplicate React keys.
      // Auto-open the Canvas when a CLI agent starts so streaming is immediately visible.
      const shouldOpenCanvas = activity.toolName === 'run_cli_agent'
        || activity.toolName === 'run_subagent'
        || activity.agentRun?.agentType === 'subagent';
      const autoOpen = shouldOpenCanvas ? { canvasOpen: true } : {};
      const nextToolActivities = upsertActivity(s.toolActivities, activity);
      const nextSessionToolActivities = activity.sessionId
        ? {
            ...s.sessionToolActivities,
            [activity.sessionId]: upsertActivity(s.sessionToolActivities[activity.sessionId] ?? [], activity),
          }
        : s.sessionToolActivities;

      return {
        ...autoOpen,
        toolActivities: nextToolActivities,
        sessionToolActivities: nextSessionToolActivities,
      };
    }),

  updateToolActivity: (callId, patch) =>
    set((s) => ({
      toolActivities: s.toolActivities.map((activity) =>
        activity.callId === callId ? { ...activity, ...patch } : activity,
      ),
      sessionToolActivities: Object.fromEntries(
        Object.entries(s.sessionToolActivities).map(([sessionId, activities]) => [
          sessionId,
          activities.map((activity) => (activity.callId === callId ? { ...activity, ...patch } : activity)),
        ]),
      ),
    })),

  clearToolActivities: (sessionId) =>
    set((s) => {
      if (!sessionId) {
        return { toolActivities: [], sessionToolActivities: {} };
      }

      const { [sessionId]: _removed, ...rest } = s.sessionToolActivities;
      return {
        toolActivities: s.toolActivities.filter((activity) => activity.sessionId !== sessionId),
        sessionToolActivities: rest,
      };
    }),

  addLlmActivity: (activity) =>
    set((s) => ({ llmActivities: [...s.llmActivities, activity] })),

  updateLlmActivity: (id, patch) =>
    set((s) => ({
      llmActivities: s.llmActivities.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    })),

  clearLlmActivities: () => set({ llmActivities: [] }),

  getContextForSession: (sessionId) => {
    if (!sessionId) {
      const state = get();
      return { systemPrompt: state.systemPrompt, activeToolNames: state.activeToolNames };
    }

    return get().sessionContexts[sessionId] ?? { systemPrompt: null, activeToolNames: [] };
  },

  setContext: (systemPrompt, toolNames, sessionId) =>
    set((s) => ({
      systemPrompt,
      activeToolNames: toolNames,
      sessionContexts: sessionId
        ? {
            ...s.sessionContexts,
            [sessionId]: { systemPrompt, activeToolNames: toolNames },
          }
        : s.sessionContexts,
    })),

  registerCallId: (callId, toolName) =>
    set((s) => {
      if (!callId.trim()) {
        return s;
      }
      return { callIdToName: { ...s.callIdToName, [callId]: toolName } };
    }),

  setCanvasOpen: (open) => set({ canvasOpen: open }),
  toggleCanvas: () => set((s) => ({ canvasOpen: !s.canvasOpen })),

  addActiveAgentLoop: (sessionId, turnId, agentRun) =>
    set((s) => ({
      activeAgentLoops: {
        ...s.activeAgentLoops,
        [agentRun?.agentRunId ?? sessionId]: { sessionId, turnId, startedAt: Date.now(), agentRun },
      },
    })),

  removeActiveAgentLoop: (sessionId, agentRun) =>
    set((s) => {
      const { [agentRun?.agentRunId ?? sessionId]: _removed, ...rest } = s.activeAgentLoops;
      return { activeAgentLoops: rest };
    }),
  hasActiveLoopForSession: (sessionId) => {
    if (!sessionId) return false;
    return Object.values(get().activeAgentLoops).some((loop) => loop.sessionId === sessionId);
  },
  appendCLIAgentChunk: (callId, chunk) =>
    set((s) => {
      if (!callId.trim()) {
        return s;
      }
      return {
        cliAgentOutput: {
          ...s.cliAgentOutput,
          [callId]: (s.cliAgentOutput[callId] ?? '') + chunk,
        },
      };
    }),

  clearCLIAgentOutput: (callId) =>
    set((s) => {
      const { [callId]: _removed, ...rest } = s.cliAgentOutput;
      return { cliAgentOutput: rest };
    }),
}));
