import { Injectable, Inject } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ChatAttachment, ChatMessage, LLMContent, LLMTextPart, ToolMeta } from '@kalio/types';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import type { TurnState } from './turn-state';
import { MESSAGE_REPOSITORY } from './chat.tokens';
import { ImageHydratorService } from './image-hydrator.service';
import { prepareHistoryForLLM, sanitizeToolResultContentForLLM } from './llm-history.utils';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { CredentialsService } from '../credentials/credentials.service';
import { RunJournalService } from './run-journal.service';

/**
 * Manages chat message persistence and history conversion.
 * Uses IMessageRepository — swap implementations for tests vs production.
 */
@Injectable()
export class SessionManagerService {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
    private readonly imageHydrator: ImageHydratorService,
    private readonly credentialsService: CredentialsService,
    private readonly runJournal: RunJournalService,
  ) {}

  private buildTurnLink(
    turnLink?: { turnId?: string; promptMessageId?: string },
    defaultPromptMessageId?: string,
  ): Pick<ChatMessage, 'turnId' | 'promptMessageId'> {
    return {
      turnId: turnLink?.turnId,
      promptMessageId: turnLink?.promptMessageId ?? defaultPromptMessageId,
    };
  }

  /** Upserts the session row so FK constraints are satisfied before message inserts. */
  async ensureSession(sessionId: string, personaId: string): Promise<void> {
    await this.repo.ensureSession(sessionId, personaId);
  }

  async loadHistory(
    sessionId: string,
    options?: { historySessionId?: string; excludeTurnIds?: ReadonlySet<string> },
  ): Promise<ContextManagedLLMMessage[]> {
    const historySessionId = options?.historySessionId;
    const sessionHistories = historySessionId && historySessionId !== sessionId
      ? [
          { sessionId: historySessionId, messages: await this.repo.loadHistory(historySessionId) },
          { sessionId, messages: await this.repo.loadHistory(sessionId) },
        ]
      : [
          { sessionId, messages: await this.repo.loadHistory(sessionId) },
        ];
    const orderedMessages = sessionHistories
      .flatMap((history, sourceIndex) => history.messages.map((message, messageIndex) => ({
        sessionId: history.sessionId,
        sourceIndex,
        messageIndex,
        message,
      })))
      .filter((entry) => !entry.message.turnId || !options?.excludeTurnIds?.has(entry.message.turnId))
      .sort((left, right) => {
        if (left.message.createdAt !== right.message.createdAt) {
          return left.message.createdAt - right.message.createdAt;
        }
        if (left.sourceIndex !== right.sourceIndex) {
          return left.sourceIndex - right.sourceIndex;
        }
        return left.messageIndex - right.messageIndex;
      });
    const out: ContextManagedLLMMessage[] = [];
    for (const entry of orderedMessages) {
      out.push(...await this.toLLMMessages(entry.sessionId, entry.message));
    }
    return out;
  }

  async loadHistoryForLLM(
    sessionId: string,
    options: { systemPrompt: string; toolMetas: ToolMeta[]; historySessionId?: string },
  ): Promise<{ history: ContextManagedLLMMessage[]; unboundedHistoryCount: number; compacted: boolean }> {
    const historySessionIds = options.historySessionId && options.historySessionId !== sessionId
      ? [options.historySessionId, sessionId]
      : [sessionId];
    const excludeTurnIds = await this.runJournal.getNonReplayableTurnIds(historySessionIds);
    const rawHistory = await this.loadHistory(sessionId, {
      historySessionId: options.historySessionId,
      excludeTurnIds,
    });
    const contextWindowSize = await this.credentialsService.getContextWindowSize();
    const prepared = prepareHistoryForLLM(
      rawHistory,
      options.systemPrompt,
      contextWindowSize,
      options.toolMetas,
    );
    const unboundedHistory = options.systemPrompt
      ? [{ role: 'system', content: options.systemPrompt } satisfies ContextManagedLLMMessage, ...rawHistory]
      : [...rawHistory];

    return {
      ...prepared,
      compacted: JSON.stringify(prepared.history) !== JSON.stringify(unboundedHistory),
    };
  }

  async loadPreviewHistoryForLLM(
    sessionId: string,
    options: { systemPrompt: string; toolMetas: ToolMeta[]; historySessionId?: string; draftUserMessage?: string; attachments?: ChatAttachment[] },
  ): Promise<{ history: ContextManagedLLMMessage[]; unboundedHistoryCount: number; compacted: boolean; contextWindowSize: number }> {
    const rawHistory = await this.loadHistory(sessionId, { historySessionId: options.historySessionId });
    const hasDraftText = typeof options.draftUserMessage === 'string' && options.draftUserMessage.length > 0;
    const hasDraftAttachments = Boolean(options.attachments && options.attachments.length > 0);
    const draftHistory = hasDraftText || hasDraftAttachments
      ? await this.toLLMMessages(sessionId, {
          id: 'context-preview-draft',
          sessionId,
          role: 'user',
          content: options.draftUserMessage ?? '',
          ...(options.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
          createdAt: Date.now(),
        })
      : [];
    const markedDraftHistory = draftHistory.map((message) => ({
      ...message,
      contextPreviewSource: 'draft' as const,
    }));
    const contextWindowSize = await this.credentialsService.getContextWindowSize();
    const prepared = prepareHistoryForLLM(
      [...rawHistory, ...markedDraftHistory],
      options.systemPrompt,
      contextWindowSize,
      options.toolMetas,
    );
    const unboundedHistory = options.systemPrompt
      ? [{ role: 'system', content: options.systemPrompt } satisfies ContextManagedLLMMessage, ...rawHistory, ...markedDraftHistory]
      : [...rawHistory, ...markedDraftHistory];

    return {
      ...prepared,
      compacted: JSON.stringify(prepared.history) !== JSON.stringify(unboundedHistory),
      contextWindowSize,
    };
  }

  async persistUserMessage(
    sessionId: string,
    content: string,
    attachments?: ChatAttachment[],
    turnLink?: { turnId?: string; messageId?: string },
  ): Promise<ChatMessage> {
    const messageId = turnLink?.messageId ?? nanoid();
    const msg: ChatMessage = {
      id: messageId,
      sessionId,
      role: 'user',
      content,
      ...this.buildTurnLink(turnLink, messageId),
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
    turnLink?: { turnId?: string; promptMessageId?: string },
  ): Promise<void> {
    const msg: ChatMessage = {
      id: messageId,
      sessionId,
      role: 'assistant',
      content: state.text,
      ...this.buildTurnLink(turnLink, messageId),
      thinking: state.thinking || undefined,
      toolCalls: state.toolCalls.length > 0 ? state.toolCalls : undefined,
      createdAt: Date.now(),
    };
    await this.repo.saveMessage(msg);
  }

  async persistMessage(message: ChatMessage): Promise<void> {
    await this.repo.saveMessage(message);
  }

  async saveToolResult(
    sessionId: string,
    toolCallId: string,
    content: string,
    turnLink?: { turnId?: string; promptMessageId?: string },
  ): Promise<void> {
    const messageId = nanoid();
    const msg: ChatMessage = {
      id: messageId,
      sessionId,
      role: 'tool_result',
      content,
      ...this.buildTurnLink(turnLink, messageId),
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
  private async toLLMMessages(sessionId: string, msg: ChatMessage): Promise<ContextManagedLLMMessage[]> {
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
        const m: ContextManagedLLMMessage = { role: 'assistant', content: msg.content };
        if (msg.toolCalls?.length) {
          m.toolCalls = msg.toolCalls;
        }
        if (typeof msg.thinking === 'string' && msg.thinking.trim().length > 0) {
          m.reasoningContent = msg.thinking;
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
