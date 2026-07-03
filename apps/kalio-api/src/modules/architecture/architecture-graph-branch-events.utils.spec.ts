import type { ArchitectureRoleSlot, ArchitectureSchemaNode } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { architectureBranchStreamProjection } from './architecture-graph-branch-events.utils';

const node: ArchitectureSchemaNode = {
  id: 'implementer-node',
  label: 'Implementer Node',
  kind: 'role',
  roleSlotId: 'implementer',
};

const slot: ArchitectureRoleSlot = {
  id: 'implementer',
  label: 'Implementer',
  description: 'Writes implementation evidence',
  slotType: 'tool_executor',
  defaultPersonaId: 'persona-implementer',
  allowedPersonaTags: [],
  required: true,
  canOverrideAtRunStart: true,
};

describe('architecture branch stream event projection', () => {
  it('ignores high-volume stream lifecycle events', () => {
    expect(architectureBranchStreamProjection({ node, slot, event: 'chat:chunk', data: { text: 'ignored' } }))
      .toBeUndefined();
    expect(architectureBranchStreamProjection({ node, slot, event: 'agent:done', data: {} }))
      .toBeUndefined();
  });

  it('projects tool confirmation requests as typed human gate events', () => {
    const projection = architectureBranchStreamProjection({
      node,
      slot,
      event: 'tool:confirmation_required',
      data: {
        sessionId: 'child-1',
        callId: 'call-1',
        toolName: 'fs_write',
        requestedBy: 'implementer',
        args: { path: 'architecture.md' },
      },
    });

    expect(projection).toMatchObject({
      type: 'human_gate',
      message: 'Implementer requested HITL approval for fs_write.',
      options: {
        actionSummary: 'Waiting for tool confirmation.',
        nodeId: 'implementer-node',
        roleSlotId: 'implementer',
        data: {
          kind: 'branch_stream',
          event: 'tool:confirmation_required',
          sessionId: 'child-1',
          callId: 'call-1',
          toolName: 'fs_write',
          requestedBy: 'implementer',
          toolPath: 'architecture.md',
        },
      },
    });
  });

  it('projects budget requests with structured usage data', () => {
    const projection = architectureBranchStreamProjection({
      node,
      slot,
      event: 'agent:budget_required',
      data: {
        usedIterations: 30,
        currentLimit: 30,
        suggestedNextLimit: 40,
      },
    });

    expect(projection).toMatchObject({
      type: 'human_gate',
      message: 'Implementer requested more tool budget (30/30).',
      options: {
        actionSummary: 'Waiting for budget approval.',
        data: {
          usedIterations: 30,
          currentLimit: 30,
          suggestedNextLimit: 40,
        },
      },
    });
  });

  it('projects tool results and errors without parsing display text', () => {
    expect(architectureBranchStreamProjection({
      node,
      slot,
      event: 'tool:result',
      data: { toolName: 'fs_read', status: 'completed' },
    })).toMatchObject({
      type: 'tool_call',
      message: 'Implementer fs_read completed.',
      options: {
        data: {
          toolName: 'fs_read',
          status: 'completed',
        },
      },
    });

    expect(architectureBranchStreamProjection({
      node,
      slot,
      event: 'chat:error',
      data: { errorMessage: 'provider timeout' },
    })).toMatchObject({
      type: 'tool_call',
      message: 'Implementer branch error: provider timeout.',
      options: {
        data: {
          errorMessage: 'provider timeout',
        },
      },
    });
  });
});
