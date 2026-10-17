import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { TurnState } from './turn-state';
import { StreamProcessorService } from './stream-processor.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { SessionManagerService } from './session-manager.service';
import { AuditService } from './audit.service';
import { RuntimeAuditLogger } from './runtime-audit-logger.service';
import { HostDispatchReceiptService } from './host-dispatch-receipt.service';
import { LLM_SOURCE } from './chat.tokens';
import type { ILLMSource } from './interfaces/llm-source.interface';
import type { LLMStructuredOutputRequest, ToolResult, WorkflowErrorCode } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { buildAuditRequestData, buildAuditResponseData } from './llm-turn-audit-data';
import { TurnExecutionLane, hostReceiptIdentity } from './llm-turn-tool-execution';
import { createRuntimeToolDispatcher, detachHostReceiptArgs } from './llm-turn-runtime-dispatch';
export { serializeToolResultContent } from './llm-turn-tool-execution';
import { buildEmptyNoToolRuntimeAuditEvent } from './llm-turn-runtime-audit.events';
import {
  estimateTextTokens,
  type LLMAgentLoopRequest,
  type LLMAgentLoopResult,
  type LLMUsage,
} from './llm-turn-runtime.types';

@Injectable()
export class LLMTurnRuntimeService {
  private readonly logger = new Logger(LLMTurnRuntimeService.name);

  constructor(
    @Inject(LLM_SOURCE) private readonly llmSource: ILLMSource,
    private readonly streamProcessor: StreamProcessorService,
    private readonly sessionManager: SessionManagerService,
    private readonly toolDispatch: ToolDispatchService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly runtimeAudit?: RuntimeAuditLogger,
    @Optional() private readonly hostDispatchReceipts?: HostDispatchReceiptService,
  ) {}

  async runAgentLoop(request: LLMAgentLoopRequest): Promise<LLMAgentLoopResult> {
    if (request.hostRuntimeReceiptObserver && !request.hostDispatchReceiptRecorder && this.hostDispatchReceipts) {
      request = { ...request, hostDispatchReceiptRecorder: this.hostDispatchReceipts.recorder };
    }
    if (request.hostRuntimeReceiptObserver) hostReceiptIdentity(request);
    const maxEmptyNoToolRetries = request.maxEmptyNoToolRetries ?? 0;
    let iteration = request.resumeState?.iteration ?? 0;
    let currentLimit = request.resumeState?.currentLimit ?? request.maxIterations;
    let emptyNoToolRetries = 0;
    let emptyNoToolRetriesExhausted = false;
    let latestText = '';
    let latestStructuredOutput: unknown;
    let hasStructuredOutput = false;
    let lastMessageId = request.firstMessageId ?? nanoid();
    const auditDomain = request.auditDomain ?? (request.runtimeKind === 'chat' ? 'chat' : 'subagent');
    const structuredOutputResult = (): Partial<Pick<LLMAgentLoopResult, 'structuredOutput'>> => (
      hasStructuredOutput ? { structuredOutput: latestStructuredOutput } : {}
    );

    while (iteration < currentLimit) {
      if (request.abortSignal.aborted) {
        return {
          lastMessageId,
          finalText: latestText,
          ...structuredOutputResult(),
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
      await request.callbacks?.onBeforeIteration?.(iteration, messageId, currentLimit);

      const lane = new TurnExecutionLane();
      const turnFailure = new AbortController();
      let state = new TurnState();
      let ctx: StreamContext = {
        sessionId: request.sessionId,
        runId: request.runId,
        turnId: request.turnId,
        promptMessageId: request.promptMessageId,
        vfsSessionId: request.vfsSessionId,
        historySessionId: request.historySessionId,
        runtimeKind: request.runtimeKind,
        iteration,
        currentLimit,
        markWaitingForHuman: () => lane.write(async () => { await request.callbacks?.onWaitingForHuman?.(); }),
        markToolRunning: () => lane.write(async () => { await request.callbacks?.onToolRunning?.(); }),
        messageId,
        abortSignal: request.abortSignal,
        state,
        emit: request.emit,
        agentRun: request.agentRun,
        rawXmlToolNames: request.rawXmlToolNames,
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
      await this.runtimeAudit?.log({
        eventName: 'llm.turn.started',
        sessionId: request.sessionId,
        turnId: request.turnId,
        status: 'started',
        data: {
          runtimeKind: request.runtimeKind,
          iteration,
          limit: currentLimit,
          model: request.executionProfile?.model ?? request.model,
        },
      });
      await this.audit?.log({
        sessionId: request.sessionId,
        type: 'llm_request',
        label: messageId,
        data: buildAuditRequestData(request, auditDomain, iteration, history),
      });

      const auditResponseId = await this.audit?.log({
        sessionId: request.sessionId,
        type: 'llm_response',
        label: messageId,
        data: buildAuditResponseData(request, auditDomain, iteration),
        chunkCount: 0,
      });

      let chunkCount = 0;
      let usage: LLMUsage | undefined;
      let toolResultHandler: ((callId: string, result: ToolResult) => Promise<void> | void) | undefined;
      const toolResultChannel = {
        setHandler: (handler: (callId: string, result: ToolResult) => Promise<void> | void) => {
          toolResultHandler = handler;
        },
      };
      let lastAuditUpdate = performance.now();
      let structuredOutputRepairRetried = false;
      const structuredOutputBeforeAttempt: {
        hasStructuredOutput: boolean;
        latestStructuredOutput: unknown;
      } = { hasStructuredOutput, latestStructuredOutput };
      const dispatchToolCall = createRuntimeToolDispatcher({
        request, lane, context: () => ctx, failureSignal: turnFailure.signal,
        sessionManager: this.sessionManager, toolDispatch: this.toolDispatch,
        audit: this.audit, resultHandler: () => toolResultHandler,
      });

      const streamModel = async (messagesForAttempt: ContextManagedLLMMessage[]): Promise<void> => {
        for await (const chunk of this.llmSource.stream({
          messages: messagesForAttempt,
          tools: request.toolMetas,
           sessionId: request.sessionId,
           messageId,
           model: request.model,
           providerToolNames: request.providerToolNames,
           executionProfile: request.executionProfile,
          runId: request.runId,
          turnId: request.turnId,
          promptMessageId: request.promptMessageId,
          dispatchNativeTool: dispatchToolCall,
          externalThreadId: request.externalThreadId,
           cwd: request.cwd,
           onExternalThreadBound: request.onExternalThreadBound,
           onExternalRuntimeLost: request.onExternalRuntimeLost,
           onNativeApprovalRequested: request.onNativeApprovalRequested,
          onExternalAudit: request.onExternalAudit,
          toolResultChannel,
          abortSignal: request.abortSignal,
          structuredOutput: request.structuredOutput,
        })) {
          if (request.abortSignal.aborted) break;
          if (chunk.type === 'structured_output') {
            latestStructuredOutput = chunk.value;
            hasStructuredOutput = true;
            continue;
          }
          if (chunk.type === 'usage') {
            usage = {
              promptTokens: chunk.promptTokens,
              completionTokens: chunk.completionTokens,
              ...(chunk.totalTokens !== undefined ? { totalTokens: chunk.totalTokens } : {}),
            };
            continue;
          }
          chunkCount++;
          const safeChunk = chunk.type === 'tool_call' && request.hostRuntimeReceiptObserver
            ? { ...chunk, args: detachHostReceiptArgs(chunk.args) } : chunk;
          await lane.write(() => this.streamProcessor.process(safeChunk, ctx));
          if (chunk.type === 'tool_call' && request.providerCompletesTurn) {
            await dispatchToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
          }
          if (auditResponseId && this.audit?.update && performance.now() - lastAuditUpdate >= 500) {
            void this.audit.update(auditResponseId, { chunkCount });
            lastAuditUpdate = performance.now();
          }
        }
      };

      try {
        await streamModel(history);
        await lane.drain();
      } catch (error) {
        if (
          request.structuredOutput
          && !structuredOutputRepairRetried
          && !lane.hasExecutions
          && !request.abortSignal.aborted
          && isStructuredOutputError(error)
        ) {
          structuredOutputRepairRetried = true;
          state = new TurnState();
          ctx = { ...ctx, state };
          chunkCount = 0;
          usage = undefined;
          lastAuditUpdate = performance.now();
          hasStructuredOutput = structuredOutputBeforeAttempt.hasStructuredOutput;
          latestStructuredOutput = structuredOutputBeforeAttempt.latestStructuredOutput;
          this.logger.warn(
            `Structured output failed for session ${request.sessionId} iteration ${iteration}; retrying once with repair instruction`,
          );
          await streamModel([
            ...history,
            this.structuredOutputRepairMessage(request.structuredOutput, error),
          ]);
        } else {
          turnFailure.abort(error);
          let cleanupError: unknown;
          try { await lane.drain(); } catch (failure) { cleanupError = failure; }
          // SubagentRuntimeService owns its durable error fallback; do not create a second assistant row.
          if (auditDomain === 'chat' && (state.text.trim() || state.thinking.trim())) {
            const partial = new TurnState();
            partial.text = state.text;
            partial.thinking = state.thinking;
            partial.toolCalls.push(...state.toolCalls);
            try {
              await this.sessionManager.persistAssistantMessage(request.sessionId, messageId, partial, {
                turnId: request.turnId, promptMessageId: request.promptMessageId,
              });
            } catch (failure) {
              this.logger.error(`Partial history persistence failed session=${request.sessionId} turn=${request.turnId}: ${errorMessage(failure)}`);
              cleanupError ??= failure;
            }
          }
          await this.runtimeAudit?.log({
            eventName: 'llm.turn.failed',
            sessionId: request.sessionId,
            turnId: request.turnId,
            status: 'failed',
            errorCode: workflowErrorCodeFromThrown(error),
            durationMs: Math.round(performance.now() - turnStart),
            data: {
              runtimeKind: request.runtimeKind,
              iteration,
              message: error instanceof Error ? error.message : String(error),
              ...(cleanupError ? { cleanupFailure: errorMessage(cleanupError).slice(0, 240) } : {}),
            },
          });
          throw error;
        }
      }

      if (request.abortSignal.aborted) {
        if (state.text.trim() || state.thinking.trim()) {
          await lane.write(() => this.sessionManager.persistAssistantMessage(request.sessionId, messageId, state, {
            turnId: request.turnId, promptMessageId: request.promptMessageId,
          }));
          if (state.text.trim()) latestText = state.text.trim();
        }
        await this.runtimeAudit?.log({
          eventName: 'llm.turn.cancelled',
          sessionId: request.sessionId,
          turnId: request.turnId,
          status: 'cancelled',
          durationMs: Math.round(performance.now() - turnStart),
          data: { runtimeKind: request.runtimeKind, iteration },
        });
        return {
          lastMessageId,
          finalText: latestText,
          ...structuredOutputResult(),
          iterationCount: iteration,
          finalLimit: currentLimit,
          exhausted: false,
          aborted: true,
          emptyNoToolRetriesExhausted,
          maxIterationsReached: false,
        };
      }

      if (state.text.trim()) {
        latestText = state.text.trim();
      }

      await this.updateAuditResponse(auditResponseId, {
        chunkCount,
        durationMs: Math.round(performance.now() - turnStart),
        data: {
          ...buildAuditResponseData(request, auditDomain, iteration),
          textLength: state.text.length,
          thinkingLength: state.thinking.length,
          toolCallCount: state.toolCalls.length,
          ...(usage !== undefined ? { usage } : {}),
          estimatedOutputTokens: estimateTextTokens(state.text) + estimateTextTokens(state.thinking),
          ...(structuredOutputRepairRetried ? { structuredOutputRepairRetry: true } : {}),
        },
      });
      await this.runtimeAudit?.log({
        eventName: 'llm.turn.completed',
        sessionId: request.sessionId,
        turnId: request.turnId,
        status: 'completed',
        durationMs: Math.round(performance.now() - turnStart),
        data: {
          runtimeKind: request.runtimeKind,
          iteration,
          textLength: state.text.length,
          thinkingLength: state.thinking.length,
          toolCallCount: state.toolCalls.length,
          ...(usage ? { usage } : {}),
          ...(structuredOutputRepairRetried ? { structuredOutputRepairRetry: true } : {}),
        },
      });

      if (!request.abortSignal.aborted && state.toolCalls.length > 0) {
        emptyNoToolRetries = 0;
        for (const toolCall of state.toolCalls) {
          if (request.abortSignal.aborted) break;
          await dispatchToolCall(toolCall);
        }
      }

      if (state.toolCalls.length === 0 || request.providerCompletesTurn) {
        const hasAssistantOutput = state.text.trim().length > 0 || state.thinking.trim().length > 0 || hasStructuredOutput;
        if (!hasAssistantOutput && maxEmptyNoToolRetries > 0) {
          emptyNoToolRetries++;
          if (emptyNoToolRetries <= maxEmptyNoToolRetries) {
            await this.runtimeAudit?.log(buildEmptyNoToolRuntimeAuditEvent({
              eventName: 'llm.turn.empty_no_tool_retry',
              request,
              iteration,
              retryCount: emptyNoToolRetries,
              retryLimit: maxEmptyNoToolRetries,
              state,
            }));
            this.logger.warn(
              `Agent produced empty no-tool iteration for session ${request.sessionId} at iteration ${iteration}; retry ${emptyNoToolRetries}/${maxEmptyNoToolRetries}`,
            );
            iteration--;
            continue;
          }
          await this.runtimeAudit?.log(buildEmptyNoToolRuntimeAuditEvent({
            eventName: 'llm.turn.empty_no_tool_exhausted',
            request,
            iteration,
            retryCount: emptyNoToolRetries,
            retryLimit: maxEmptyNoToolRetries,
            state,
          }));
          emptyNoToolRetriesExhausted = true;
          break;
        }
        return {
          lastMessageId,
          finalText: latestText,
          ...structuredOutputResult(),
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
      return this.runAgentLoop({
        ...request,
        maxIterations: currentLimit,
        resumeState: { iteration, currentLimit },
      });
    }
    if (request.runtimeKind !== 'chat') {
      this.logger.warn(`Subagent exceeded ${currentLimit} iterations session=${request.sessionId}`);
    } else {
      this.logger.warn(`Agent loop exceeded ${currentLimit} iterations for session ${request.sessionId}`);
    }

    return {
      lastMessageId,
      finalText: latestText,
      ...structuredOutputResult(),
      iterationCount: iteration,
      finalLimit: currentLimit,
      exhausted: true,
      aborted: request.abortSignal.aborted,
      emptyNoToolRetriesExhausted,
      maxIterationsReached: true,
    };
  }

  private async updateAuditResponse(
    auditResponseId: string | undefined,
    patch: Parameters<AuditService['update']>[1],
  ): Promise<void> {
    if (!auditResponseId || !this.audit?.update) return;
    await this.audit.update(auditResponseId, patch);
  }

  private structuredOutputRepairMessage(
    structuredOutput: LLMStructuredOutputRequest,
    error: unknown,
  ): ContextManagedLLMMessage {
    return {
      role: 'user',
      content: [
        'Return only valid JSON for the requested structured output schema.',
        'Do not include prose, markdown fences, explanations, or a wrapper object.',
        `Schema name: ${structuredOutput.name}`,
        `Schema: ${JSON.stringify(structuredOutput.schema)}`,
        `Rejected previous output: ${errorMessage(error)}`,
      ].join('\n'),
    };
  }
}

function isStructuredOutputError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'LLM_BAD_STRUCTURED_OUTPUT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workflowErrorCodeFromThrown(error: unknown): WorkflowErrorCode {
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : undefined;
  switch (code) {
    case 'LLM_AUTH':
      return 'PROVIDER_UNAUTHORIZED';
    case 'LLM_RATE_LIMIT':
      return 'RATE_LIMITED';
    case 'LLM_TIMEOUT':
      return 'TIMEOUT';
    case 'LLM_PROVIDER_DOWN':
      return 'PROVIDER_UNAVAILABLE';
    case 'LLM_BAD_STRUCTURED_OUTPUT':
      return 'CONTRACT_VIOLATION';
    default:
      return 'UNKNOWN';
  }
}
