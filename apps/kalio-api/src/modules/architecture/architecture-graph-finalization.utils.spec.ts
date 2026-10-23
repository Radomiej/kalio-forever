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
  const goalContext = { requireGoalMasterLoopProof: true };
  function buildProof(status: 'passed' | 'failed', exitCode: number): ArchitectureExecutionEvent {
    return event('participant_output', 'implementer', toolData({
      toolResultCount: 2, successfulToolNames: ['fs_write', 'fs_read'], targetPaths: ['src/index.ts'],
    }), [{ kind: 'BUILD_RESULT', status, data: { exitCode } }]);
  }

  it('blocks goal finalization on a failed build despite successful tools and a complete verdict', () => {
    expect(blockingFinalizationReason({ schema,
      runContext: { ...goalContext, externalQualityGate: { source: 'Jev', status: 'passed' } },
      events: [buildProof('failed', 1)],
    })).toMatch(/build/i);
  });

  it('does not let an older passed build mask a newer failed attempt', () => {
    expect(blockingFinalizationReason({ schema, runContext: goalContext,
      priorEvents: [buildProof('passed', 0)], events: [buildProof('failed', 1)],
    })).toMatch(/build/i);
  });

  it('allows a newer passed build to supersede an old failed attempt', () => {
    expect(blockingFinalizationReason({ schema, runContext: goalContext,
      priorEvents: [buildProof('failed', 1)], events: [buildProof('passed', 0)],
    })).toBeUndefined();
  });

  it.each([
    { status: 'passed' as const, data: { exitCode: 1 } },
    { status: 'failed' as const, data: { exitCode: 0 } },
    { status: 'unknown' as const, data: { exitCode: 0 } },
    { status: 'passed' as const, data: {} },
  ])('rejects an invalid latest build result %j', (build) => {
    const latest = buildProof('passed', 0);
    latest.evidence = [{ kind: 'BUILD_RESULT', ...build }];
    expect(blockingFinalizationReason({ schema, runContext: goalContext,
      events: [buildProof('passed', 0), latest],
    })).toMatch(/build/i);
  });

  it('checks the last typed build row in data evidence as well as top-level evidence', () => {
    const latest = buildProof('passed', 0);
    latest.data = { ...latest.data, evidence: [
      { kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } },
      { kind: 'BUILD_RESULT', status: 'failed', data: { exitCode: 1 } },
    ] };
    latest.evidence = undefined;
    expect(blockingFinalizationReason({ schema, runContext: goalContext, events: [latest] })).toMatch(/build/i);
  });

  it('does not admit a no-op implementer using old passed host proof after a new failed build', () => {
    const oldProof = buildProof('passed', 0);
    expect(architectureToolExecutorContract({ schema, runContext: goalContext,
      slot: implementerSlot, data: {}, incomingEvents: [],
      priorEvents: [oldProof], events: [buildProof('failed', 1)],
    })).toEqual({ ok: false, reason: 'implementer did not produce a successful write result' });
  });

  it('blocks unsupported goal completion even after a prior continuation', () => {
    expect(blockingFinalizationReason({ schema, runContext: goalContext,
      events: [event('participant_output', 'implementer', { response: 'done' })],
    })).toBeDefined();
  });

  it('keeps generic chat completion unchanged without the goal proof flag', () => {
    expect(blockingFinalizationReason({ schema, runContext: {},
      events: [buildProof('failed', 1)],
    })).toBeUndefined();
  });

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

  it.each(['running', 'cancelled', 'failed', undefined])('does not let a passed QA gate hide unresolved child status %s', (status) => {
    const implementation = event('participant_output', 'implementer', toolData({
      toolResultCount: 1,
      successfulToolNames: ['spawn_cli_agent'],
      targetPaths: ['src/index.ts'],
      childCliSessions: [{ status }],
    }));
    const verification = event('participant_output', 'verifier', toolData({
      toolResultCount: 1,
      successfulToolNames: ['fs_read'],
      targetPaths: ['package.json'],
    }));
    expect(blockingFinalizationReason({
      schema,
      runContext: { externalQualityGate: { source: 'QA', status: 'passed', highFindings: 0 } },
      events: [implementation, verification],
    })).toBe(`CLI child implementation is incomplete: child status is ${status ?? 'unknown'}.`);
  });

  it('does not let independent read/build proof hide a currently running implementation child', () => {
    const implementation = event('participant_output', 'implementer', toolData({
      toolResultCount: 1,
      successfulToolNames: ['spawn_cli_agent'],
      targetPaths: ['src/index.ts'],
      childCliSessions: [{ status: 'running' }],
    }));
    const verification = event('participant_output', 'verifier', toolData({
      toolResultCount: 2,
      successfulToolNames: ['fs_read', 'terminal_output'],
      targetPaths: ['package.json'],
    }), [{ kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } }]);
    expect(blockingFinalizationReason({ schema, runContext: {}, events: [implementation, verification] }))
      .toBe('CLI child implementation is incomplete: child status is running.');
  });

  it.each(['completed', 'terminal-success', 'success', 'exited'])('allows a newer resolved child status %s to supersede old running evidence', (status) => {
    const running = event('participant_output', 'implementer', toolData({
      toolResultCount: 1,
      successfulToolNames: ['spawn_cli_agent'],
      targetPaths: ['src/index.ts'],
      childCliSessions: [{ status: 'running' }],
    }));
    const resolved: ArchitectureExecutionEvent = {
      ...running,
      id: 'resolved-implementation',
      sequence: 2,
      data: toolData({
        toolResultCount: 2,
        successfulToolNames: ['message_cli_agent'],
        targetPaths: ['src/index.ts'],
        childCliSessions: [{ status }],
      }),
    };
    expect(blockingFinalizationReason({
      schema,
      runContext: { externalQualityGate: { source: 'QA', status: 'passed', highFindings: 0 } },
      events: [running, resolved],
    })).toBeUndefined();
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
