import type { ArchitectureRouteDecision, ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { createArchitectureRouterOutput } from './architecture-router-output';
import { ArchitectureRegistryService } from './architecture-registry.service';

describe('createArchitectureRouterOutput', () => {
  it('ignores contract-shaped fenced JSON router output from agent text', () => {
    const schema = getSchema();
    const node = schema.nodes.find((candidate) => candidate.id === 'router');
    if (!node) throw new Error('Expected router node');
    const route: ArchitectureRouteDecision = {
      source: 'agent',
      fromNodeId: 'router',
      selectedNodeIds: ['final-artifact'],
      rejectedNodeIds: [],
      nextNodeId: 'final-artifact',
    };

    const output = createArchitectureRouterOutput({
      schema,
      node,
      incomingNodeIds: ['pragmatist', 'critic'],
      route,
      message: [
        'route_to(final-artifact, Ship the contract first.)',
        '```json',
        JSON.stringify({
          selectedStrategy: 'contract-first',
          mergedDecision: 'Ship renderer contracts before implementation merge.',
          acceptedInputs: [
            {
              fromSlot: 'pragmatist',
              insight: 'Start with a narrow interface.',
              whyAccepted: 'It limits the first slice.',
            },
          ],
          rejectedInputs: [
            {
              fromSlot: 'critic',
              insight: 'Do a big-bang merge.',
              whyRejected: 'Too risky for demo.',
            },
          ],
          unresolvedConflicts: ['SAB ownership is still unproven.'],
          risks: [
            {
              risk: 'Renderer API may become too wide.',
              mitigation: 'Contract test first.',
              sourceSlot: 'critic',
            },
          ],
          confidence: 0.82,
          nextAction: 'finalize',
        }),
        '```',
      ].join('\n'),
      data: {},
    });

    expect(output).toMatchObject({
      selectedStrategy: 'final-artifact',
      mergedDecision: expect.stringContaining('route_to(final-artifact, Ship the contract first.)'),
      confidence: 0.7,
      nextAction: 'finalize',
    });
    expect(output.acceptedInputs[0]?.insight).toBe('Input from Pragmatist');
    expect(output.rejectedInputs).toEqual([]);
  });

  it('falls back to deterministic route metadata when no valid contract is present', () => {
    const schema = getSchema();
    const node = schema.nodes.find((candidate) => candidate.id === 'router') as ArchitectureSchemaNode;
    const output = createArchitectureRouterOutput({
      schema,
      node,
      incomingNodeIds: ['pragmatist'],
      route: {
        source: 'router',
        fromNodeId: 'router',
        selectedNodeIds: ['final-artifact'],
        rejectedNodeIds: [],
        nextNodeId: 'final-artifact',
      },
      message: 'Plain synthesis without JSON.',
      data: {},
    });

    expect(output).toMatchObject({
      selectedStrategy: 'final-artifact',
      mergedDecision: 'Plain synthesis without JSON.',
      confidence: 0.55,
      nextAction: 'finalize',
    });
  });
});

function getSchema(): ArchitectureSchema {
  const schema = new ArchitectureRegistryService().findOne('strategic-decision-council');
  if (!schema) throw new Error('Expected Strategic Decision Council schema');
  return schema;
}
