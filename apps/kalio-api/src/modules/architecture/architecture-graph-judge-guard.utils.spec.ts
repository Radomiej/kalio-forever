import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { judgeArchitectureContinuationGuard } from './architecture-graph-judge-guard.utils';

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
  it('routes to continuation once when finalization lacks visible workflow proof', () => {
    expect(guard({ selectedNodeIds: ['final-node'] })).toEqual({
      selectedNodeIds: ['continue-node'],
      applied: true,
      reason: 'Runtime Goal Master guard required one visible continuation through continue-node before finalization.',
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

  it('does not create an infinite continuation loop after a previous judge continuation', () => {
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
      selectedNodeIds: ['final-node'],
      applied: false,
    });
  });
});
