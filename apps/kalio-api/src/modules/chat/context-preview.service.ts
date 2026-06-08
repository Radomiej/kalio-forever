import { Injectable } from '@nestjs/common';
import type { ContextPreviewMessage, ContextPreviewRequest, LLMContextPreview, LLMContent, ToolMeta } from '@kalio/types';
import { getReasoningContent, type ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { ContextAssemblyService } from './context-assembly.service';
import { SessionManagerService } from './session-manager.service';
import {
  estimateMessageTokens,
  estimateTextTokens,
  estimateToolTokens,
  getSafeContextTarget,
} from './llm-history.utils';

const IMAGE_PART_TOKENS = 85;

@Injectable()
export class ContextPreviewService {
  constructor(
    private readonly contextAssembly: ContextAssemblyService,
    private readonly sessionManager: SessionManagerService,
  ) {}

  async buildPreview(sessionId: string, request: ContextPreviewRequest): Promise<LLMContextPreview> {
    const assembled = await this.contextAssembly.assemble(request.personaId);
    const prepared = await this.sessionManager.loadPreviewHistoryForLLM(sessionId, {
      systemPrompt: assembled.effectiveSystemPrompt,
      toolMetas: assembled.toolMetas,
      draftUserMessage: request.draftUserMessage,
      attachments: request.attachments,
    });
    const messages = this.toPreviewMessages(prepared.history);
    const estimatedTokens = this.estimatePreviewTokens(prepared.history, assembled.toolMetas);

    return {
      sessionId,
      personaId: request.personaId,
      model: assembled.model,
      contextLimit: prepared.contextWindowSize,
      estimatedTokens,
      compaction: {
        applied: prepared.compacted,
        unboundedMessageCount: prepared.unboundedHistoryCount,
        finalMessageCount: prepared.history.length,
        safeTargetTokens: getSafeContextTarget(prepared.contextWindowSize),
      },
      effectiveSystemPrompt: assembled.effectiveSystemPrompt,
      tools: assembled.toolMetas,
      messages,
    };
  }

  private toPreviewMessages(messages: ContextManagedLLMMessage[]): ContextPreviewMessage[] {
    return messages.map((message, index) => ({
      role: message.role,
      content: message.content,
      ...(getReasoningContent(message) ? { reasoningContent: getReasoningContent(message) } : {}),
      ...(message.toolCalls && message.toolCalls.length > 0 ? { toolCalls: message.toolCalls } : {}),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      source: message.role === 'system' && index === 0
        ? 'system_prompt'
        : message.contextPreviewSource === 'draft'
          ? 'draft'
          : 'history',
      estimatedTokens: estimateMessageTokens(message),
    }));
  }

  private estimatePreviewTokens(messages: ContextManagedLLMMessage[], tools: ToolMeta[]): LLMContextPreview['estimatedTokens'] {
    const toolTokens = estimateToolTokens(tools);
    let systemPrompt = 0;
    let messageTokens = 0;
    let reasoning = 0;
    let images = 0;

    for (const message of messages) {
      const estimated = estimateMessageTokens(message);
      messageTokens += estimated;
      reasoning += estimateTextTokens(getReasoningContent(message));
      images += this.countImageTokens(message.content);
      if (message.role === 'system') {
        systemPrompt += estimated;
      }
    }

    const total = toolTokens + messageTokens;
    const history = Math.max(0, total - toolTokens - systemPrompt - reasoning - images);

    return {
      total,
      systemPrompt,
      tools: toolTokens,
      history,
      images,
      reasoning,
    };
  }

  private countImageTokens(content: LLMContent): number {
    if (typeof content === 'string') {
      return 0;
    }
    return content.filter((part) => part.type === 'image_url').length * IMAGE_PART_TOKENS;
  }
}
