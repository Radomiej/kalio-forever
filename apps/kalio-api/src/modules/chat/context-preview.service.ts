import { Injectable } from '@nestjs/common';
import type {
  ContextPreviewRequest,
  LLMContextPreview,
  LLMContent,
  RuntimeProfileSource,
  SessionRuntimeContext,
  ToolMeta,
} from '@kalio/types';
import { getReasoningContent, type ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { ContextAssemblyService, type RuntimeAssemblyProfile } from './context-assembly.service';
import { SessionManagerService } from './session-manager.service';
import { SessionsService } from './sessions.service';
import type { ToolPolicyRequest } from './tool-policy.service';
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
    private readonly sessions: SessionsService,
  ) {}

  async buildPreview(sessionId: string, request: ContextPreviewRequest): Promise<LLMContextPreview> {
    const session = await this.sessions.get(sessionId);
    const personaId = request.personaId || session.personaId;
    const { runtimeContext, profileSource } = this.resolveRuntimeContext(session.runtimeContext, request);
    const assembled = await this.assembleForRuntimeContext(personaId, runtimeContext);
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
      personaId,
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
      runtimeKind: assembled.runtimeKind,
      runtimeProfileSource: profileSource,
      warnings: assembled.warnings.length > 0 ? assembled.warnings : undefined,
      toolPolicy: assembled.toolPolicy,
    };
  }

  private resolveRuntimeContext(
    sessionContext: SessionRuntimeContext | undefined,
    request: ContextPreviewRequest,
  ): { runtimeContext: SessionRuntimeContext; profileSource: RuntimeProfileSource } {
    if (request.target === 'runtime') {
      return { runtimeContext: request.runtimeContext, profileSource: 'request' };
    }
    if (sessionContext) {
      return { runtimeContext: sessionContext, profileSource: 'session' };
    }
    return {
      runtimeContext: { runtimeKind: 'chat', systemPromptProfile: 'default-chat' },
      profileSource: 'persona-default',
    };
  }

  private async assembleForRuntimeContext(personaId: string, runtimeContext: SessionRuntimeContext) {
    if (
      runtimeContext.runtimeKind === 'chat'
      || runtimeContext.runtimeKind === 'agent-flow-root'
      || runtimeContext.runtimeKind === 'cli-agent'
    ) {
      const profile: RuntimeAssemblyProfile = {
        runtimeKind: 'chat',
        personaId,
        toolPolicyRequest: {
          runtimeKind: runtimeContext.runtimeKind === 'chat' ? 'chat' : runtimeContext.runtimeKind,
          personaId,
          sessionRuntimeContext: runtimeContext,
          architectureContext: runtimeContext.architectureContext,
        },
      };
      return this.contextAssembly.assembleForRuntime(profile);
    }

    const toolPolicyRequest: ToolPolicyRequest = {
      runtimeKind: runtimeContext.runtimeKind,
      personaId,
      sessionRuntimeContext: runtimeContext,
      explicitToolNames: runtimeContext.explicitToolNames,
      architectureContext: runtimeContext.architectureContext,
    };

    if (runtimeContext.runtimeKind === 'agent-flow-branch') {
      toolPolicyRequest.slotPolicy = runtimeContext.architectureSlotPolicy;
    }

    if (runtimeContext.runtimeKind === 'agent-flow-branch') {
      return this.contextAssembly.assembleForRuntime({
        runtimeKind: 'agent-flow-branch',
        personaId,
        toolPolicyRequest,
        modelOverride: runtimeContext.modelOverride,
      });
    }

    return this.contextAssembly.assembleForRuntime({
      runtimeKind: 'subagent',
      personaId,
      toolPolicyRequest,
    });
  }

  private toPreviewMessages(messages: ContextManagedLLMMessage[]): LLMContextPreview['messages'] {
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
