import { Injectable, Inject } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ChatMessage, LLMMessage } from '@kalio/types';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import type { TurnState } from './turn-state';
import { MESSAGE_REPOSITORY } from './chat.tokens';

/**
 * Manages chat message persistence and history conversion.
 * Uses IMessageRepository — swap implementations for tests vs production.
 */
@Injectable()
export class SessionManagerService {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
  ) {}

  /** Upserts the session row so FK constraints are satisfied before message inserts. */
  async ensureSession(sessionId: string, personaId: string): Promise<void> {
    await this.repo.ensureSession(sessionId, personaId);
  }

  async loadHistory(sessionId: string): Promise<LLMMessage[]> {
    const messages = await this.repo.loadHistory(sessionId);
    return messages.flatMap(m => this.toChatMessages(m));
  }

  async persistUserMessage(sessionId: string, content: string): Promise<ChatMessage> {
    const msg: ChatMessage = {
      id: nanoid(),
      sessionId,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    await this.repo.saveMessage(msg);
    return msg;
  }

  async persistAssistantMessage(
    sessionId: string,
    messageId: string,
    state: TurnState,
  ): Promise<void> {
    const msg: ChatMessage = {
      id: messageId,
      sessionId,
      role: 'assistant',
      content: state.text,
      thinking: state.thinking || undefined,
      toolCalls: state.toolCalls.length > 0 ? state.toolCalls : undefined,
      createdAt: Date.now(),
    };
    await this.repo.saveMessage(msg);
  }

  async saveToolResult(sessionId: string, toolCallId: string, content: string): Promise<void> {
    const msg: ChatMessage = {
      id: nanoid(),
      sessionId,
      role: 'tool_result',
      content,
      toolCallId,
      createdAt: Date.now(),
    };
    await this.repo.saveMessage(msg);
  }

  private toChatMessages(msg: ChatMessage): LLMMessage[] {
    switch (msg.role) {
      case 'user':
        return [{ role: 'user', content: msg.content }];

      case 'assistant': {
        const m: LLMMessage = { role: 'assistant', content: msg.content };
        if (msg.toolCalls?.length) {
          m.toolCalls = msg.toolCalls;
        }
        return [m];
      }

      case 'tool_result':
        return [
          {
            role: 'tool',
            content: msg.content,
            toolCallId: msg.toolCallId,
          },
        ];

      case 'system':
        return [{ role: 'system', content: msg.content }];

      default:
        return [];
    }
  }
}
