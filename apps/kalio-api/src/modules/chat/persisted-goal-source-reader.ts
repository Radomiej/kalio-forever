import { Injectable } from '@nestjs/common';
import type { ArchitectureGoalSourceV1 } from '@kalio/types';
import { and, eq } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { messages } from '../../database/schema';

type SourceLocator = Pick<ArchitectureGoalSourceV1, 'sessionId' | 'messageId' | 'turnId'>;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

@Injectable()
export class PersistedGoalSourceReader {
  constructor(private readonly drizzle: DrizzleService) {}

  async read(locator: SourceLocator): Promise<ArchitectureGoalSourceV1 | null> {
    if (!locator || !nonempty(locator.sessionId) || !nonempty(locator.messageId) || !nonempty(locator.turnId)) {
      throw new Error('GOAL_SOURCE_INVALID.');
    }
    let row;
    try {
      row = this.drizzle.db.select({
        messageId: messages.id, sessionId: messages.sessionId, turnId: messages.turnId,
        content: messages.content, createdAt: messages.createdAt,
      }).from(messages).where(and(
        eq(messages.id, locator.messageId), eq(messages.sessionId, locator.sessionId),
        eq(messages.turnId, locator.turnId), eq(messages.role, 'user'),
      )).get();
    } catch {
      throw new Error('GOAL_SOURCE_STORAGE_ERROR.');
    }
    if (!row) return null;
    const createdAt = row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt;
    if (!nonempty(row.content) || row.turnId !== locator.turnId || !Number.isFinite(createdAt)) {
      throw new Error('GOAL_SOURCE_INVALID.');
    }
    return { messageId: row.messageId, sessionId: row.sessionId, turnId: locator.turnId, content: row.content, createdAt };
  }
}
