import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { TurnState } from './turn-state';
import { StreamProcessorService } from './stream-processor.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { SessionManagerService } from './session-manager.service';
import { AuditService } from './audit.service';
import { LLM_SOURCE } from './chat.tokens';
import type { ILLMSource } from './interfaces/llm-source.interface';
import type { SocketEvents, ToolResult } from '@kalio/types';
import type { EmitFn, StreamContext } from './interfaces/stream-context.interface';
import { toAuditToolCallData, toAuditToolResultData } from './audit-tool-data';
import {
  estimateContentTokens,
  estimateTextTokens,
  type LLMAgentLoopRequest,
  type LLMAgentLoopResult,
  type LLMUsage,
} from './llm-turn-runtime.types';

const CLI_CHILD_TOOL_NAMES = new Set([
  'run_cli_agent',
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'stop_cli_agent',
]);

@Injectable()
export class LLMTurnRuntimeService {
  private readonly logger = new Logger(LLMTurnRuntimeService.name);

  constructor(
    @Inject(LLM_SOURCE) private readonly llmSource: ILLMSource,
    private readonly streamProcessor: StreamProcessorService,
    private readonly sessionManager: SessionManagerService,
    private readonly toolDispatch: ToolDispatchService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async runAgentLoop(request: LLMAgentLoopRequest): Promise<LLMAgentLoopResult> {
    const maxEmptyNoToolRetries = request.maxEmptyNoToolRetries ?? 0;
    let iteration = 0;
    let currentLimit = request.maxIterations;
    let emptyNoToolRetries = 0;
    let emptyNoToolRetriesExhausted = false;
    let latestText = '';
    let lastMessageId = request.firstMessageId ?? nanoid();
    const auditDomain = request.auditDomain ?? (request.runtimeKind === 'chat' ? 'chat' : 'subagent');

    while (iteration < currentLimit) {
      if (request.abortSignal.aborted) {
        return {
          lastMessageId,
          finalText: latestText,
          iterationCount: iteration,
          finalLimit: currentLimit,
          exhausted: false,
          aborted: true,
          emptyNoToolRetriesExhausted,
          maxIterationsReached: false,
        };
      }

      iteration++;
      const messageId = iteration === 1
        ? (request.firstMessageId ?? (request.messageIdPrefix ? `${request.messageIdPrefix}` : nanoid()))
        : nanoid();
      lastMessageId = messageId;
      await request.callbacks?.onBeforeIteration?.(iteration, messageId);

      const state = new TurnState();
      const ctx: StreamContext = {
        sessionId: request.sessionId,
        turnId: request.turnId,
        promptMessageId: request.promptMessageId,
        vfsSessionId: request.vfsSessionId,
        messageId,
        abortSignal: request.abortSignal,
        state,
        emit: request.emit,
        agentRun: request.agentRun,
        rawXmlToolNames: request.rawXmlToolNames ?? request.toolMetas.map((tool) => tool.name),
      };

      const { history, unboundedHistoryCount } = await this.sessionManager.loadHistoryForLLM(request.sessionId, {
        systemPrompt: request.effectiveSystemPrompt,
        toolMetas: request.toolMetas,
        ...(request.historySessionId ? { historySessionId: request.historySessionId } : {}),
      });

      if (history.length !== unboundedHistoryCount) {
        this.logger.warn(
          `Compacted LLM history for session ${request.sessionId} iteration ${iteration} from ${unboundedHistoryCount} to ${history.length} messages`,
        );
      }

      const turnStart = performance.now();
      await this.audit?.log({
        sessionId: request.sessionId,
        type: 'llm_request',
        label: messageId,
        data: this.buildAuditRequestData(request, auditDomain, iteration, history),
      });

      const auditResponseId = await this.audit?.log({
        sessionId: request.sessionId,
        type: 'llm_response',
        label: messageId,
        data: this.buildAuditResponseData(request, auditDomain, iteration),
        chunkCount: 0,
      });

      let chunkCount = 0;
      let usage: LLMUsage | undefined;
      let lastAuditUpdate = performance.now();

      for await (const chunk of this.llmSource.stream({
        messages: history,
        tools: request.toolMetas,
        sessionId: request.sessionId,
        messageId,
        model: request.model,
        abortSignal: request.abortSignal,
      })) {
        if (request.abortSignal.aborted) break;
        if (chunk.type === 'usage') {
          usage = {
            promptTokens: chunk.promptTokens,
            completionTokens: chunk.completionTokens,
            totalTokens: chunk.totalTokens,
          };
          continue;
        }
        chunkCount++;
        await this.streamProcessor.process(chunk, ctx);
        if (auditResponseId && this.audit?.update && performance.now() - lastAuditUpdate >= 500) {
          void this.audit.update(auditResponseId, { chunkCount });
          lastAuditUpdate = performance.now();
        }
      }

      if (state.text.trim()) {
        latestText = state.text.trim();
      }

      await this.updateAuditResponse(auditResponseId, {
        chunkCount,
        durationMs: Math.round(performance.now() - turnStart),
        data: {
          ...this.buildAuditResponseData(request, auditDomain, iteration),
          textLength: state.text.length,
          thinkingLength: state.thinking.length,
          toolCallCount: state.toolCalls.length,
          usage,
          estimatedOutputTokens: estimateTextTokens(state.text) + estimateTextTokens(state.thinking),
        },
      });

      if (!request.abortSignal.aborted && state.toolCalls.length > 0) {
        emptyNoToolRetries = 0;
        for (const toolCall of state.toolCalls) {
          if (request.abortSignal.aborted) break;
          await request.callbacks?.onToolPending?.();
          request.emit('tool:start', this.toolStartPayload(request, toolCall) as SocketEvents['tool:start']);
          await request.callbacks?.onToolRunning?.();
          await this.audit?.log({
            sessionId: request.sessionId,
            type: 'tool_call',
            label: toolCall.name,
            data: this.buildToolCallAuditData(request, toolCall),
          });
          const toolStartedAt = performance.now();
          const result = await this.toolDispatch.dispatch(
            toolCall.id,
            toolCall.name,
            toolCall.args,
            ctx,
            request.toolMetas,
          );
          request.emit('tool:result', result);
          await this.audit?.log({
            sessionId: request.sessionId,
            type: 'tool_result',
            label: toolCall.name,
            data: this.buildToolResultAuditData(request, toolCall, result),
            durationMs: Math.round(performance.now() - toolStartedAt),
          });
          if (toolCall.name === 'escalate' && result.status === 'success') {
            const message = (result.data as Record<string, unknown>)?.['message'];
            if (typeof message === 'string') {
              request.callbacks?.onEscalation?.(message);
            }
          }
          const content = serializeToolResultContent(toolCall.name, result);
          await this.sessionManager.saveToolResult(request.sessionId, toolCall.id, content, {
            turnId: request.turnId,
            promptMessageId: request.promptMessageId,
          });
        }
      }

      if (state.toolCalls.length === 0) {
        const hasAssistantOutput = state.text.trim().length > 0 || state.thinking.trim().length > 0;
        if (!hasAssistantOutput && maxEmptyNoToolRetries > 0) {
          emptyNoToolRetries++;
          if (emptyNoToolRetries <= maxEmptyNoToolRetries) {
            this.logger.warn(
              `Agent produced empty no-tool iteration for session ${request.sessionId} at iteration ${iteration}; retry ${emptyNoToolRetries}/${maxEmptyNoToolRetries}`,
            );
            iteration--;
            continue;
          }
          emptyNoToolRetriesExhausted = true;
          break;
        }
        return {
          lastMessageId,
          finalText: latestText,
          iterationCount: iteration,
          finalLimit: currentLimit,
          exhausted: false,
          aborted: request.abortSignal.aborted,
          emptyNoToolRetriesExhausted,
          maxIterationsReached: false,
        };
      }
    }

    const approvedLimit = await request.callbacks?.onIterationLimitReached?.({
      iterationCount: iteration,
      currentLimit,
    });
    if (approvedLimit && approvedLimit > currentLimit) {
      currentLimit = approvedLimit;
      return this.runAgentLoop({ ...request, maxIterations: currentLimit });
    }
    if (request.runtimeKind !== 'chat') {
      this.logger.warn(`Subagent exceeded ${currentLimit} iterations session=${request.sessionId}`);
    } else {
      this.logger.warn(`Agent loop exceeded ${currentLimit} iterations for session ${request.sessionId}`);
    }

    return {
      lastMessageId,
      finalText: latestText,
      iterationCount: iteration,
      finalLimit: currentLimit,
      exhausted: true,
      aborted: request.abortSignal.aborted,
      emptyNoToolRetriesExhausted,
      maxIterationsReached: true,
    };
  }

  private buildAuditRequestData(
    request: LLMAgentLoopRequest,
    auditDomain: 'chat' | 'subagent',
    iteration: number,
    history: Array<{ content: import('@kalio/types').LLMContent }>,
  ): Record<string, unknown> {
    if (auditDomain === 'subagent' && request.agentRun) {
      return {
        domain: 'subagent',
        kind: 'subagent_llm_request',
        childAgentRunId: request.agentRun.agentRunId,
        parentSessionId: request.agentRun.parentSessionId,
        parentToolCallId: request.agentRun.parentToolCallId,
        iteration,
        estimatedInputTokens: history.reduce((total, item) => total + estimateContentTokens(item.content), 0),
        messageCount: history.length,
        toolCount: request.toolMetas.length,
        ...(request.auditMetadata ?? {}),
      };
    }
    return {
      estimatedInputTokens: history.reduce((total, item) => total + estimateContentTokens(item.content), 0),
      personaId: request.personaId,
      iteration,
      messageCount: history.length,
      toolCount: request.toolMetas.length,
      ...(request.auditMetadata ?? {}),
    };
  }

  private buildAuditResponseData(
    request: LLMAgentLoopRequest,
    auditDomain: 'chat' | 'subagent',
    iteration: number,
  ): Record<string, unknown> {
    if (auditDomain === 'subagent' && request.agentRun) {
      return {
        domain: 'subagent',
        kind: 'subagent_llm_response',
        childAgentRunId: request.agentRun.agentRunId,
        parentSessionId: request.agentRun.parentSessionId,
        parentToolCallId: request.agentRun.parentToolCallId,
        iteration,
        textLength: 0,
        thinkingLength: 0,
        toolCallCount: 0,
        ...(request.auditMetadata ?? {}),
      };
    }
    return {
      iteration,
      textLength: 0,
      thinkingLength: 0,
      toolCallCount: 0,
      ...(request.auditMetadata ?? {}),
    };
  }

  private buildToolCallAuditData(
    request: LLMAgentLoopRequest,
    toolCall: { id: string; name: string; args: Record<string, unknown> },
  ): Record<string, unknown> {
    const auditArgs = { ...toolCall.args, ...(request.auditMetadata ?? {}) };
    const base = toAuditToolCallData(toolCall.id, toolCall.name, auditArgs);
    if (!request.agentRun) return base;
    return {
      ...base,
      childAgentRunId: request.agentRun.agentRunId,
      parentSessionId: request.agentRun.parentSessionId,
      parentToolCallId: request.agentRun.parentToolCallId,
    };
  }

  private buildToolResultAuditData(
    request: LLMAgentLoopRequest,
    toolCall: { id: string; name: string; args: Record<string, unknown> },
    result: import('@kalio/types').ToolResult,
  ): Record<string, unknown> {
    const auditArgs = { ...toolCall.args, ...(request.auditMetadata ?? {}) };
    const base = toAuditToolResultData(toolCall.id, toolCall.name, result, auditArgs);
    if (!request.agentRun) return base;
    return {
      ...base,
      childAgentRunId: request.agentRun.agentRunId,
      parentSessionId: request.agentRun.parentSessionId,
      parentToolCallId: request.agentRun.parentToolCallId,
    };
  }

  private toolStartPayload(
    request: LLMAgentLoopRequest,
    toolCall: { id: string; name: string; args: Record<string, unknown> },
  ): SocketEvents['tool:start'] {
    if (request.agentRun) {
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.args,
        sessionId: request.sessionId,
        agentRun: request.agentRun,
      };
    }
    return {
      callId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.args,
    };
  }

  private async updateAuditResponse(
    auditResponseId: string | undefined,
    patch: Parameters<AuditService['update']>[1],
  ): Promise<void> {
    if (!auditResponseId || !this.audit?.update) return;
    await this.audit.update(auditResponseId, patch);
  }
}

function serializeToolResultContent(toolName: string, result: ToolResult): string {
  const fallbackErrorMessage = result.errorMessage ?? (
    result.status === 'cancelled' ? `Tool ${toolName} was cancelled or not approved.` : ''
  );

  if (
    CLI_CHILD_TOOL_NAMES.has(toolName)
    && result.data
    && typeof result.data === 'object'
    && !Array.isArray(result.data)
  ) {
    return JSON.stringify({
      ...(result.data as Record<string, unknown>),
      toolResultStatus: result.status,
      ...(result.errorCode ? { toolResultErrorCode: result.errorCode } : {}),
      ...(fallbackErrorMessage ? { toolResultErrorMessage: fallbackErrorMessage } : {}),
    });
  }

  return result.status === 'success'
    ? JSON.stringify(result.data ?? '')
    : JSON.stringify({
        status: result.status,
        errorCode: result.errorCode,
        errorMessage: fallbackErrorMessage,
      });
}
