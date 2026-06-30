import type { ArchitectureChatRunSummary } from '@kalio/types';
import type { ArchitectureGraphNodeSummary, ArchitectureRunSummaryWithGraph } from './architectureChatSummary';

export type TraceStep = ArchitectureChatRunSummary['trace'][number] & {
  plannedLabel?: string;
  plannedStatus?: ArchitectureGraphNodeSummary['status'];
};

export type TraceStage =
  | { kind: 'step'; step: TraceStep }
  | { kind: 'parallel'; steps: TraceStep[] };

export type TimelineStatus = 'pending' | 'running' | 'completed' | 'waiting' | 'failed';

export function nodeLabel(step: TraceStep): string {
  if (step.plannedLabel) {
    return step.plannedLabel;
  }
  const raw = firstNonEmptyString(step.nodeId, step.nextNodeId, step.speaker) ?? 'unknown';
  return raw
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function buildTimelineStages(run: ArchitectureChatRunSummary): TraceStage[] {
  const graphRun = run as ArchitectureRunSummaryWithGraph;
  const graphNodes = graphRun.graphNodes;
  if (!graphNodes || graphNodes.length === 0) {
    return buildTraceStages(run.trace);
  }

  const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const consumedNodeIds = new Set<string>();
  const stages: TraceStage[] = [];

  for (const node of graphNodes) {
    if (consumedNodeIds.has(node.id)) {
      continue;
    }
    consumedNodeIds.add(node.id);

    if (node.kind === 'parallel' || node.kind === 'router') {
      stages.push({ kind: 'step', step: stepFromGraphNode(run, node, graphRun) });
      const branchNodes = fanOutBranchNodes(node.id, graphRun, nodeById)
        .filter((branchNode) => !consumedNodeIds.has(branchNode.id));
      if (branchNodes.length > 1) {
        branchNodes.forEach((branchNode) => consumedNodeIds.add(branchNode.id));
        stages.push({
          kind: 'parallel',
          steps: branchNodes.map((branchNode) => stepFromGraphNode(run, branchNode, graphRun)),
        });
      }
      continue;
    }

    stages.push({ kind: 'step', step: stepFromGraphNode(run, node, graphRun) });
  }

  return stages;
}

export function graphStepCount(run: ArchitectureChatRunSummary): number {
  return (run as ArchitectureRunSummaryWithGraph).graphNodes?.length ?? run.trace.length;
}

export function stageSegment(
  stage: TraceStage,
  resolveLabel?: (step: TraceStep) => string,
): { label: string; tone: string } {
  if (stage.kind === 'parallel') {
    return { label: `Sub-agents ${stage.steps.length}`, tone: 'text-sky-200 bg-sky-400/10 border-sky-400/20' };
  }
  return { label: routeSegmentLabel(stage.step, resolveLabel?.(stage.step)), tone: routeSegmentTone(stage.step) };
}

export function stepFocus(step: TraceStep): { eventId?: string; nodeId?: string } {
  return { eventId: step.eventId, nodeId: step.nodeId };
}

export function statusForStep(step: TraceStep | undefined): TimelineStatus | null {
  if (!step) {
    return 'pending';
  }
  if (step.incompleteReason) {
    return step.stream?.status === 'failed' ? 'failed' : 'waiting';
  }
  if (step.stream?.status === 'failed') {
    return 'failed';
  }
  if (step.stream?.status === 'started' || step.stream?.status === 'streaming') {
    return 'running';
  }
  if (step.stream?.status === 'completed') {
    return 'completed';
  }
  if (step.plannedStatus === 'running') {
    return 'running';
  }
  if (step.plannedStatus === 'completed') {
    return 'completed';
  }
  if (step.plannedStatus === 'pending') {
    return 'pending';
  }
  return step.content ? 'completed' : null;
}

function buildTraceStages(trace: TraceStep[]): TraceStage[] {
  const stages: TraceStage[] = [];
  let participantBuffer: TraceStep[] = [];

  const flushParticipants = () => {
    if (participantBuffer.length === 0) return;
    if (participantBuffer.length === 1) {
      const [step] = participantBuffer;
      if (step) stages.push({ kind: 'step', step });
    } else {
      stages.push({ kind: 'parallel', steps: participantBuffer });
    }
    participantBuffer = [];
  };

  trace.forEach((step) => {
    if (step.speaker === 'participant') {
      participantBuffer.push(step);
      return;
    }
    flushParticipants();
    stages.push({ kind: 'step', step });
  });

  flushParticipants();
  return stages;
}

function fanOutBranchNodes(
  nodeId: string,
  run: ArchitectureRunSummaryWithGraph,
  nodeById: Map<string, ArchitectureGraphNodeSummary>,
): ArchitectureGraphNodeSummary[] {
  const outgoingRoleNodes = (run.graphEdges ?? [])
    .filter((edge) => edge.fromNodeId === nodeId)
    .map((edge) => nodeById.get(edge.toNodeId))
    .filter((node): node is ArchitectureGraphNodeSummary => node?.kind === 'role');
  return outgoingRoleNodes.length > 1 ? outgoingRoleNodes : [];
}

function stepFromGraphNode(
  run: ArchitectureChatRunSummary,
  node: ArchitectureGraphNodeSummary,
  graphRun: ArchitectureRunSummaryWithGraph,
): TraceStep {
  const traceStep = findTraceStepForNode(run.trace, node);
  const nextNodeId = nextNodeIdForGraphNode(node.id, graphRun);
  return {
    speaker: speakerForGraphNode(node),
    content: node.kind === 'artifact' ? graphRun.finalArtifact ?? '' : '',
    ...traceStep,
    eventId: traceStep?.eventId ?? node.eventIds[0],
    sessionId: traceStep?.sessionId ?? node.sessionId,
    nodeId: traceStep?.nodeId ?? node.id,
    nextNodeId: traceStep?.nextNodeId ?? nextNodeId,
    incompleteReason: traceStep?.incompleteReason ?? node.incompleteReason,
    plannedLabel: node.kind === 'parallel' ? undefined : node.label,
    plannedStatus: node.status,
  };
}

function speakerForGraphNode(node: ArchitectureGraphNodeSummary): TraceStep['speaker'] {
  if (node.kind === 'role') {
    return 'participant';
  }
  if (node.kind === 'artifact') {
    return 'finalizer';
  }
  return 'router';
}

function findTraceStepForNode(
  trace: ArchitectureChatRunSummary['trace'],
  node: ArchitectureGraphNodeSummary,
): ArchitectureChatRunSummary['trace'][number] | undefined {
  return trace.find((step) => (
    step.nodeId === node.id
    || (step.eventId !== undefined && node.eventIds.includes(step.eventId))
  ));
}

function nextNodeIdForGraphNode(nodeId: string, run: ArchitectureRunSummaryWithGraph): string | undefined {
  const edge = run.graphEdges?.find((candidate) => candidate.fromNodeId === nodeId);
  return edge?.toNodeId;
}

function routeSegmentLabel(step: TraceStep, labelOverride?: string): string {
  if (labelOverride) return labelOverride;
  if (step.speaker === 'participant') return nodeLabel(step);
  if (step.speaker === 'router') return nodeLabel(step);
  if (step.speaker === 'finalizer') return 'Finalizer';
  return nodeLabel(step);
}

function routeSegmentTone(step: TraceStep): string {
  if (step.speaker === 'participant') return 'text-sky-200 bg-sky-400/10 border-sky-400/20';
  if (step.speaker === 'router') return 'text-amber-200 bg-amber-400/10 border-amber-400/20';
  if (step.speaker === 'finalizer') return 'text-emerald-200 bg-emerald-400/10 border-emerald-400/20';
  return 'text-base-content bg-base-100/50 border-base-content/20';
}
