import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../../store/sessionStore';
import { architectureTraceActivitySummary } from '../architectureChatSummary';
import type { ExecutionGraphEdge, ExecutionGraphNode } from './executionGraphModel.types';

type ArchitectureRun = NonNullable<ChatMessage['architectureRun']>;
type TraceStep = ArchitectureRun['trace'][number];
type RouteHop = ArchitectureRun['routeHops'][number];

type AddNode = (node: Omit<ExecutionGraphNode, 'x' | 'y' | 'width' | 'height'>) => ExecutionGraphNode;
type AddEdge = (sourceId: string, targetId: string, style?: ExecutionGraphEdge['style']) => void;

interface RenderArchitectureRunInput {
  addEdge: AddEdge;
  addNode: AddNode;
  architectureRun?: ArchitectureRun | null;
  branchMaxColumn: number;
  finalMessage: ChatMessage;
  startRow: number;
  turn: AgentTurn;
  turnNodeId: string;
}

export function renderArchitectureRunProjection({
  addEdge,
  addNode,
  architectureRun,
  branchMaxColumn,
  finalMessage,
  startRow,
  turn,
  turnNodeId,
}: RenderArchitectureRunInput): {
  finalColumn: number;
  finalSourceId: string;
  maxRow: number;
} {
  const run = finalMessage.architectureRun ?? architectureRun ?? null;
  if (!run) {
    return {
      finalColumn: branchMaxColumn + 1,
      finalSourceId: turnNodeId,
      maxRow: startRow,
    };
  }

  const architectureRunNodeId = `architecture-run:${finalMessage.id}`;
  const architectureRunNode = addNode({
    id: architectureRunNodeId,
    kind: 'architecture-run',
    title: 'Architecture run',
    subtitle: `${run.schemaId} / ${run.status}`,
    detail: run.trace
      .map((step) => `${step.speaker}${step.nextNodeId ? ` -> ${step.nextNodeId}` : ''}`)
      .join(', '),
    status: architectureExecutionStatus(run.status),
    column: branchMaxColumn + 1,
    row: startRow,
    turnId: turn.id,
    payload: {
      kind: 'architecture-run',
      summary: run,
    },
  });
  addEdge(turnNodeId, architectureRunNode.id);

  const routeSteps = architectureRouteSteps(run);
  routeSteps.forEach(({ hop, traceStep }, index) => {
    const layout = architectureRouteLayout(routeSteps, index);
    const fromLabel = traceStep?.visitIndex ? `${hop.fromNodeId} #${traceStep.visitIndex}` : hop.fromNodeId;
    const branchSessionId = traceStep?.sessionId ?? traceStep?.stream?.branchSessionId;
    const routeNode = addNode({
      id: `architecture-route:${finalMessage.id}:${index}`,
      kind: 'architecture-run',
      title: architectureRouteTitle(traceStep, hop.source),
      subtitle: `${fromLabel} -> ${hop.toNodeId}`,
      detail: architectureRouteDetail(traceStep),
      status: architectureExecutionStatus(run.status, traceStep?.stream?.status),
      column: branchMaxColumn + 2 + layout.column,
      row: startRow + layout.row,
      turnId: turn.id,
      sessionId: branchSessionId,
      payload: {
        kind: 'architecture-run',
        summary: run,
        route: {
          eventId: hop.eventId,
          source: hop.source,
          fromNodeId: hop.fromNodeId,
          toNodeId: hop.toNodeId,
          branchSessionOpenable: Boolean(branchSessionId),
          streamStatus: traceStep?.stream?.status,
          chunkCount: traceStep?.stream?.chunkCount,
          branchSessionId,
          contentPreview: compactArchitectureContent(traceStep?.content),
        },
      },
    });
    addEdge(index === 0 ? architectureRunNode.id : `architecture-route:${finalMessage.id}:${index - 1}`, routeNode.id);
  });

  const routeLayout = routeSteps.map((_, index) => architectureRouteLayout(routeSteps, index));
  const finalRouteColumn = routeLayout.reduce((value, layout) => Math.max(value, layout.column), -1);
  const maxRouteRow = routeLayout.reduce((value, layout) => Math.max(value, layout.row), 0);

  return {
    finalColumn: branchMaxColumn + 3 + finalRouteColumn,
    finalSourceId: routeSteps.length > 0
      ? `architecture-route:${finalMessage.id}:${routeSteps.length - 1}`
      : architectureRunNodeId,
    maxRow: startRow + maxRouteRow,
  };
}

function architectureExecutionStatus(
  runStatus: ArchitectureRun['status'],
  streamStatus?: NonNullable<TraceStep['stream']>['status'],
) {
  if (runStatus === 'failed' || runStatus === 'cancelled' || streamStatus === 'failed') {
    return 'error' as const;
  }
  if (streamStatus === 'started' || streamStatus === 'streaming' || runStatus === 'running') {
    return 'running' as const;
  }
  return 'success' as const;
}

function architectureRouteLayout(
  routeSteps: Array<{ hop: RouteHop; traceStep: TraceStep | undefined }>,
  targetIndex: number,
): { column: number; row: number } {
  let column = 0;
  let parallelRow = 0;

  for (let index = 0; index <= targetIndex; index += 1) {
    const current = routeSteps[index];
    const previous = routeSteps[index - 1];
    const currentIsParallel = current?.hop.source === 'parallel';
    const previousIsParallel = previous?.hop.source === 'parallel';

    if (index > 0 && !(currentIsParallel && previousIsParallel)) {
      column += 1;
      parallelRow = 0;
    } else if (index > 0 && currentIsParallel && previousIsParallel) {
      parallelRow += 1;
    }
  }

  return { column, row: parallelRow };
}

function architectureRouteSteps(run: ArchitectureRun): Array<{ hop: RouteHop; traceStep: TraceStep | undefined }> {
  if (run.routeHops.length > 0) {
    return run.routeHops.map((hop, index) => ({
      hop,
      traceStep: run.trace.find((step) => step.eventId === hop.eventId) ?? run.trace[index],
    }));
  }

  return run.trace.map((step, index) => ({
    hop: {
      eventId: step.eventId ?? `trace-${index}`,
      source: architectureRouteSourceForTraceStep(step),
      fromNodeId: step.nodeId ?? step.speaker,
      toNodeId: step.nextNodeId ?? step.nodeId ?? step.speaker,
    },
    traceStep: step,
  }));
}

function architectureRouteSourceForTraceStep(step: TraceStep): RouteHop['source'] {
  if (step.speaker === 'router') {
    return 'router';
  }

  return 'agent';
}

function architectureRouteTitle(traceStep: TraceStep | undefined, source: string): string {
  if (!traceStep?.nodeId) {
    return source;
  }

  return traceStep.nodeId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function architectureRouteDetail(
  traceStep: TraceStep | undefined,
): string | undefined {
  if (!traceStep) {
    return undefined;
  }
  const stream = traceStep.stream
    ? `Stream ${traceStep.stream.status} / ${traceStep.stream.chunkCount} chunks`
    : undefined;
  const activity = traceStep.stream?.status === 'started' || traceStep.stream?.status === 'streaming' || traceStep.stream?.status === 'failed'
    ? architectureTraceActivitySummary(traceStep.speaker, traceStep.stream.status)
    : traceStep.actionSummary ?? architectureTraceActivitySummary(traceStep.speaker);
  const incomplete = traceStep.incompleteReason ? `Incomplete: ${traceStep.incompleteReason}` : undefined;
  return [stream, activity, incomplete].filter(Boolean).join('\n');
}

function compactArchitectureContent(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length > 96 ? `${normalized.slice(0, 93).trimEnd()}...` : normalized;
}

export function architectureRunContainsMessage(run: ArchitectureRun, message: ChatMessage): boolean {
  if (message.architectureRun?.runId === run.runId) {
    return true;
  }

  const messageId = message.id;
  return run.trace.some((step) => step.eventId && messageId.includes(step.eventId));
}
