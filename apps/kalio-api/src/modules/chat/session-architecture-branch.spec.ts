import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureSchema, ChatSession, CreateSessionDto, ExecutionProfileLookupPort } from '@kalio/types';
import { SessionProfileAdmissionService } from './session-profile-admission.service';
import { createArchitectureBranchSession } from './session-architecture-branch';

function fixture() {
  const schema = { id: 'schema', roleSlots: [{ id: 'core', defaultPersonaId: 'worker' }] } as Pick<ArchitectureSchema, 'id' | 'roleSlots'>;
  const parent: ChatSession = { id: 'root', personaId: 'default', title: 'Workflow', kind: 'chat', projectId: 'project',
    executionProfileId: 'sol', createdAt: 1, updatedAt: 1,
    runtimeContext: { runtimeKind: 'agent-flow-root', architectureContext: { architectureRunId: 'run', schemaId: 'schema' } } };
  const dto: CreateSessionDto = { personaId: 'worker', kind: 'subagent', parentSessionId: 'root',
    runtimeContext: { runtimeKind: 'agent-flow-branch', parentSessionId: 'root', architectureSlotId: 'core',
      architectureContext: { architectureRunId: 'run', schemaId: 'schema', roleSlotId: 'core' } } };
  const binding = { runId: 'run', rootSessionId: 'root', schema, slotId: 'core', personaId: 'worker', goalProtocol: false };
  const ports = { admission: new SessionProfileAdmissionService(), parent: vi.fn(async () => structuredClone(parent)),
    personaProfile: vi.fn(async () => 'swe' as string | undefined),
    profiles: { assertEnabled: vi.fn(async (id: string) => ({ id, kind: 'devin-cli-acp', model: 'swe-2-high' })) } as unknown as ExecutionProfileLookupPort,
    scope: vi.fn(async () => ({ projectId: 'project', executionProfileId: 'sol', runtimeContext: dto.runtimeContext })),
    register: vi.fn(async () => undefined),
    persist: vi.fn((scope: { executionProfileId: string }) => ({ ...parent, ...dto, id: 'child', executionProfileId: scope.executionProfileId } as ChatSession)),
  };
  return { parent, dto, binding, ports, create: () => createArchitectureBranchSession('child', dto, binding, ports) };
}

describe('internal architecture branch profile admission', () => {
  it.each(['sol', 'swe', 'flash'])('binds the saved persona profile %s, not the host profile', async profile => {
    const f = fixture(); f.ports.personaProfile.mockResolvedValue(profile);
    expect((await f.create()).executionProfileId).toBe(profile);
    expect(f.ports.profiles.assertEnabled).toHaveBeenCalledWith(profile);
    expect(f.ports.persist).toHaveBeenCalledOnce();
  });
  it('inherits the host when the persona has no profile', async () => {
    const f = fixture(); f.ports.personaProfile.mockResolvedValue(undefined);
    expect((await f.create()).executionProfileId).toBe('sol');
  });
  it.each(['parent', 'run', 'schema', 'slot', 'persona', 'kind', 'root-kind', 'explicit-profile'] as const)('rejects invalid %s linkage without insertion', async field => {
    const f = fixture();
    if (field === 'parent') f.dto.parentSessionId = 'other';
    if (field === 'run') f.dto.runtimeContext!.architectureContext!.architectureRunId = 'other';
    if (field === 'schema') f.binding.schema.id = 'other';
    if (field === 'slot') f.binding.slotId = 'other';
    if (field === 'persona') f.dto.personaId = 'other';
    if (field === 'kind') f.dto.kind = 'chat';
    if (field === 'root-kind') f.parent.runtimeContext!.runtimeKind = 'chat';
    if (field === 'explicit-profile') f.dto.executionProfileId = 'caller-selected';
    await expect(f.create()).rejects.toThrow(); expect(f.ports.persist).not.toHaveBeenCalled();
  });
  it('rejects disabled profiles, never falling back', async () => {
    const f = fixture(); vi.mocked(f.ports.profiles.assertEnabled).mockRejectedValue(new Error('Disabled'));
    await expect(f.create()).rejects.toThrow('Disabled'); expect(f.ports.persist).not.toHaveBeenCalled();
  });
  it('rejects mock profiles', async () => {
    const f = fixture(); vi.mocked(f.ports.profiles.assertEnabled).mockResolvedValue({ id: 'swe', kind: 'direct-llm', provider: 'mock' } as never);
    await expect(f.create()).rejects.toThrow(); expect(f.ports.persist).not.toHaveBeenCalled();
  });
  it('rejects a mixed Goal receipt profile while retaining a same-profile Goal branch', async () => {
    const f = fixture(); f.binding.goalProtocol = true;
    await expect(f.create()).rejects.toThrow(); expect(f.ports.persist).not.toHaveBeenCalled();
    f.ports.personaProfile.mockResolvedValue('sol'); expect((await f.create()).executionProfileId).toBe('sol');
  });
  it('rejects persona changes or parent scope changes during awaited registration', async () => {
    for (const change of ['persona', 'parent']) {
      const f = fixture(); f.ports.register.mockImplementation(async () => {
        if (change === 'persona') f.ports.personaProfile.mockResolvedValue('flash');
        else f.parent.executionProfileId = 'changed';
      });
      await expect(f.create()).rejects.toThrow(); expect(f.ports.persist).not.toHaveBeenCalled();
    }
  });
});
