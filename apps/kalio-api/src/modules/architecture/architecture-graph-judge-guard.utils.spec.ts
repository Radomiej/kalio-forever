import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureRun, ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { judgeArchitectureContinuationGuard } from './architecture-graph-judge-guard.utils';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';
import type { ArchitectureRoleExecutor } from './architecture-role-executor';

const judgeSlot: ArchitectureRoleSlot = {
  id: 'judge',
  label: 'Judge',
  description: 'Reviews implementation proof.',
  slotType: 'judge',
  defaultPersonaId: 'agent-judge',
  allowedPersonaTags: [],
  required: true,
  canOverrideAtRunStart: true,
};

const implementerSlot: ArchitectureRoleSlot = {
  id: 'implementer',
  label: 'Implementer',
  description: 'Creates visible evidence.',
  slotType: 'tool_executor',
  defaultPersonaId: 'agent-implementer',
  allowedPersonaTags: [],
  required: true,
  canOverrideAtRunStart: true,
};

const judgeNode: ArchitectureSchemaNode = {
  id: 'judge-node',
  label: 'Judge Node',
  kind: 'router',
  roleSlotId: judgeSlot.id,
};

const schema: ArchitectureSchema = {
  id: 'schema-judge-guard',
  name: 'Judge Guard',
  description: 'Judge continuation guard fixture.',
  version: '0.1.0',
  roleSlots: [judgeSlot, implementerSlot],
  nodes: [
    judgeNode,
    { id: 'continue-node', label: 'Continue', kind: 'role', roleSlotId: implementerSlot.id },
    { id: 'final-node', label: 'Final', kind: 'artifact', roleSlotId: judgeSlot.id },
  ],
  edges: [
    { id: 'judge-continue', fromNodeId: judgeNode.id, toNodeId: 'continue-node', selection: 'continuation' },
    { id: 'judge-final', fromNodeId: judgeNode.id, toNodeId: 'final-node', selection: 'default' },
  ],
  routerPolicy: {
    mode: 'rank_then_merge',
    mustAddressCriticFindings: true,
    canReturnNeedsMoreResearch: true,
  },
  contextPolicy: {
    includeUserTask: true,
    includeProjectMemory: false,
    includeBrowserSession: false,
    includePriorDecisions: false,
  },
  memoryPolicy: {
    persistFinalArtifact: true,
    persistRouterDecision: true,
  },
  outputArtifactSchema: 'markdown',
};

function event(partial: Partial<ArchitectureExecutionEvent>): ArchitectureExecutionEvent {
  return {
    id: partial.id ?? 'event-1',
    runId: partial.runId ?? 'run-1',
    sequence: partial.sequence ?? 1,
    type: partial.type ?? 'participant_output',
    message: partial.message ?? 'display only',
    createdAt: partial.createdAt ?? 1,
    ...partial,
  };
}

function visibleProofEvent(): ArchitectureExecutionEvent {
  return event({
    id: 'proof-event',
    roleSlotId: implementerSlot.id,
    data: {
      toolEvidence: {
        toolResultCount: 1,
        successfulToolNames: ['fs_read'],
        targetPaths: ['package.json'],
      },
    },
  });
}

function guard(input: {
  selectedNodeIds: string[];
  events?: ArchitectureExecutionEvent[];
  runContext?: Record<string, unknown>;
}) {
  const events = input.events ?? [];
  return judgeArchitectureContinuationGuard({
    slot: judgeSlot,
    node: judgeNode,
    schema,
    requireGoalMasterLoopProof: true,
    incomingNodeIds: ['continue-node'],
    selectedNodeIds: input.selectedNodeIds,
    outgoingNodeIds: ['continue-node', 'final-node'],
    finalizationInput: {
      schema,
      runContext: input.runContext ?? {},
      events,
      priorEvents: [],
    },
    events,
  });
}

describe('judge architecture continuation guard', () => {
  async function runGoalGraph(withProof: boolean, buildExitCodes: number[] = [0]) {
    const goalSchema: ArchitectureSchema = {
      ...schema,
      roleSlots: [judgeSlot, { ...implementerSlot, slotType: 'participant' }],
      nodes: [{ id: 'entry', label: 'Entry', kind: 'parallel' }, ...schema.nodes],
      edges: [...schema.edges,
        { id: 'entry-worker', fromNodeId: 'entry', toNodeId: 'continue-node' },
        { id: 'worker-judge', fromNodeId: 'continue-node', toNodeId: judgeNode.id },
      ],
    };
    const run: ArchitectureRun = {
      id: 'goal-evidence-run', schemaId: goalSchema.id, prompt: 'Complete the goal with evidence.',
      executionMode: 'subagent_execution', status: 'running', rootSessionId: 'goal-root',
      branchSessionIds: { judge: 'judge-child', implementer: 'worker-child' },
      context: { requireGoalMasterLoopProof: true, maxArchitectureSteps: 12, maxArchitectureNodeVisits: 2 },
      createdAt: 1, updatedAt: 1,
    };
    let workerCalls = 0;
    const roleExecutor: ArchitectureRoleExecutor = {
      async execute({ slot }) {
        if (slot.id === implementerSlot.id) {
          workerCalls += 1;
          const exitCode = buildExitCodes[Math.min(workerCalls - 1, buildExitCodes.length - 1)];
          return { message: 'done', data: withProof ? {
            toolEvidence: { toolResultCount: 2, successfulToolNames: ['fs_write', 'fs_read'], targetPaths: ['src/index.ts'] },
            evidence: [{ kind: 'BUILD_RESULT', status: exitCode === 0 ? 'passed' : 'failed', data: { exitCode } }],
          } : { response: 'done' } };
        }
        return { message: 'complete', data: { routerOutput: {
          selectedStrategy: 'final-node', mergedDecision: 'complete', acceptedInputs: [], rejectedInputs: [],
          unresolvedConflicts: [], risks: [], confidence: 1, nextAction: 'route_to', targetNodeId: 'final-node',
        } } };
      },
    };
    const events = await createArchitectureGraphEvents({
      schema: goalSchema, run, now: 1, roleExecutor, personaForSlot: (slot) => slot.defaultPersonaId,
    });
    return { events, workerCalls };
  }

  it('terminates unsupported claims at the existing visit bound without a successful final artifact', async () => {
    const { events, workerCalls } = await runGoalGraph(false);
    expect(workerCalls).toBe(2);
    expect(events.some((item) => item.reasonCode === 'max_node_visits')).toBe(true);
    expect(events.some((item) => item.type === 'final_artifact')).toBe(false);
    expect(events.filter((item) => item.type === 'router_decision' && item.nodeId === judgeNode.id)
      .every((item) => item.route?.selectedNodeIds.includes('continue-node'))).toBe(true);
  });

  it('finalizes valid passed build and write proof without an extra worker execution', async () => {
    const { events, workerCalls } = await runGoalGraph(true);
    expect(workerCalls).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'final_artifact', reasonCode: 'final_artifact_accepted', status: 'done',
    }));
  });

  it('blocks a typed complete route after failed builds until the visit limit', async () => {
    const { events, workerCalls } = await runGoalGraph(true, [1]);
    expect(workerCalls).toBe(2);
    expect(events.some((item) => item.reasonCode === 'max_node_visits')).toBe(true);
    expect(events.some((item) => item.type === 'final_artifact')).toBe(false);
  });

  it('recovers from a failed attempt once the next build passes without another worker', async () => {
    const { events, workerCalls } = await runGoalGraph(true, [1, 0]);
    expect(workerCalls).toBe(2);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'final_artifact', reasonCode: 'final_artifact_accepted', status: 'done',
    }));
    expect(events.some((item) => item.reasonCode === 'max_node_visits')).toBe(false);
  });

  it('keeps an unsupported done claim on continuation after a previous continuation', () => {
    const result = guard({
      selectedNodeIds: ['final-node'],
      events: [
        event({ type: 'router_decision', nodeId: judgeNode.id, route: {
          source: 'runtime_fallback', fromNodeId: judgeNode.id, selectedNodeIds: ['continue-node'],
        } }),
        event({ roleSlotId: implementerSlot.id, message: 'done', data: { response: 'done' } }),
      ],
    });
    expect(result.selectedNodeIds).toEqual(['continue-node']);
    expect(result.applied).toBe(true);
  });

  it('rejects a complete verdict when the latest typed build failed despite read proof', () => {
    const proof = visibleProofEvent();
    proof.evidence = [{ kind: 'BUILD_RESULT', status: 'failed', data: { exitCode: 1 } }];
    expect(guard({ selectedNodeIds: ['final-node'], events: [proof],
      runContext: { externalQualityGate: { source: 'Jev', status: 'passed' } },
    }).selectedNodeIds).toEqual(['continue-node']);
  });

  it('routes to continuation when finalization lacks visible workflow proof', () => {
    expect(guard({ selectedNodeIds: ['final-node'] })).toEqual({
      selectedNodeIds: ['continue-node'],
      applied: true,
      reason: 'Goal completion requires successful workflow tool evidence.',
    });
  });

  it('allows finalization when typed quality gate passed and visible proof exists', () => {
    expect(guard({
      selectedNodeIds: ['continue-node'],
      events: [visibleProofEvent()],
      runContext: {
        externalQualityGate: {
          source: 'QA',
          status: 'passed',
          highFindings: 0,
        },
      },
    })).toEqual({
      selectedNodeIds: ['final-node'],
      applied: true,
      reason: 'QA quality gate passed.',
    });
  });

  it('no longer treats a previous continuation as completion proof', () => {
    expect(guard({
      selectedNodeIds: ['final-node'],
      events: [
        event({
          type: 'router_decision',
          nodeId: judgeNode.id,
          route: {
            source: 'runtime_fallback',
            fromNodeId: judgeNode.id,
            selectedNodeIds: ['continue-node'],
          },
        }),
      ],
    })).toEqual({
      selectedNodeIds: ['continue-node'],
      applied: true,
      reason: 'Goal completion requires successful workflow tool evidence.',
    });
  });
});
