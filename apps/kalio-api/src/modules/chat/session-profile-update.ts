import { ConflictException } from '@nestjs/common';
import type { ChatSession, ExecutionProfileLookupPort } from '@kalio/types';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import { resolvePersonaExecutionProfileChange } from './session-profile-binding.utils';

export async function prepareSessionProfileUpdate(input: {
  current: ChatSession;
  patch: { personaId?: string; executionProfileId?: string };
  repository: IMessageRepository;
  profiles?: ExecutionProfileLookupPort;
  personaProfile: (id: string) => Promise<string | undefined>;
  assertMutable: () => void;
}): Promise<string | undefined> {
  const { current, patch, repository, profiles, assertMutable } = input;
  let target = patch.executionProfileId;
  const explicit = target !== undefined;
  if (!explicit && patch.personaId !== undefined && patch.personaId !== current.personaId) {
    target = await input.personaProfile(patch.personaId);
  }
  if (target === undefined || (!explicit && !target) || target === current.executionProfileId) return undefined;
  if (current.parentSessionId) throw new ConflictException('A child session must use its host execution profile.');
  assertMutable();
  if (explicit) {
    if ((await repository.loadHistory(current.id)).length > 0) {
      throw new ConflictException('Execution profile cannot change after a conversation has started. Create a new chat to choose another provider/model.');
    }
  } else {
    await resolvePersonaExecutionProfileChange(repository, current.id, current.executionProfileId, target);
  }
  if (!profiles) throw new ConflictException('Execution profile selection is unavailable.');
  const selected = await profiles.assertEnabled(target);
  if (selected.kind === 'direct-llm' && selected.provider === 'mock') {
    throw new ConflictException('Mock execution profiles are not available for user conversations.');
  }
  assertMutable();
  return selected.id;
}
