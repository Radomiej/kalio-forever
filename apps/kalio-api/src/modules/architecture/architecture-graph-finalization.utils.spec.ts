import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import {
  architectureToolExecutorContract,
  blockingFinalizationReason,
  externalQualityGateAcceptanceReason,
  hasVisibleWorkflowToolProof,
  incompleteToolExecutorReason,
  workflowEvidenceArray,
} from './architecture-graph-finalization.utils';

const implementerSlot: ArchitectureRoleSlot = {
  id: 'implementer',
  label: 'Implementer',
  description: 'Writes implementation evidence.',
  slotType: 'tool_executor',
  defaultPersonaId: 'agent-implementer',
  allowedPersonaTags: [],
  required: true,
  canOverrideAtRunStart: true,
};

const verifierSlot: ArchitectureRoleSlot = {
  id: 'verifier',
  label: 'Verifier',
  description: 'Verifies implementation evidence.',
  slotType: 'tool_executor',
  defaultPersonaId: 'agent-verifier',
  allowedPersonaTags: [],
  required: true,
  canOverrideAtRunStart: true,
};

const routerSlot: ArchitectureRoleSlot = {
  id: 'router',
  label: 'Router',
  description: 'Routes graph execution.',
  slotType: 'router',
  defaultPersonaId: 'agent-router',
  allowedPersonaTags: [],
  required: true,
  canOverrideAtRunStart: true,
};

const schema: ArchitectureSchema = {
  id: 'schema-finalization',
  name: 'Schema Finalization',
  description: 'Finalization guard test schema.',
  version: '0.1.0',
  roleSlots: [routerSlot, implementerSlot, verifierSlot],
  nodes: [],
  edges: [],
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

function event(
  type: ArchitectureExecutionEvent['type'],
  roleSlotId: string | undefined,
  data: Record<string, unknown>,
  evidence?: ArchitectureExecutionEvent['evidence'],
): ArchitectureExecutionEvent {
  return {
    id: `event-${type}-${roleSlotId ?? 'none'}`,
    runId: 'run-finalization',
    sequence: 1,
    type,
    message: 'display only',
    roleSlotId,
    data,
    evidence,
    createdAt: 1,
  };
}

function toolData(toolEvidence: Record<string, unknown>): Record<string, unknown> {
  return { toolEvidence };
}

describe('architecture graph finalization helpers', () => {
  it('blocks finalization on typed external quality gate failure', () => {
    const reason = blockingFinalizationReason({
      schema,
      runContext: {
        externalQualityGate: {
          source: 'QA',
          status: 'failed',
          highFindings: 2,
          summary: 'Build regression.',
        },
      },
      events: [],
      priorEvents: [],
    });

    expect(reason).toBe('QA quality gate failed with 2 high finding(s). Build regression.');
  });

  it('accepts passed quality gate only when visible workflow tool proof exists', () => {
    const proofEvent = event('participant_output', 'router', toolData({
      toolResultCount: 1,
      successfulToolNames: ['fs_read'],
      targetPaths: ['package.json'],
    }));

    expect(externalQualityGateAcceptanceReason({
      runContext: {
        externalQualityGate: {
          source: 'QA',
          status: 'passed',
          highFindings: 0,
        },
      },
    })).toBe('QA quality gate passed.');
    expect(hasVisibleWorkflowToolProof({ schema, events: [proofEvent] })).toBe(true);
    expect(blockingFinalizationReason({
      schema,
      runContext: {
        externalQualityGate: {
          source: 'QA',
          status: 'passed',
          highFindings: 0,
        },
      },
      events: [proofEvent],
      priorEvents: [],
    })).toBeUndefined();
  });

  it('reports unresolved CLI child materialization instead of treating spawned child as proof', () => {
    const implementerEvent = event('participant_output', 'implementer', toolData({
      toolResultCount: 1,
      successfulToolNames: ['spawn_cli_agent'],
      targetPaths: ['src/index.ts'],
      childCliSessions: [{ status: 'running' }],
    }));

    expect(blockingFinalizationReason({
      schema,
      runContext: {},
      events: [implementerEvent],
      priorEvents: [],
    })).toBe('CLI child implementation is incomplete: child status is running.');
  });

  it('validates implementation and verifier tool-executor contracts from typed evidence', () => {
    expect(architectureToolExecutorContract({
      slot: implementerSlot,
      data: toolData({
        toolResultCount: 1,
        successfulToolNames: ['fs_write'],
        targetPaths: ['architecture.md'],
      }),
      incomingEvents: [],
      schema,
      runContext: {},
      events: [],
      priorEvents: [],
    })).toEqual({ ok: true });

    expect(architectureToolExecutorContract({
      slot: verifierSlot,
      data: toolData({
        toolResultCount: 1,
        successfulToolNames: ['fs_write'],
        targetPaths: ['architecture.md'],
      }),
      incomingEvents: [],
      schema,
      runContext: {},
      events: [],
      priorEvents: [],
    })).toEqual({
      ok: false,
      reason: 'verifier did not produce a successful read or terminal evidence result',
    });
  });

  it('keeps workflow evidence parsing typed and ignores malformed evidence rows', () => {
    expect(workflowEvidenceArray({
      evidence: [
        { kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 }, source: 'npm test' },
        { kind: 'BOGUS', status: 'passed' },
        { kind: 'QUALITY_GATE', status: 'invalid' },
        'text-only',
      ],
    })).toEqual([
      { kind: 'BUILD_RESULT', status: 'passed', source: 'npm test', data: { exitCode: 0 } },
    ]);
  });

  it('returns an incomplete implementation reason when delegated CLI work has not completed', () => {
    expect(incompleteToolExecutorReason({
      slot: implementerSlot,
      data: toolData({
        toolResultCount: 1,
        successfulToolNames: ['run_cli_agent'],
        targetPaths: ['src/index.ts'],
        childCliSessions: [{ status: 'running' }],
      }),
      incomingEvents: [],
    })).toBe('CLI child implementation is incomplete: child status is running.');
  });
});
