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

function createService(): ContextAssemblyService {
  return new ContextAssemblyService(
    { getSessionConfig: vi.fn().mockResolvedValue(personaConfig) } as unknown as PersonaService,
    { findByIds: vi.fn().mockResolvedValue([]) } as unknown as SkillsService,
    { decide: vi.fn().mockResolvedValue({ tools: [], warnings: [] }) } as unknown as ToolPolicyService,
  );
}

describe('ContextAssemblyService AgentFlow model contract', () => {
  it('inherits the active provider model instead of applying a persona-only model', async () => {
    const assembled = await createService().assembleForRuntime({
      runtimeKind: 'agent-flow-branch',
      personaId: 'agent-orchestrator',
      toolPolicyRequest: { runtimeKind: 'agent-flow-branch', personaId: 'agent-orchestrator' },
    });

    expect(assembled.model).toBe('');
  });

  it('keeps an explicit run-level model override', async () => {
    const assembled = await createService().assembleForRuntime({
      runtimeKind: 'agent-flow-branch',
      personaId: 'agent-orchestrator',
      modelOverride: 'workflow-model',
      toolPolicyRequest: { runtimeKind: 'agent-flow-branch', personaId: 'agent-orchestrator' },
    });

    expect(assembled.model).toBe('workflow-model');
  });
});
