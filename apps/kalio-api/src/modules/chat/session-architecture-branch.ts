import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ArchitectureSchema, ChatSession, CreateSessionDto, ExecutionProfileLookupPort, SessionRuntimeContext } from '@kalio/types';
import type { SessionProfileAdmissionService } from './session-profile-admission.service';

/** Internal creation authority, never accepted as part of a public session DTO. */
export interface ArchitectureBranchSessionBinding {
  runId: string;
  rootSessionId: string;
  schema: Pick<ArchitectureSchema, 'id' | 'roleSlots'>;
  slotId: string;
  personaId: string;
  goalProtocol: boolean;
}
type Scope = { projectId: string; executionProfileId: string; runtimeContext?: SessionRuntimeContext | null };

export async function createArchitectureBranchSession(id: string, dto: CreateSessionDto,
  binding: ArchitectureBranchSessionBinding, ports: {
    admission: SessionProfileAdmissionService;
    parent: (id: string) => Promise<ChatSession>;
    personaProfile: (id: string) => Promise<string | undefined>;
    profiles?: ExecutionProfileLookupPort;
    scope: (dto: CreateSessionDto) => Promise<Scope>;
    register: (scope: Scope) => Promise<void>;
    persist: (scope: Scope) => ChatSession;
  }): Promise<ChatSession> {
  return ports.admission.runExclusive(binding.rootSessionId, async () => {
    const parent = await ports.parent(binding.rootSessionId);
    assertBinding(parent, dto, binding);
    if (!id.trim() || !ports.profiles) throw new ConflictException('Architecture branch profile lookup is unavailable.');
    const personaProfile = await ports.personaProfile(dto.personaId);
    if (personaProfile !== undefined && !personaProfile.trim()) throw new ConflictException('Architecture persona profile is invalid.');
    const selectedId = personaProfile ?? parent.executionProfileId!;
    const profile = await ports.profiles.assertEnabled(selectedId);
    if (profile.id !== selectedId) throw new ConflictException('Architecture profile lookup returned another profile.');
    if (profile.kind === 'direct-llm' && profile.provider === 'mock') throw new ConflictException('Mock architecture profiles are unavailable.');
    if (binding.goalProtocol && profile.id !== parent.executionProfileId) {
      throw new ConflictException('Goal receipt branches must retain their host execution profile.');
    }
    const scope = await ports.scope(dto);
    if (scope.projectId !== parent.projectId || scope.executionProfileId !== parent.executionProfileId) {
      throw new ConflictException('Architecture branch host scope changed.');
    }
    await ports.register(scope);
    if (await ports.personaProfile(dto.personaId) !== personaProfile) throw new ConflictException('Architecture persona profile changed.');
    const current = await ports.parent(binding.rootSessionId);
    assertBinding(current, dto, binding);
    if (current.executionProfileId !== parent.executionProfileId || current.projectId !== parent.projectId) {
      throw new ConflictException('Architecture branch host scope changed.');
    }
    return ports.persist({ ...scope, executionProfileId: profile.id });
  });
}

function assertBinding(parent: ChatSession, dto: CreateSessionDto, binding: ArchitectureBranchSessionBinding): void {
  const root = parent.runtimeContext?.architectureContext;
  const child = dto.runtimeContext;
  if (parent.id !== binding.rootSessionId || parent.runtimeContext?.runtimeKind !== 'agent-flow-root'
    || !parent.executionProfileId || !binding.runId || !binding.schema.id
    || root?.architectureRunId !== binding.runId || root.schemaId !== binding.schema.id
    || !binding.schema.roleSlots.some(slot => slot.id === binding.slotId)
    || dto.kind !== 'subagent' || dto.parentSessionId !== parent.id || dto.personaId !== binding.personaId
    || dto.executionProfileId !== undefined || child?.runtimeKind !== 'agent-flow-branch'
    || child.parentSessionId !== parent.id || child.architectureSlotId !== binding.slotId
    || child.architectureContext?.architectureRunId !== binding.runId
    || child.architectureContext.schemaId !== binding.schema.id || child.architectureContext.roleSlotId !== binding.slotId) {
    throw new BadRequestException('Invalid internal architecture branch binding.');
  }
}

export function resolveSessionProfileId(profiles: ExecutionProfileLookupPort | undefined,
  selection: Parameters<ExecutionProfileLookupPort['resolveId']>[0]): string {
  if (!profiles) throw new ConflictException('Execution profile selection is unavailable.');
  return profiles.resolveId(selection);
}
