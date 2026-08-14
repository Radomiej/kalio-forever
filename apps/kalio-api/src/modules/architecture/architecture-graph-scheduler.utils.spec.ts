import { describe, expect, it } from 'vitest';
import {
  partitionReadyNodesByVisitLimit,
  runtimeLimitDecisionForPendingNodes,
} from './architecture-graph-scheduler.utils';

describe('architecture graph scheduler helpers', () => {
  it('partitions ready nodes by typed visit limits', () => {
    const result = partitionReadyNodesByVisitLimit({
      nodes: [{ id: 'router' }, { id: 'worker' }, { id: 'finalizer' }],
      maxNodeVisits: 2,
      visitCount: (nodeId) => ({ router: 2, worker: 1, finalizer: 3 }[nodeId] ?? 0),
    });

    expect(result.executableNodes).toEqual([{ id: 'worker' }]);
    expect(result.blockedNodeIds).toEqual(['router', 'finalizer']);
  });

  it('builds a max-node-visits terminal decision when ready nodes are only blocked by visit limits', () => {
    expect(runtimeLimitDecisionForPendingNodes({
      readyNodeIds: [],
      maxVisitBlockedNodeIds: ['worker'],
      maxSteps: 10,
      maxNodeVisits: 1,
      visitCounts: { worker: 1 },
    })).toEqual({
      reasonCode: 'max_node_visits',
      message: 'Runtime stopped after reaching max node visits.',
      pendingNodeIds: ['worker'],
      data: {
        reasonCode: 'max_node_visits',
        maxNodeVisits: 1,
        maxSteps: 10,
        pendingNodeIds: ['worker'],
        visitCounts: { worker: 1 },
      },
    });
  });

  it('prefers max-steps terminal decisions while ready nodes remain queued', () => {
    expect(runtimeLimitDecisionForPendingNodes({
      readyNodeIds: ['router'],
      maxVisitBlockedNodeIds: ['worker'],
      maxSteps: 3,
      maxNodeVisits: 2,
      visitCounts: { router: 1, worker: 2 },
    })).toEqual({
      reasonCode: 'max_steps',
      message: 'Runtime stopped after 3 graph steps.',
      pendingNodeIds: ['router'],
      data: {
        reasonCode: 'max_steps',
        maxNodeVisits: 2,
        maxSteps: 3,
        pendingNodeIds: ['router'],
        visitCounts: { router: 1, worker: 2 },
      },
    });
  });

  it('returns null when no pending work is left', () => {
    expect(runtimeLimitDecisionForPendingNodes({
      readyNodeIds: [],
      maxVisitBlockedNodeIds: [],
      maxSteps: 3,
      maxNodeVisits: 2,
      visitCounts: {},
    })).toBeNull();
  });
});
