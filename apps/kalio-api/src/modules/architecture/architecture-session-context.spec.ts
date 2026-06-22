import { describe, expect, it } from 'vitest';
import type { ArchitectureRoleSlot } from '@kalio/types';
import {
  createArchitectureBranchSessionRuntimeContext,
  createArchitectureRootSessionRuntimeContext,
  getArchitectureHistorySessionId,
} from './architecture-session-context';

function roleSlot(overrides: Pick<ArchitectureRoleSlot, 'id' | 'label' | 'slotType'>): ArchitectureRoleSlot {
  return {
    description: `${overrides.label} test slot`,
    defaultPersonaId: 'default',
    allowedPersonaTags: [],
    required: true,
    canOverrideAtRunStart: true,
    ...overrides,
  };
}

describe('architecture-session-context', () => {
  it('marks root workflow sessions as hidden technical nodes', () => {
    const context = createArchitectureRootSessionRuntimeContext({
      runId: 'run-root',
      schemaId: 'strategic-decision-council',
      schemaName: 'Strategic Decision Council',
      hostSessionId: 'host-1',
      historySessionId: 'history-1',
    });

    expect(context).toMatchObject({
      runtimeKind: 'agent-flow-root',
      architectureContext: {
        architectureRunId: 'run-root',
        schemaId: 'strategic-decision-council',
        schemaName: 'Strategic Decision Council',
        displayLabel: 'Strategic Decision Council',
        hostSessionId: 'host-1',
        historySessionId: 'history-1',
        sessionSurface: 'technical-node',
        conversationVisibility: 'hidden',
      },
    });
  });

  it('marks branch workflow sessions as visible and preserves slot-derived surface', () => {
    const routerContext = createArchitectureBranchSessionRuntimeContext({
      runId: 'run-router',
      schemaId: 'strategic-decision-council',
      schemaName: 'Strategic Decision Council',
      rootSessionId: 'arch-root',
      slot: roleSlot({
        id: 'router',
        label: 'Router',
        slotType: 'router',
      }),
    });
    const participantContext = createArchitectureBranchSessionRuntimeContext({
      runId: 'run-participant',
      schemaId: 'strategic-decision-council',
      schemaName: 'Strategic Decision Council',
      rootSessionId: 'arch-root',
      slot: roleSlot({
        id: 'analyst',
        label: 'Analyst',
        slotType: 'participant',
      }),
    });

    expect(routerContext).toMatchObject({
      runtimeKind: 'agent-flow-branch',
      parentSessionId: 'arch-root',
      architectureSlotId: 'router',
      architectureContext: {
        roleSlotId: 'router',
        roleSlotType: 'router',
        displayLabel: 'Router',
        sessionSurface: 'technical-node',
        conversationVisibility: 'visible',
      },
    });
    expect(participantContext).toMatchObject({
      runtimeKind: 'agent-flow-branch',
      parentSessionId: 'arch-root',
      architectureSlotId: 'analyst',
      architectureContext: {
        roleSlotId: 'analyst',
        roleSlotType: 'participant',
        displayLabel: 'Analyst',
        sessionSurface: 'conversation-branch',
        conversationVisibility: 'visible',
      },
    });
  });

  it('falls back from history session id to host session id', () => {
    expect(getArchitectureHistorySessionId({
      hostSessionId: 'host-1',
    })).toBe('host-1');
  });
});
