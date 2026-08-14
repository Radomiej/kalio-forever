import { describe, expect, it, vi } from 'vitest';
import type { PersonaSessionConfig } from '@kalio/types';
import { ContextAssemblyService } from './context-assembly.service';
import type { PersonaService } from '../persona/persona.service';
import type { SkillsService } from '../skills/skills.service';
import type { ToolPolicyService } from './tool-policy.service';

const personaConfig: PersonaSessionConfig = {
  systemPrompt: 'Workflow persona',
  model: 'mimo-v2.5-pro',
  allowedTools: [],
  skillIds: [],
  mcpPolicy: 'deny_all',
  kv: {},
};

function createService(): { service: ContextAssemblyService; decide: ReturnType<typeof vi.fn> } {
  const decide = vi.fn().mockResolvedValue({ tools: [], warnings: [] });
  const service = new ContextAssemblyService(
    { getSessionConfig: vi.fn().mockResolvedValue(personaConfig) } as unknown as PersonaService,
    { findByIds: vi.fn().mockResolvedValue([]) } as unknown as SkillsService,
    { decide } as unknown as ToolPolicyService,
  );
  return { service, decide };
}

describe('ContextAssemblyService AgentFlow model contract', () => {
  it('inherits the active provider model instead of applying a persona-only model', async () => {
    const { service } = createService();
    const assembled = await service.assembleForRuntime({
      runtimeKind: 'agent-flow-branch',
      personaId: 'agent-orchestrator',
      toolPolicyRequest: { runtimeKind: 'agent-flow-branch', personaId: 'agent-orchestrator' },
    });

    expect(assembled.model).toBe('');
  });

  it('keeps an explicit run-level model override', async () => {
    const { service } = createService();
    const assembled = await service.assembleForRuntime({
      runtimeKind: 'agent-flow-branch',
      personaId: 'agent-orchestrator',
      modelOverride: 'workflow-model',
      toolPolicyRequest: { runtimeKind: 'agent-flow-branch', personaId: 'agent-orchestrator' },
    });

    expect(assembled.model).toBe('workflow-model');
  });

  it('keeps the branch model blank on the session-runtime path when no override is provided', async () => {
    const { service } = createService();
    const assembled = await service.assembleForSessionRuntime('agent-orchestrator', {
      runtimeKind: 'agent-flow-branch',
      explicitToolNames: [],
      architectureContext: { architectureRunId: 'run-1' },
    });

    expect(assembled.runtimeKind).toBe('agent-flow-branch');
    expect(assembled.model).toBe('');
  });

  it('forwards architectureSlotPolicy through the session-runtime branch path', async () => {
    const { service, decide } = createService();
    const slotPolicy = { allowedToolNames: ['vfs_read'] };

    await service.assembleForSessionRuntime('agent-orchestrator', {
      runtimeKind: 'agent-flow-branch',
      explicitToolNames: ['vfs_read'],
      architectureContext: { architectureRunId: 'run-1' },
      architectureSlotPolicy: slotPolicy,
    });

    expect(decide).toHaveBeenCalledWith(expect.objectContaining({
      runtimeKind: 'agent-flow-branch',
      personaId: 'agent-orchestrator',
      explicitToolNames: ['vfs_read'],
      architectureContext: { architectureRunId: 'run-1' },
      slotPolicy,
    }));
  });
});
