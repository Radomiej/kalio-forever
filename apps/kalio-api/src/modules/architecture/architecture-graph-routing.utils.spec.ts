import type { ArchitectureRouterOutput, ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import {
  continuationOutgoingNodeId,
  defaultOutgoingNodeId,
  isRouterPauseAction,
  routeConvergeNodeId,
  routerActionTargetNodeId,
  routerOutputWithActionTarget,
  routerPauseActionSummary,
  routingMessage,
  selectedOutgoingNodeIds,
  selectedRoleOutgoingNodeIds,
} from './architecture-graph-routing.utils';

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
  id: 'schema-routing',
  name: 'Routing Test',
  description: 'Routing helper fixture',
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
  nodes: [
    node('router', { kind: 'router', behavior: { mode: 'choose_one' } }),
    node('parallel', { kind: 'parallel', behavior: { mode: 'fan_out_all' } }),
    node('branch-a'),
    node('branch-b'),
    node('final'),
    node('continuation'),
  ],
  edges: [
    { id: 'e1', fromNodeId: 'router', toNodeId: 'branch-a', selection: 'default' },
    { id: 'e2', fromNodeId: 'router', toNodeId: 'final', selection: 'converge' },
    { id: 'e3', fromNodeId: 'router', toNodeId: 'continuation', selection: 'continuation' },
    { id: 'e4', fromNodeId: 'parallel', toNodeId: 'branch-a' },
    { id: 'e5', fromNodeId: 'parallel', toNodeId: 'branch-b' },
    { id: 'e6', fromNodeId: 'branch-a', toNodeId: 'final', selection: 'converge' },
    { id: 'e7', fromNodeId: 'branch-b', toNodeId: 'final', selection: 'converge' },
  ],
  roleSlots: [],
};

describe('architecture graph routing helpers', () => {
  it('selects explicit default edge for choose-one routing', () => {
    expect(selectedOutgoingNodeIds({
      schema,
      node: schema.nodes[0],
      outgoingNodeIds: ['final', 'branch-a'],
    })).toEqual(['branch-a']);
    expect(defaultOutgoingNodeId(schema, 'router', ['final', 'branch-a'])).toBe('branch-a');
  });

  it('finds continuation and converge targets from typed edge selection', () => {
    expect(continuationOutgoingNodeId({
      schema,
      sourceNodeId: 'router',
      incomingNodeIds: ['branch-a'],
      outgoingNodeIds: ['branch-a', 'final', 'continuation'],
      defaultNodeId: 'branch-a',
    })).toBe('continuation');
    expect(routeConvergeNodeId({ schema, node: schema.nodes[0], outgoingNodeIds: ['final', 'branch-a'] })).toBe('final');
  });

  it('detects a shared branch converge target for fan-out nodes', () => {
    expect(routeConvergeNodeId({
      schema,
      node: schema.nodes[1],
      outgoingNodeIds: ['branch-a', 'branch-b'],
    })).toBe('final');
  });

  it('honors structured route_to target without parsing display text', () => {
    const routerOutput: ArchitectureRouterOutput = {
      selectedStrategy: 'final',
      mergedDecision: 'route by typed target',
      acceptedInputs: [],
      rejectedInputs: [],
      unresolvedConflicts: [],
      risks: [],
      confidence: 0.9,
      nextAction: 'route_to',
      targetNodeId: 'final',
      response: 'route by typed target',
    };
    expect(selectedRoleOutgoingNodeIds({
      data: { routerOutput },
      outgoingNodeIds: ['branch-a', 'final'],
    })).toEqual(['final']);
  });

  it('selects run-more-research targets from typed router output and continuation edges', () => {
    const routerOutput: ArchitectureRouterOutput = {
      selectedStrategy: 'more research',
      mergedDecision: 'need one more check',
      acceptedInputs: [],
      rejectedInputs: [],
      unresolvedConflicts: [],
      risks: [],
      confidence: 0.7,
      nextAction: 'run_more_research',
      targetNodeId: 'branch-b',
    };
    expect(routerActionTargetNodeId({
      schema,
      routerOutput,
      sourceNodeId: 'router',
      outgoingNodeIds: ['branch-a', 'branch-b', 'continuation'],
    })).toBe('branch-b');
    expect(routerActionTargetNodeId({
      schema,
      routerOutput: { ...routerOutput, targetNodeId: 'not-outgoing' },
      sourceNodeId: 'router',
      outgoingNodeIds: ['branch-a', 'final', 'continuation'],
    })).toBe('continuation');
    expect(routerActionTargetNodeId({
      schema,
      routerOutput: { ...routerOutput, nextAction: 'route_to', targetNodeId: 'branch-b' },
      sourceNodeId: 'router',
      outgoingNodeIds: ['branch-a', 'branch-b', 'continuation'],
    })).toBeUndefined();
  });

  it('keeps router pause decisions typed by nextAction', () => {
    expect(isRouterPauseAction('ask_human')).toBe(true);
    expect(isRouterPauseAction('rerun_with_different_personas')).toBe(true);
    expect(isRouterPauseAction('run_more_research')).toBe(false);
    expect(routerPauseActionSummary('rerun_with_different_personas'))
      .toBe('Waiting for orchestrator persona rerun decision.');
    expect(routerPauseActionSummary('ask_human'))
      .toBe('Waiting for human routing decision.');
  });

  it('preserves router output while adding a typed action target', () => {
    const routerOutput: ArchitectureRouterOutput = {
      selectedStrategy: 'old',
      mergedDecision: 'need continuation',
      acceptedInputs: [],
      rejectedInputs: [],
      unresolvedConflicts: [],
      risks: [],
      confidence: 0.7,
      nextAction: 'run_more_research',
    };
    expect(routerOutputWithActionTarget(routerOutput, 'continuation')).toEqual({
      ...routerOutput,
      selectedStrategy: 'continuation',
      targetNodeId: 'continuation',
    });
  });

  it('keeps routing message as display-only formatting', () => {
    expect(routingMessage({ ...schema.nodes[1], label: 'Parallel' }, 'Finalizer', 2))
      .toBe('Parallel started 2 outgoing paths.');
    expect(routingMessage({ ...schema.nodes[0], label: 'Router' }, 'Finalizer', 1))
      .toBe('Router selected Finalizer.');
  });
});
