import { describe, expect, it } from 'vitest';
import type { ArchitectureRoleSlot, ArchitectureSchemaNode } from '@kalio/types';
import { buildArchitectureSlotToolPolicy } from './architecture-slot-tool-policy';

describe('buildArchitectureSlotToolPolicy', () => {
  it('keeps the default orchestrator policy when a node tool override is absent', () => {
    const policy = buildArchitectureSlotToolPolicy({
      slot: orchestratorSlot,
      architectureContext: {
        projectPath: 'C:\\Projekty\\kalio-forever',
        allowArchitectureOrchestratorSubagents: true,
      },
    });

    expect(policy?.allowedToolNames).toEqual(expect.arrayContaining([
      'run_subagent',
      'spawn_cli_agent',
      'get_cli_agent_status',
      'fs_read',
      'fs_list',
    ]));
  });

  it('uses an explicit node tool override only for that node', () => {
    const node: Pick<ArchitectureSchemaNode, 'toolOverride'> = {
      toolOverride: {
        allowedToolNames: ['run_subagent', 'fs_read', 'fs_read'],
      },
    };

    const policy = buildArchitectureSlotToolPolicy({
      slot: orchestratorSlot,
      node,
      architectureContext: {
        projectPath: 'C:\\Projekty\\kalio-forever',
        allowArchitectureOrchestratorSubagents: true,
      },
    });

    expect(policy).toEqual({
      allowedToolNames: ['run_subagent', 'fs_read'],
    });
  });
});

const orchestratorSlot: ArchitectureRoleSlot = {
  id: 'orchestrator',
  label: 'Orchestrator',
  description: 'Routes work.',
  slotType: 'router',
  defaultPersonaId: 'agent-orchestrator',
  allowedPersonaTags: [],
  required: true,
  canOverrideAtRunStart: true,
};
