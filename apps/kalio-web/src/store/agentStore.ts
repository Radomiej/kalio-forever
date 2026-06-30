import { create } from 'zustand';
import type {
  AgentBudgetApprovalRequest,
  AgentRunContext,
  RuntimeToolActivity,
  SocketEvents,
  ToolBudgetProgress,
  ToolMeta,
  ToolConfirmationRequest,
  ToolResult,
} from '@kalio/types';
import type { CLIChildProjection } from '../features/chat/cliChildProjection.model';
import type { ToolActivityStatus } from './agentRuntimeTypes';
import { areSessionStatusSnapshotsEquivalent } from './sessionStatusSnapshot';
import {
  patchRuntimeChildExecution,
  patchRuntimeToolActivitiesByCallId,
  mergeSessionToolActivities,
  runtimeChildExecutionFromCliProjection,
  runtimeChildExecutionFromSubagentLoop,
  runtimeSnapshotHasActiveSessionRuntime,
  updateRuntimeSnapshot,
  upsertRuntimeChildExecution,
} from './agentRuntimeStore.helpers';
import {
  applyCliProjectionUpsert,
  applyPendingBudgetApprovalRemoval,
  applyPendingBudgetApprovalUpsert,
  applyPendingConfirmationRemoval,
  applyPendingConfirmationUpsert,
  applyRecordedSessionStatusSnapshot,
  applyRuntimeActivitySnapshotSync,
} from './agentRuntimeStore.mutators';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export type { ToolActivityStatus } from './agentRuntimeTypes';

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
  streamingSessionId: string | null;
  /** Pending tool confirmations keyed by sessionId */
  pendingConfirmations: Record<string, ToolConfirmationRequest[]>;
  pendingBudgetApprovals: Record<string, AgentBudgetApprovalRequest[]>;
  settledConfirmationRequestIds: Record<string, true>;
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

  setStreaming: (streaming: boolean, messageId?: string, sessionId?: string | null) => void;
  setPendingConfirmation: (sessionId: string, req: ToolConfirmationRequest | null) => void;
  setPendingBudgetApproval: (sessionId: string, req: AgentBudgetApprovalRequest | null) => void;
  setToolBudgetProgress: (progress: ToolBudgetProgress) => void;
  clearToolBudgetProgress: (sessionId: string) => void;
  removePendingConfirmation: (sessionId: string, requestId: string) => void;
  removePendingBudgetApproval: (sessionId: string, requestId: string) => void;
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
  /** Rebuildable backend runtime projection keyed by sessionId */
  runtimeActivitySnapshots: Record<string, SocketEvents['session:runtime_snapshot']>;
  getRuntimeActivitySnapshot: (sessionId: string | null) => SocketEvents['session:runtime_snapshot'] | null;
  /** Ordered status snapshots received before the session view is ready to replay them */
  bufferedSessionStatusSnapshots: Record<string, SocketEvents['session:status'][]>;
  setSessionStatusSnapshot: (snapshot: SocketEvents['session:status']) => void;
  setRuntimeActivitySnapshot: (snapshot: SocketEvents['session:runtime_snapshot']) => void;
  recordSessionStatusSnapshot: (snapshot: SocketEvents['session:status']) => void;
  consumeBufferedSessionStatusSnapshots: (sessionId: string) => SocketEvents['session:status'][];
  clearBufferedSessionStatusSnapshots: (sessionId: string) => void;
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

function upsertRuntimeToolActivity(
  list: RuntimeToolActivity[],
  activity: RuntimeToolActivity,
): RuntimeToolActivity[] {
  if (!activity.callId.trim()) {
    return [...list, activity];
  }

  return list.some((item) => item.callId === activity.callId)
    ? list.map((item) => (item.callId === activity.callId ? { ...item, ...activity } : item))
    : [...list, activity];
}

function toolActivityStatusFromRuntimeStatus(status: RuntimeToolActivity['status']): ToolActivityStatus {
  if (status === 'pending_confirmation') {
    return 'awaiting_confirmation';
  }
  return status;
}

function runtimeStatusFromToolActivityStatus(status: ToolActivityStatus): RuntimeToolActivity['status'] {
  if (status === 'awaiting_confirmation') {
    return 'pending_confirmation';
  }
  if (status === 'expired') {
    return 'cancelled';
  }
  return status;
}

function toolActivityFromRuntime(activity: RuntimeToolActivity): ToolActivity {
  return {
    callId: activity.callId,
    requestId: activity.requestId,
    toolName: activity.toolName,
    args: activity.args,
    sessionId: activity.sessionId,
    status: toolActivityStatusFromRuntimeStatus(activity.status),
    startedAt: activity.startedAt ?? 0,
    finishedAt: activity.finishedAt,
    result: activity.result,
  };
}

function toolActivityToRuntime(activity: ToolActivity): RuntimeToolActivity {
  return {
    callId: activity.callId,
    requestId: activity.requestId,
    sessionId: activity.sessionId ?? '',
    toolName: activity.toolName,
    args: activity.args,
    status: runtimeStatusFromToolActivityStatus(activity.status),
    startedAt: activity.startedAt,
    finishedAt: activity.finishedAt,
    result: activity.result,
  };
}

export const useAgentStore = create<AgentState>()((set, get): AgentState => ({
  isStreaming: false,
  streamingMessageId: undefined,
  streamingSessionId: null,
  pendingConfirmations: {},
  pendingBudgetApprovals: {},
  settledConfirmationRequestIds: {},
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
  runtimeActivitySnapshots: {},
  bufferedSessionStatusSnapshots: {},
  toolArgProgress: null,

  setStreaming: (streaming, messageId = undefined, sessionId = null) =>
    set((state) => {
      if (streaming) {
        return {
          isStreaming: true,
          streamingMessageId: messageId,
          streamingSessionId: sessionId,
        };
      }

      if (sessionId && state.streamingSessionId && state.streamingSessionId !== sessionId) {
        return state;
      }

      return {
        isStreaming: false,
        streamingMessageId: undefined,
        streamingSessionId: null,
      };
    }),
  setPendingConfirmation: (sessionId, req) =>
    set((s) => applyPendingConfirmationUpsert(s, sessionId, req)),
  setPendingBudgetApproval: (sessionId, req) =>
    set((s) => applyPendingBudgetApprovalUpsert(s, sessionId, req)),
  setToolBudgetProgress: (progress) =>
    set((s) => ({
      runtimeActivitySnapshots: updateRuntimeSnapshot(
        s.runtimeActivitySnapshots,
        progress.sessionId,
        (snapshot) => ({
          ...snapshot,
          active: progress.status !== 'waiting',
          turnId: progress.turnId ?? snapshot.turnId,
          toolBudgetProgress: progress,
          updatedAt: progress.updatedAt,
        }),
        { createIfMissing: true },
      ),
    })),
  clearToolBudgetProgress: (sessionId) =>
    set((s) => ({
      runtimeActivitySnapshots: updateRuntimeSnapshot(
        s.runtimeActivitySnapshots,
        sessionId,
        (snapshot) => {
          const next = { ...snapshot, updatedAt: Date.now() };
          delete next.toolBudgetProgress;
          return next;
        },
        { createIfMissing: false },
      ),
    })),
  removePendingConfirmation: (sessionId, requestId) =>
    set((s) => applyPendingConfirmationRemoval(s, sessionId, requestId)),
  removePendingBudgetApproval: (sessionId, requestId) =>
    set((s) => applyPendingBudgetApprovalRemoval(s, sessionId, requestId)),
  setAvailableTools: (tools) => set({ availableTools: tools }),
  setTools: (tools) => set({ tools }),
  getToolActivitiesForSession: (sessionId) => {
    if (!sessionId) return [];
    return mergeSessionToolActivities(
      get().sessionToolActivities[sessionId] ?? [],
      get().runtimeActivitySnapshots[sessionId],
      toolActivityFromRuntime,
    );
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
      const nextRuntimeActivitySnapshots = activity.sessionId
        ? updateRuntimeSnapshot(
            s.runtimeActivitySnapshots,
            activity.sessionId,
            (snapshot) => ({
              ...snapshot,
              toolActivities: upsertRuntimeToolActivity(snapshot.toolActivities, toolActivityToRuntime(activity)),
              updatedAt: Date.now(),
            }),
          )
        : s.runtimeActivitySnapshots;

      return {
        ...autoOpen,
        toolActivities: nextToolActivities,
        sessionToolActivities: nextSessionToolActivities,
        runtimeActivitySnapshots: nextRuntimeActivitySnapshots,
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
      runtimeActivitySnapshots: patchRuntimeToolActivitiesByCallId(
        s.runtimeActivitySnapshots,
        callId,
        {
          ...(patch.status ? { status: runtimeStatusFromToolActivityStatus(patch.status) } : {}),
          ...(patch.toolName ? { toolName: patch.toolName } : {}),
          ...(patch.args ? { args: patch.args } : {}),
          ...(patch.sessionId ? { sessionId: patch.sessionId } : {}),
          ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
          ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
          ...(patch.result !== undefined ? { result: patch.result } : {}),
        },
      ),
    })),

  clearToolActivities: (sessionId) =>
    set((s) => {
      if (!sessionId) {
        return {
          toolActivities: [],
          sessionToolActivities: {},
          toolArgProgress: null,
          runtimeActivitySnapshots: Object.fromEntries(
            Object.entries(s.runtimeActivitySnapshots).map(([key, snapshot]) => [
              key,
              { ...snapshot, toolActivities: [], updatedAt: Date.now() },
            ]),
          ),
        };
      }

      const nextSessionToolActivities = { ...s.sessionToolActivities };
      delete nextSessionToolActivities[sessionId];
      return {
        toolActivities: s.toolActivities.filter((activity) => activity.sessionId !== sessionId),
        sessionToolActivities: nextSessionToolActivities,
        toolArgProgress: null,
        runtimeActivitySnapshots: updateRuntimeSnapshot(
          s.runtimeActivitySnapshots,
          sessionId,
          (snapshot) => ({
            ...snapshot,
            toolActivities: [],
            updatedAt: Date.now(),
          }),
          { createIfMissing: false },
        ),
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
        runtimeActivitySnapshots: Object.fromEntries(
          Object.entries(s.runtimeActivitySnapshots).map(([sessionId, snapshot]) => [
            sessionId,
            {
              ...snapshot,
              toolActivities: snapshot.toolActivities.filter(
                (activity) => activity.status === 'running' || activity.status === 'pending_confirmation',
              ),
              updatedAt: Date.now(),
            },
          ]),
        ),
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
        runtimeActivitySnapshots: (() => {
          const now = Date.now();
          const nextSnapshots = updateRuntimeSnapshot(
            s.runtimeActivitySnapshots,
            sessionId,
            (snapshot) => ({
              ...snapshot,
              active: true,
              turnId,
              queueLength: 0,
              run: snapshot.run?.status === 'active'
                ? {
                    ...snapshot.run,
                    turnId,
                    updatedAt: now,
                    lastHeartbeatAt: now,
                  }
                : undefined,
              updatedAt: now,
            }),
          );
          const parentExecution = runtimeChildExecutionFromSubagentLoop(sessionId, agentRun, now);
          if (!parentExecution) {
            return nextSnapshots;
          }
          return updateRuntimeSnapshot(
            nextSnapshots,
            parentExecution.parentSessionId,
            (snapshot) => ({
              ...snapshot,
              childExecutions: upsertRuntimeChildExecution(snapshot.childExecutions, parentExecution),
              updatedAt: now,
            }),
          );
        })(),
      };
    }),

  removeActiveAgentLoop: (sessionId, agentRun) =>
    set((s) => {
      const removedLoop = Object.entries(s.activeAgentLoops).find(([key, loop]) => {
        if (agentRun?.agentRunId && key === agentRun.agentRunId) {
          return true;
        }
        if (key === sessionId) {
          return true;
        }
        return loop.sessionId === sessionId;
      })?.[1];
      const nextActiveAgentLoops = Object.fromEntries(
        Object.entries(s.activeAgentLoops).filter(([key, loop]) => {
          if (agentRun?.agentRunId && key === agentRun.agentRunId) {
            return false;
          }
          if (key === sessionId) {
            return false;
          }
          return loop.sessionId !== sessionId;
        }),
      );
      return {
        activeAgentLoops: nextActiveAgentLoops,
        runtimeActivitySnapshots: (() => {
          const now = Date.now();
          const nextSnapshots = updateRuntimeSnapshot(
            s.runtimeActivitySnapshots,
            sessionId,
            (snapshot) => ({
              ...snapshot,
              active: false,
              run: snapshot.run?.status === 'active' ? undefined : snapshot.run,
              updatedAt: now,
            }),
            { createIfMissing: false },
          );

          if (
            removedLoop?.agentRun?.agentType !== 'subagent'
            || !removedLoop.agentRun.parentSessionId
          ) {
            return nextSnapshots;
          }

          return updateRuntimeSnapshot(
            nextSnapshots,
            removedLoop.agentRun.parentSessionId,
            (snapshot) => ({
              ...snapshot,
              childExecutions: patchRuntimeChildExecution(
                snapshot.childExecutions,
                (execution) => (
                  execution.kind === 'subagent'
                  && execution.childSessionId === sessionId
                ),
                {
                  status: 'completed',
                  updatedAt: now,
                },
              ),
              updatedAt: now,
            }),
            { createIfMissing: false },
          );
        })(),
      };
    }),

  hasActiveLoopForSession: (sessionId) => {
    if (!sessionId) return false;
    if (Object.values(get().activeAgentLoops).some((loop) => loop.sessionId === sessionId)) {
      return true;
    }
    return runtimeSnapshotHasActiveSessionRuntime(get().runtimeActivitySnapshots[sessionId]);
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
    set((s) => applyCliProjectionUpsert(s, projection)),

  updateCLIChildProjection: (childSessionId, patch) =>
    set((s) => {
      const current = s.cliChildProjections[childSessionId];
      if (!current) return s;
      const now = Date.now();
      const mergedProjection = { ...current, ...patch };
      return {
        cliChildProjections: {
          ...s.cliChildProjections,
          [childSessionId]: mergedProjection,
        },
        runtimeActivitySnapshots: updateRuntimeSnapshot(
          s.runtimeActivitySnapshots,
          mergedProjection.parentSessionId,
          (snapshot) => ({
            ...snapshot,
            childExecutions: upsertRuntimeChildExecution(
              snapshot.childExecutions,
              runtimeChildExecutionFromCliProjection(mergedProjection, now),
            ),
            updatedAt: now,
          }),
        ),
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
      runtimeActivitySnapshots: updateRuntimeSnapshot(
        s.runtimeActivitySnapshots,
        sessionId,
        (snapshot) => ({
          ...snapshot,
          queueLength: depth,
          updatedAt: Date.now(),
        }),
      ),
    })),

  getRuntimeActivitySnapshot: (sessionId) => {
    if (!sessionId) {
      return null;
    }
    return get().runtimeActivitySnapshots[sessionId] ?? null;
  },

  setSessionStatusSnapshot: (snapshot) =>
    set((s) => {
      if (!isNonEmptyString(snapshot.sessionId)) {
        return s;
      }
      if (areSessionStatusSnapshotsEquivalent(s.sessionStatusSnapshots[snapshot.sessionId], snapshot)) {
        return s;
      }
      return {
        sessionStatusSnapshots: {
          ...s.sessionStatusSnapshots,
          [snapshot.sessionId]: snapshot,
        },
      };
    }),

  setRuntimeActivitySnapshot: (snapshot) =>
    set((s) => {
      if (!isNonEmptyString(snapshot.sessionId)) {
        return s;
      }
      return applyRuntimeActivitySnapshotSync(s, snapshot, toolActivityFromRuntime);
    }),

  recordSessionStatusSnapshot: (snapshot) => {
    if (!isNonEmptyString(snapshot.sessionId)) {
      return;
    }

    get().setSessionStatusSnapshot(snapshot);
    set((s) => {
      return applyRecordedSessionStatusSnapshot(s, snapshot);
    });
  },

  consumeBufferedSessionStatusSnapshots: (sessionId) => {
    if (!isNonEmptyString(sessionId)) {
      return [];
    }

    const buffered = get().bufferedSessionStatusSnapshots[sessionId] ?? [];
    if (buffered.length === 0) {
      return [];
    }

    set((s) => {
      const next = { ...s.bufferedSessionStatusSnapshots };
      delete next[sessionId];
      return { bufferedSessionStatusSnapshots: next };
    });

    return buffered;
  },

  clearBufferedSessionStatusSnapshots: (sessionId) =>
    set((s) => {
      const next = { ...s.bufferedSessionStatusSnapshots };
      delete next[sessionId];
      return { bufferedSessionStatusSnapshots: next };
    }),

  clearSessionStatusSnapshot: (sessionId) =>
    set((s) => {
      const next = { ...s.sessionStatusSnapshots };
      delete next[sessionId];
      return { sessionStatusSnapshots: next };
    }),
}));
