import { Injectable, Inject } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ChatAttachment, ChatMessage, LLMContent, LLMMessage, LLMTextPart } from '@kalio/types';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import type { TurnState } from './turn-state';
import { MESSAGE_REPOSITORY } from './chat.tokens';
import { ImageHydratorService } from './image-hydrator.service';
import { sanitizeToolResultContentForLLM } from './llm-history.utils';

/**
 * Manages chat message persistence and history conversion.
 * Uses IMessageRepository — swap implementations for tests vs production.
 */
@Injectable()
export class SessionManagerService {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
    private readonly imageHydrator: ImageHydratorService,
  ) {}

  /** Upserts the session row so FK constraints are satisfied before message inserts. */
  async ensureSession(sessionId: string, personaId: string): Promise<void> {
    await this.repo.ensureSession(sessionId, personaId);
  }

  async loadHistory(sessionId: string): Promise<LLMMessage[]> {
    const messages = await this.repo.loadHistory(sessionId);
    const out: LLMMessage[] = [];
    for (const m of messages) {
      out.push(...await this.toLLMMessages(sessionId, m));
    }
    return out;
  }

  async persistUserMessage(
    sessionId: string,
    content: string,
    attachments?: ChatAttachment[],
  ): Promise<ChatMessage> {
    const msg: ChatMessage = {
      id: nanoid(),
      sessionId,
      role: 'user',
      content,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
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

  /**
   * Convert a persisted ChatMessage into one or more LLMMessages ready for
   * the provider. User messages with attachments are hydrated into a
   * multimodal `content` array (text part + image_url parts) — that's the
   * only async branch.
   */
  private async toLLMMessages(sessionId: string, msg: ChatMessage): Promise<LLMMessage[]> {
    switch (msg.role) {
      case 'user': {
        if (!msg.attachments || msg.attachments.length === 0) {
          return [{ role: 'user', content: msg.content }];
        }
        const imageParts = await this.imageHydrator.hydrate(sessionId, msg.attachments);
        const textPart: LLMTextPart = { type: 'text', text: msg.content };
        const content: LLMContent = [textPart, ...imageParts];
        return [{ role: 'user', content }];
      }

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
            content: sanitizeToolResultContentForLLM(msg.content),
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
