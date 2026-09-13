import { ConflictException } from '@nestjs/common';
import type { IMessageRepository } from './interfaces/message-repository.interface';

const PROFILE_CHANGE_CONFLICT = 'A session is bound to another execution profile; create a new chat to change it.';

export async function resolvePersonaExecutionProfileChange(
  repository: Pick<IMessageRepository, 'loadHistory'>,
  sessionId: string,
  currentProfileId: string | undefined,
  nextProfileId: string | undefined,
): Promise<string | undefined> {
  if (!nextProfileId || nextProfileId === currentProfileId) {
    return undefined;
  }

  if (currentProfileId && (await repository.loadHistory(sessionId)).length > 0) {
    throw new ConflictException(PROFILE_CHANGE_CONFLICT);
  }

  return nextProfileId;
}
