import { useEffect, useRef, useState } from 'react';
import type {
  AgentFlowRunSnapshot,
  AgentFlowRunStatus,
  ArchitectureGraphProjection,
  ChatMessage,
  RuntimeChildExecution,
  SubAgentFlowResult,
} from '@kalio/types';
import type { AgentTurn } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { projectSubAgentFlowArchitectureResult } from '../architectureAgentFlowProjection';

const AGENT_FLOW_POLL_MS = 2_000;
const FLOW_LABELS: Record<string, string> = {
  goal_guard_delivery_loop: 'Goal Master Delivery Loop',
};

function agentFlowLabel(flowDefinitionId: string): string {
  return FLOW_LABELS[flowDefinitionId]
    ?? flowDefinitionId
      .replace(/[-_]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join(' ');
}

function isActiveAgentFlowStatus(status: AgentFlowRunStatus): boolean {
  return status === 'queued' || status === 'running';
}

function isProjectableAgentFlowStatus(status: AgentFlowRunStatus): boolean {
  return status === 'done'
    || status === 'failed'
    || status === 'blocked'
    || status === 'cancelled'
    || status === 'waiting_on_orchestrator';
}

function runtimeStatusFromAgentFlow(status: AgentFlowRunStatus): RuntimeChildExecution['status'] {
  if (status === 'done') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'waiting_on_orchestrator') return 'waiting';
  if (status === 'running') return 'running';
  return 'idle';
}

export function agentFlowRuntimeStatusLabel(status: RuntimeChildExecution['status']): string {
  if (status === 'completed') return 'completed';
  if (status === 'waiting') return 'waiting_on_orchestrator';
  if (status === 'stopped') return 'cancelled';
  return status;
}

export function agentFlowRuntimeLabel(execution: RuntimeChildExecution, fallback?: string): string {
  const trimmed = execution.label?.trim();
  if (trimmed) return trimmed;
  return fallback?.trim() || 'Sub AgentFlow';
}

function subAgentFlowResultFromSnapshot(snapshot: AgentFlowRunSnapshot): SubAgentFlowResult {
  if (snapshot.result) {
    return {
      ...snapshot.result,
      flowDefinitionId: snapshot.result.flowDefinitionId ?? snapshot.run.flowDefinitionId,
      returnToOrchestratorCount: snapshot.result.returnToOrchestratorCount
        ?? snapshot.run.returnToOrchestratorCount,
      openChatSessionId: snapshot.result.openChatSessionId ?? snapshot.run.openChatSessionId,
      openGraphRunId: snapshot.result.openGraphRunId ?? snapshot.run.openGraphRunId,
    };
  }

  return {
    flowRunId: snapshot.run.id,
    flowDefinitionId: snapshot.run.flowDefinitionId,
    parentSessionId: snapshot.run.parentSessionId,
    parentToolCallId: snapshot.run.parentToolCallId,
    childSessionId: snapshot.run.childSessionId,
    status: snapshot.run.status,
    summary: snapshot.run.summary ?? `AgentFlow ${snapshot.run.flowDefinitionId} is ${snapshot.run.status}.`,
    decisions: [],
    nextActions: [],
    artifacts: [],
    returnToOrchestratorCount: snapshot.run.returnToOrchestratorCount,
    tracePreview: snapshot.events,
    openChatSessionId: snapshot.run.openChatSessionId,
    openGraphRunId: snapshot.run.openGraphRunId,
  };
}

export function runtimeChildExecutionFromAgentFlowSnapshot(snapshot: AgentFlowRunSnapshot): RuntimeChildExecution {
  const childSessionId = snapshot.run.openChatSessionId ?? snapshot.run.childSessionId;
  const graphRunId = snapshot.run.openGraphRunId ?? snapshot.run.id;
  return {
    id: snapshot.run.id,
    kind: 'agent_flow',
    parentSessionId: snapshot.run.parentSessionId,
    childSessionId,
    parentToolCallId: snapshot.run.parentToolCallId,
    flowRunId: graphRunId,
    label: agentFlowLabel(snapshot.run.flowDefinitionId),
    status: runtimeStatusFromAgentFlow(snapshot.run.status),
    lastOutput: snapshot.result?.summary ?? snapshot.run.summary,
    updatedAt: snapshot.run.updatedAt,
  };
}

export function mergeRuntimeChildExecutions(
  primary: RuntimeChildExecution[],
  overrides: RuntimeChildExecution[],
): RuntimeChildExecution[] {
  const merged = new Map<string, RuntimeChildExecution>();
  const keyFor = (execution: RuntimeChildExecution) => (
    execution.parentToolCallId
      ? `${execution.kind}:call:${execution.parentToolCallId}`
      : execution.flowRunId
        ? `${execution.kind}:flow:${execution.flowRunId}`
        : `${execution.kind}:session:${execution.childSessionId}`
  );

  primary.forEach((execution) => merged.set(keyFor(execution), execution));
  overrides.forEach((execution) => merged.set(keyFor(execution), execution));
  return [...merged.values()];
}

export function useParentAgentFlowChildExecutions({
  parentSessionId,
  getSessionMessages,
  getSessionAgentTurns,
  getSessionActiveTurnId,
  setMessages,
  setAgentTurns,
}: {
  parentSessionId: string | null;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  getSessionAgentTurns: (sessionId: string) => AgentTurn[];
  getSessionActiveTurnId: (sessionId: string) => string | null;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
}): RuntimeChildExecution[] {
  const [childExecutions, setChildExecutions] = useState<RuntimeChildExecution[]>([]);
  const projectedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!parentSessionId) {
      setChildExecutions([]);
      return;
    }

    let cancelled = false;
    let pollTimer: number | undefined;

    const load = async () => {
      try {
        const { data } = await apiClient.get<AgentFlowRunSnapshot[]>(
          `/api/agent-flows/runs?parentSessionId=${encodeURIComponent(parentSessionId)}`,
        );
        if (cancelled) return;

        setChildExecutions(data.map(runtimeChildExecutionFromAgentFlowSnapshot));
        await Promise.allSettled(data.map(async (snapshot) => {
          if (!isProjectableAgentFlowStatus(snapshot.run.status)) {
            return;
          }
          const key = `${snapshot.run.id}:${snapshot.run.status}:${snapshot.run.updatedAt}`;
          if (projectedKeysRef.current.has(key)) {
            return;
          }
          const applied = await projectSubAgentFlowArchitectureResult({
            toolName: 'run_sub_agentflow',
            resultData: subAgentFlowResultFromSnapshot(snapshot),
            resultSessionId: parentSessionId,
            getSessionMessages,
            getSessionAgentTurns,
            getSessionActiveTurnId,
            setMessages,
            setAgentTurns,
          });
          if (applied) {
            projectedKeysRef.current.add(key);
          }
        }));

        if (!cancelled && data.some((snapshot) => isActiveAgentFlowStatus(snapshot.run.status))) {
          pollTimer = window.setTimeout(load, AGENT_FLOW_POLL_MS);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[ExecutionGraphView] parent AgentFlow runs load failed', error);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [
    getSessionActiveTurnId,
    getSessionAgentTurns,
    getSessionMessages,
    parentSessionId,
    setAgentTurns,
    setMessages,
  ]);

  return childExecutions;
}

export function useArchitectureRootGraph(
  activeSessionId: string | null,
  activeArchitectureRunId: string | null,
): ArchitectureGraphProjection | null {
  const [architectureRootGraph, setArchitectureRootGraph] = useState<ArchitectureGraphProjection | null>(null);

  useEffect(() => {
    if (!activeSessionId || !activeArchitectureRunId) {
      setArchitectureRootGraph(null);
      return;
    }

    let cancelled = false;
    setArchitectureRootGraph(null);
    apiClient
      .get<ArchitectureGraphProjection>(`/api/architecture-runs/${activeArchitectureRunId}/graph`)
      .then((response) => {
        if (!cancelled) {
          setArchitectureRootGraph(response.data);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setArchitectureRootGraph(null);
          console.error('[ExecutionGraphView] architecture root graph load failed', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeArchitectureRunId, activeSessionId]);

  return architectureRootGraph;
}
