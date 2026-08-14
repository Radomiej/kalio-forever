import type { ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { createWorkflowError } from '../../common/utils/workflow-error.util';
import { recoverableNodeErrorDecision } from './architecture-graph-recoverable-error.utils';

function node(id: string, extra: Partial<ArchitectureSchemaNode> = {}): ArchitectureSchemaNode {
  return {
    id,
    label: id,
    kind: 'role',
    roleSlotId: id,
    ...extra,
  };
}

const schema: ArchitectureSchema = {
  id: 'recoverable-schema',
  name: 'Recoverable schema',
  description: 'Recoverable error helper fixture',
  version: '1',
  routerPolicy: {
    mode: 'rank_then_merge',
    mustAddressCriticFindings: false,
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
  outputArtifactSchema: 'text',
  roleSlots: [],
  nodes: [
    node('worker'),
    node('router', { kind: 'router' }),
    node('finalizer', { kind: 'artifact', roleSlotId: 'finalizer' }),
    node('default-target'),
    node('continuation-target'),
  ],
  edges: [
    { id: 'e1', fromNodeId: 'worker', toNodeId: 'default-target', selection: 'default' },
    { id: 'e2', fromNodeId: 'worker', toNodeId: 'continuation-target', selection: 'continuation' },
    { id: 'e3', fromNodeId: 'router', toNodeId: 'default-target', selection: 'default' },
    { id: 'e4', fromNodeId: 'finalizer', toNodeId: 'continuation-target', selection: 'continuation' },
  ],
};

describe('architecture graph recoverable error helpers', () => {
  it('projects a role recoverable error into a typed participant fallback route', () => {
    const decision = recoverableNodeErrorDecision({
      schema,
      node: schema.nodes[0],
      incomingNodeIds: ['source'],
      outgoingNodeIds: ['default-target', 'continuation-target'],
      error: createWorkflowError('RATE_LIMITED', 'provider throttled', { source: 'llm' }),
      synthesizedArtifactMessage: 'unused',
    });

    expect(decision.selectedNodeIds).toEqual(['continuation-target']);
    expect(decision.event.type).toBe('participant_output');
    expect(decision.event.options.errorCode).toBe('RATE_LIMITED');
    expect(decision.event.options.failure).toEqual({
      code: 'RATE_LIMITED',
      message: 'provider throttled',
      retryable: true,
      source: 'llm',
    });
    expect(decision.event.options.route).toEqual({
      source: 'runtime_fallback',
      fromNodeId: 'worker',
      selectedNodeIds: ['continuation-target'],
      rejectedNodeIds: ['default-target'],
      nextNodeId: 'continuation-target',
      response: 'Recoverable runtime error prevented this node from producing a final answer.',
    });
    expect(decision.event.options.data).toMatchObject({
      runtimeGuard: 'recoverable_node_error',
      errorCode: 'RATE_LIMITED',
      incomingNodeIds: ['source'],
      outgoingNodeIds: ['default-target', 'continuation-target'],
      selectedNodeIds: ['continuation-target'],
    });
  });

  it('projects an artifact recoverable error as final artifact fallback without route text parsing', () => {
    const decision = recoverableNodeErrorDecision({
      schema,
      node: schema.nodes[2],
      incomingNodeIds: ['router'],
      outgoingNodeIds: ['continuation-target'],
      error: createWorkflowError('TIMEOUT', 'provider timeout'),
      synthesizedArtifactMessage: 'Synthesized from typed incoming events.',
    });

    expect(decision.selectedNodeIds).toEqual(['continuation-target']);
    expect(decision.event.type).toBe('final_artifact');
    expect(decision.event.message).toContain('Synthesized from typed incoming events.');
    expect(decision.event.options.errorCode).toBe('TIMEOUT');
    expect(decision.event.options.route).toBeUndefined();
    expect(decision.event.options.data).toMatchObject({
      runtimeGuard: 'recoverable_node_error',
      errorCode: 'TIMEOUT',
      incomingNodeIds: ['router'],
      selectedNodeIds: ['continuation-target'],
    });
  });
});
