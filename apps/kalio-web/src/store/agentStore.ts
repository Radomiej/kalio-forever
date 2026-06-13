import { create } from 'zustand';
import type { AgentBudgetApprovalRequest, AgentRunContext, SocketEvents, ToolMeta, ToolConfirmationRequest, ToolResult } from '@kalio/types';
import type { CLIChildProjection } from '../features/chat/cliChildProjection.model';

export type ToolActivityStatus = 'awaiting_confirmation' | 'running' | 'success' | 'error' | 'cancelled' | 'expired';

export interface ToolActivity {
  callId: string;
  requestId?: string;
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

export type CanvasFocusTarget =
  | { kind: 'architecture-branch'; sessionId: string; label?: string }
  | { kind: 'architecture-run'; runId: string; eventId?: string; nodeId?: string }
  | null;

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
  pendingBudgetApprovals: Record<string, AgentBudgetApprovalRequest>;
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
  canvasFocus: CanvasFocusTarget;
  /**
   * All agent loops currently active on the BE, keyed by sessionId.
   * Populated by agent:start / agent:done events across ALL sessions.
   */
  activeAgentLoops: Record<string, { sessionId: string; turnId: string; startedAt: number; agentRun?: AgentRunContext }>;
  /** Progress of the LLM writing tool call arguments — null when no tool is being written */
  toolArgProgress: { toolName: string; totalChars: number; charsPerSec: number } | null;

  setStreaming: (streaming: boolean, messageId?: string) => void;
  setPendingConfirmation: (sessionId: string, req: ToolConfirmationRequest | null) => void;
  setPendingBudgetApproval: (sessionId: string, req: AgentBudgetApprovalRequest | null) => void;
  setAvailableTools: (tools: ToolMeta[]) => void;
  setTools: (tools: ToolMeta[]) => void;
  getToolActivitiesForSession: (sessionId: string | null) => ToolActivity[];
  addToolActivity: (activity: ToolActivity) => void;
  updateToolActivity: (callId: string, patch: Partial<ToolActivity>) => void;
  clearToolActivities: (sessionId?: string) => void;
  clearInactiveActivities: () => void;
  addLlmActivity: (activity: LlmActivity) => void;
  updateLlmActivity: (id: string, patch: Partial<LlmActivity>) => void;
  clearLlmActivities: () => void;
  getContextForSession: (sessionId: string | null) => { systemPrompt: string | null; activeToolNames: string[] };
  setContext: (systemPrompt: string, toolNames: string[], sessionId?: string) => void;
  registerCallId: (callId: string, toolName: string) => void;
  setCanvasOpen: (open: boolean) => void;
  setCanvasFocus: (focus: CanvasFocusTarget) => void;
  toggleCanvas: () => void;
  addActiveAgentLoop: (sessionId: string, turnId: string, agentRun?: AgentRunContext) => void;
  removeActiveAgentLoop: (sessionId: string, agentRun?: AgentRunContext) => void;
  hasActiveLoopForSession: (sessionId: string | null) => boolean;
  setToolArgProgress: (progress: { toolName: string; totalChars: number; charsPerSec: number } | null) => void;
  /** Accumulated CLI agent output per callId (populated by cli_agent:progress) */
  cliAgentOutput: Record<string, string>;
  appendCLIAgentChunk: (callId: string, chunk: string) => void;
  clearCLIAgentOutput: (callId: string) => void;
  /** Live CLI child session projections keyed by childSessionId */
  cliChildProjections: Record<string, CLIChildProjection>;
  upsertCLIChildProjection: (projection: CLIChildProjection) => void;
  updateCLIChildProjection: (childSessionId: string, patch: Partial<CLIChildProjection>) => void;
  rebuildCLIChildProjections: (parentSessionId: string, projections: CLIChildProjection[]) => void;
  clearCLIChildProjectionsForParent: (parentSessionId: string) => void;
  /** Pending chat queue depth per session (from chat:queued) */
  queuedDepthBySession: Record<string, number>;
  setQueuedDepth: (sessionId: string, depth: number) => void;
  /** Last backend runtime status replayed per session, including descendants after reconnect */
  sessionStatusSnapshots: Record<string, SocketEvents['session:status']>;
  setSessionStatusSnapshot: (snapshot: SocketEvents['session:status']) => void;
  clearSessionStatusSnapshot: (sessionId: string) => void;
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
  pendingBudgetApprovals: {},
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
  canvasFocus: null,
  activeAgentLoops: {},
  cliAgentOutput: {},
  cliChildProjections: {},
  queuedDepthBySession: {},
  sessionStatusSnapshots: {},
  toolArgProgress: null,

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
  setPendingBudgetApproval: (sessionId, req) =>
    set((s) => {
      if (!sessionId.trim()) {
        return s;
      }

      if (req === null) {
        const next = { ...s.pendingBudgetApprovals };
        delete next[sessionId];
        return { pendingBudgetApprovals: next };
      }
      return { pendingBudgetApprovals: { ...s.pendingBudgetApprovals, [sessionId]: req } };
    }),
  setAvailableTools: (tools) => set({ availableTools: tools }),
  setTools: (tools) => set({ tools }),
  getToolActivitiesForSession: (sessionId) => {
    if (!sessionId) return [];
    return get().sessionToolActivities[sessionId] ?? [];
  },

  addToolActivity: (activity) =>
    set((s) => {
      const durableCliTools = new Set([
        'spawn_cli_agent',
        'message_cli_agent',
        'get_cli_agent_status',
        'stop_cli_agent',
      ]);
      // If the same callId already exists (e.g. added by onToolConfirmation before tool:start fires),
      // replace it instead of appending — prevents duplicate React keys.
      // Auto-open the Canvas when a CLI agent starts so streaming is immediately visible.
      const shouldOpenCanvas = activity.toolName === 'run_cli_agent'
        || durableCliTools.has(activity.toolName)
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
        return { toolActivities: [], sessionToolActivities: {}, toolArgProgress: null };
      }

      const nextSessionToolActivities = { ...s.sessionToolActivities };
      delete nextSessionToolActivities[sessionId];
      return {
        toolActivities: s.toolActivities.filter((activity) => activity.sessionId !== sessionId),
        sessionToolActivities: nextSessionToolActivities,
        toolArgProgress: null,
      };
    }),

  clearInactiveActivities: () =>
    set((s) => {
      const isActiveTool = (activity: ToolActivity) =>
        activity.status === 'running' || activity.status === 'awaiting_confirmation';
      const nextToolActivities = s.toolActivities.filter(isActiveTool);
      const nextSessionToolActivities = Object.fromEntries(
        Object.entries(s.sessionToolActivities)
          .map(([sessionId, activities]) => [sessionId, activities.filter(isActiveTool)] as const)
          .filter(([, activities]) => activities.length > 0),
      );

      return {
        toolActivities: nextToolActivities,
        sessionToolActivities: nextSessionToolActivities,
        llmActivities: s.llmActivities.filter((activity) => activity.status === 'running'),
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
  setCanvasFocus: (focus) => set((s) => ({ canvasFocus: focus, canvasOpen: focus ? true : s.canvasOpen })),
  toggleCanvas: () => set((s) => ({ canvasOpen: !s.canvasOpen })),

  addActiveAgentLoop: (sessionId, turnId, agentRun) =>
    set((s) => {
      const isActiveTool = (activity: ToolActivity) =>
        activity.status === 'running' || activity.status === 'awaiting_confirmation';
      const nextToolActivities = s.toolActivities.filter(isActiveTool);
      const nextSessionToolActivities = Object.fromEntries(
        Object.entries(s.sessionToolActivities)
          .map(([key, activities]) => [key, activities.filter(isActiveTool)] as const)
          .filter(([, activities]) => activities.length > 0),
      );

      return {
        toolActivities: nextToolActivities,
        sessionToolActivities: nextSessionToolActivities,
        llmActivities: s.llmActivities.filter((activity) => activity.status === 'running'),
        activeAgentLoops: {
          ...s.activeAgentLoops,
          [agentRun?.agentRunId ?? sessionId]: { sessionId, turnId, startedAt: Date.now(), agentRun },
        },
      };
    }),

  removeActiveAgentLoop: (sessionId, agentRun) =>
    set((s) => {
      const nextActiveAgentLoops = { ...s.activeAgentLoops };
      delete nextActiveAgentLoops[agentRun?.agentRunId ?? sessionId];
      return { activeAgentLoops: nextActiveAgentLoops };
    }),

  hasActiveLoopForSession: (sessionId) => {
    if (!sessionId) return false;
    return Object.values(get().activeAgentLoops).some((loop) => loop.sessionId === sessionId);
  },

  setToolArgProgress: (progress) => set({ toolArgProgress: progress }),

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
      const nextCliAgentOutput = { ...s.cliAgentOutput };
      delete nextCliAgentOutput[callId];
      return { cliAgentOutput: nextCliAgentOutput };
    }),

  upsertCLIChildProjection: (projection) =>
    set((s) => ({
      cliChildProjections: {
        ...s.cliChildProjections,
        [projection.childSessionId]: {
          ...s.cliChildProjections[projection.childSessionId],
          ...projection,
        },
      },
    })),

  updateCLIChildProjection: (childSessionId, patch) =>
    set((s) => {
      const current = s.cliChildProjections[childSessionId];
      if (!current) return s;
      return {
        cliChildProjections: {
          ...s.cliChildProjections,
          [childSessionId]: { ...current, ...patch },
        },
      };
    }),

  rebuildCLIChildProjections: (parentSessionId, projections) =>
    set((s) => {
      const next = { ...s.cliChildProjections };
      for (const key of Object.keys(next)) {
        if (next[key]?.parentSessionId === parentSessionId) {
          delete next[key];
        }
      }
      for (const projection of projections) {
        next[projection.childSessionId] = projection;
      }
      return { cliChildProjections: next };
    }),

  clearCLIChildProjectionsForParent: (parentSessionId) =>
    set((s) => {
      const next = { ...s.cliChildProjections };
      for (const [key, projection] of Object.entries(next)) {
        if (projection.parentSessionId === parentSessionId) {
          delete next[key];
        }
      }
      return { cliChildProjections: next };
    }),

  setQueuedDepth: (sessionId, depth) =>
    set((s) => ({
      queuedDepthBySession: {
        ...s.queuedDepthBySession,
        [sessionId]: depth,
      },
    })),

  setSessionStatusSnapshot: (snapshot) =>
    set((s) => {
      if (!snapshot.sessionId.trim()) {
        return s;
      }
      return {
        sessionStatusSnapshots: {
          ...s.sessionStatusSnapshots,
          [snapshot.sessionId]: snapshot,
        },
      };
    }),

  clearSessionStatusSnapshot: (sessionId) =>
    set((s) => {
      const next = { ...s.sessionStatusSnapshots };
      delete next[sessionId];
      return { sessionStatusSnapshots: next };
    }),
}));
