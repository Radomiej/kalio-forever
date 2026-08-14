import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureSchemaNode } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import {
  finalArtifactFromRoleResult,
  finalArtifactFromSynthesizedGraphOutputs,
  synthesizedArtifactMessage,
} from './architecture-graph-artifact.utils';

const artifactNode: ArchitectureSchemaNode = {
  id: 'artifact',
  label: 'Decision Artifact',
  kind: 'artifact',
  roleSlotId: 'finalizer',
};

const finalizerSlot: ArchitectureRoleSlot = {
  id: 'finalizer',
  label: 'Finalizer',
  description: 'Produces final artifact.',
  slotType: 'finalizer',
  defaultPersonaId: 'agent-finalizer',
  allowedPersonaTags: [],
  required: true,
  canOverrideAtRunStart: true,
};

function event(
  type: ArchitectureExecutionEvent['type'],
  message: string,
  fields: Partial<ArchitectureExecutionEvent> = {},
): ArchitectureExecutionEvent {
  return {
    id: `event-${type}-${fields.nodeId ?? fields.roleSlotId ?? 'none'}`,
    runId: 'run-artifact',
    sequence: 1,
    type,
    message,
    createdAt: 1,
    ...fields,
  };
}

describe('architecture graph artifact helpers', () => {
  it('synthesizes artifact copy from typed incoming runtime events only', () => {
    const message = synthesizedArtifactMessage({
      node: artifactNode,
      incomingEvents: [
        event('node_started', 'display-only start', { nodeId: 'start' }),
        event('participant_output', 'Role output.', { roleSlotId: 'analyst' }),
        event('router_decision', 'Router selected finalizer.', { nodeId: 'router' }),
        event('node_completed', 'display-only done', { nodeId: 'done' }),
      ],
    });

    expect(message).toBe([
      'Decision Artifact',
      '',
      'From analyst:',
      'Role output.',
      '',
      'From router:',
      'Router selected finalizer.',
    ].join('\n'));
  });

  it('builds typed final artifact evidence for synthesized artifact nodes', () => {
    const projection = finalArtifactFromSynthesizedGraphOutputs({
      node: artifactNode,
      incomingNodeIds: ['router'],
      incomingEvents: [],
      rootSessionId: 'root-session',
      personaId: 'agent-finalizer',
    });

    expect(projection).toEqual({
      message: 'Decision Artifact synthesized from graph execution.',
      options: expect.objectContaining({
        lifecycle: 'done',
        status: 'done',
        nodeId: 'artifact',
        roleSlotId: 'finalizer',
        reasonCode: 'final_artifact_accepted',
        evidence: [expect.objectContaining({
          kind: 'FINAL_ARTIFACT',
          source: 'finalizer',
          status: 'passed',
          data: expect.objectContaining({
            nodeId: 'artifact',
            roleSlotId: 'finalizer',
            rootSessionId: 'root-session',
          }),
        })],
        runtimeDecision: {
          status: 'done',
          accepted: true,
          reasonCode: 'final_artifact_accepted',
        },
        data: expect.objectContaining({
          incomingNodeIds: ['router'],
          personaId: 'agent-finalizer',
        }),
      }),
    });
  });

  it('builds typed final artifact evidence for role-owned finalizer output', () => {
    const projection = finalArtifactFromRoleResult({
      node: artifactNode,
      slot: finalizerSlot,
      branchSessionId: 'branch-finalizer',
      message: 'Final answer.',
      data: { artifactId: 'artifact-1' },
      incomingNodeIds: ['router'],
      outgoingNodeIds: [],
    });

    expect(projection.message).toBe('Final answer.');
    expect(projection.options).toEqual(expect.objectContaining({
      lifecycle: 'done',
      status: 'done',
      nodeId: 'artifact',
      roleSlotId: 'finalizer',
      reasonCode: 'final_artifact_accepted',
      evidence: [expect.objectContaining({
        kind: 'FINAL_ARTIFACT',
        source: 'finalizer',
        status: 'passed',
        data: expect.objectContaining({
          artifactId: 'artifact-1',
          branchSessionId: 'branch-finalizer',
        }),
      })],
      data: expect.objectContaining({
        artifactId: 'artifact-1',
        incomingNodeIds: ['router'],
        outgoingNodeIds: [],
      }),
    }));
  });
});
