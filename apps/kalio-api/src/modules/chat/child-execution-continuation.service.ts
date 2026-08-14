import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { ChatMessage, ChatRunSnapshot, ToolResult } from '@kalio/types';
import { CredentialsService } from '../credentials/credentials.service';
import { ContextAssemblyService } from './context-assembly.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import { LLMTurnRuntimeService, serializeToolResultContent } from './llm-turn-runtime.service';
import { RunJournalService } from './run-journal.service';
import { SessionManagerService } from './session-manager.service';
import { SessionsService } from './sessions.service';

const discardEmit: EmitFn = () => undefined;

@Injectable()
export class ChildExecutionContinuationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ChildExecutionContinuationService.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly runs: RunJournalService,
    private readonly sessions: SessionsService,
    private readonly messages: SessionManagerService,
    private readonly context: ContextAssemblyService,
    private readonly llm: LLMTurnRuntimeService,
    private readonly credentials: CredentialsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribe = this.runs.subscribeCompleted(async (run) => {
      await this.continueParent(run);
    });
    await this.replayMissedCompletions();
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async continueParent(childRun: ChatRunSnapshot): Promise<boolean> {
    if (!childRun.outcome?.finalText) return false;
    const child = await this.sessions.get(childRun.sessionId);
    if (child.kind !== 'subagent' || !child.parentSessionId || !child.parentTurnId || !child.parentToolCallId) {
      return false;
    }
    const parentRun = await this.runs.getTurn(child.parentSessionId, child.parentTurnId);
    if (parentRun?.status !== 'interrupted_needs_retry' || !parentRun.safeResume || parentRun.revision === undefined) return false;
    const history = await this.sessions.getMessages(child.parentSessionId);
    const prompt = this.parentPrompt(history, child.parentTurnId);
    if (!prompt) return false;
    const ownsToolCall = history.some((message) =>
      message.role === 'assistant'
      && message.turnId === child.parentTurnId
      && message.toolCalls?.some((toolCall) => toolCall.id === child.parentToolCallId));
    if (!ownsToolCall) return false;

    const parent = await this.sessions.get(child.parentSessionId);
    const runtimeContext = parent.runtimeContext ?? {
      runtimeKind: 'subagent' as const,
      systemPromptProfile: 'subagent' as const,
    };
    if (
      runtimeContext.runtimeKind !== 'chat'
      && runtimeContext.runtimeKind !== 'subagent'
      && runtimeContext.runtimeKind !== 'agent-flow-branch'
    ) return false;
    const assembled = await this.context.assembleForSessionRuntime(parent.personaId, runtimeContext);
    const maxIterations = assembled.personaConfig?.maxToolAttempts ?? await this.credentials.getMaxToolAttempts();
    if (!await this.runs.claimChildContinuation(parentRun.id, parentRun.revision)) return false;

    const childResult: ToolResult = {
      callId: child.parentToolCallId,
      status: 'success',
      data: {
        result: childRun.outcome.finalText,
        structuredOutput: childRun.outcome.structuredOutput,
        childSessionId: child.id,
        parentSessionId: child.parentSessionId,
        status: 'completed',
      },
    };
    const hasToolResult = history.some((message) =>
      message.role === 'tool_result' && message.toolCallId === child.parentToolCallId);
    if (!hasToolResult) {
      await this.messages.saveToolResult(
        child.parentSessionId,
        child.parentToolCallId,
        serializeToolResultContent('run_subagent', childResult),
        { turnId: child.parentTurnId, promptMessageId: prompt.id },
      );
    }

    const controller = new AbortController();
    try {
      const result = await this.llm.runAgentLoop({
        runtimeKind: runtimeContext.runtimeKind,
        sessionId: parent.id,
        runId: parentRun.id,
        vfsSessionId: runtimeContext.vfsSessionId,
        turnId: child.parentTurnId,
        promptMessageId: prompt.id,
        personaId: parent.personaId,
        effectiveSystemPrompt: assembled.effectiveSystemPrompt,
        toolMetas: assembled.toolMetas,
        model: assembled.model,
        abortSignal: controller.signal,
        emit: discardEmit,
        maxIterations,
        auditDomain: 'subagent',
      });
      if (result.maxIterationsReached || result.emptyNoToolRetriesExhausted) {
        await this.runs.fail(parentRun.id, 'LLM_ERROR', 'Parent child-execution continuation did not reach a terminal answer');
        return false;
      }
      await this.runs.complete(parentRun.id, {
        finalText: result.finalText,
        structuredOutput: result.structuredOutput,
        messageId: result.lastMessageId,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.runs.fail(parentRun.id, 'LLM_ERROR', message);
      this.logger.error(`Failed to continue parent turn ${parentRun.id}: ${message}`);
      return false;
    }
  }

  private parentPrompt(history: ChatMessage[], turnId: string): ChatMessage | undefined {
    return history.find((message) => message.role === 'user' && message.turnId === turnId);
  }

  private async replayMissedCompletions(): Promise<void> {
    const parents = await this.runs.listSafeRecoverableRuns();
    for (const parentRun of parents) {
      const children = await this.sessions.listChildren(parentRun.sessionId);
      const ownedChildren = children.filter((child) =>
        child.kind === 'subagent'
        && child.parentSessionId === parentRun.sessionId
        && child.parentTurnId === parentRun.turnId
        && Boolean(child.parentToolCallId));
      for (const child of ownedChildren) {
        const completed = await this.runs.getLatestCompletedForSession(child.id);
        if (completed?.outcome?.finalText) {
          await this.continueParent(completed);
        }
      }
    }
  }
}
