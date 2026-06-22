import type { ChatMessage } from '@kalio/types';

export interface SessionMessagePageOptions {
  limit?: number;
  beforeMessageId?: string;
}

export interface SessionMessagePage {
  messages: ChatMessage[];
  totalCount: number;
  hasMoreBefore: boolean;
  oldestLoadedMessageId: string | null;
}

/**
 * Repository interface for chat message persistence.
 * Concrete implementations: DrizzleMessageRepository (production),
 * InMemoryMessageRepository (tests/standalone).
 */
export interface IMessageRepository {
  /**
   * Creates the session row if it does not already exist.
  * Must be called before saveMessage() to satisfy FK constraints.
  */
  ensureSession(sessionId: string, personaId: string): Promise<void>;
  loadHistory(sessionId: string): Promise<ChatMessage[]>;
  loadHistoryPage(sessionId: string, options?: SessionMessagePageOptions): Promise<SessionMessagePage>;
  saveMessage(msg: ChatMessage): Promise<void>;
}
