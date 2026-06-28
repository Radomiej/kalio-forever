import { Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { EmitFn } from './interfaces/stream-context.interface';
import { SessionManagerService } from './session-manager.service';
import { AuditService } from './audit.service';
import { TurnErrorAlreadyEmitted } from './turn-error';
import { RunJournalService } from './run-journal.service';
import { ContextAssemblyService } from './context-assembly.service';
import { CredentialsService } from '../credentials/credentials.service';
import { LLMTurnRuntimeService } from './llm-turn-runtime.service';
import { AgentBudgetApprovalService } from './agent-budget-approval.service';
import { TurnState } from './turn-state';
import { SessionsService } from './sessions.service';
import { readPendingRAAppLaunchIntent, stripPendingRAAppLaunchRuntimeContext } from './raapp-launch-intent';

type ChatErrorCode = import('@kalio/types').SocketEvents['chat:error']['code'];

function getChatErrorCode(err: unknown): ChatErrorCode {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (
      code === 'LLM_RATE_LIMIT' ||
      code === 'LLM_TIMEOUT' ||
      code === 'LLM_AUTH' ||
      code === 'LLM_PROVIDER_DOWN' ||
      code === 'LLM_QUOTA' ||
      code === 'LLM_BAD_TOOL_ARGS' ||
      code === 'LLM_BAD_STRUCTURED_OUTPUT' ||
      code === 'MAX_ITERATIONS_REACHED'
    ) {
      return code;
    }
  }
  return 'LLM_ERROR';
}

/**
 * Socket-facing chat turn orchestrator. Persists the user draft, emits journal
 * phases, and delegates the provider-ready LLM loop to LLMTurnRuntimeService.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly credentialsService: CredentialsService,
    private readonly audit: AuditService,
    private readonly llmTurnRuntime: LLMTurnRuntimeService,
    private readonly agentBudgetApprovals: AgentBudgetApprovalService,
    private readonly sessions: SessionsService,
    @Optional() private readonly runJournal?: RunJournalService,
    @Optional() private readonly contextAssembly?: ContextAssemblyService,
  ) {}

  async handleTurn(
    sessionId: string,
    content: string,
    personaId: string,
    emit: EmitFn,
    attachments?: import('@kalio/types').ChatAttachment[],
    suppliedTurnId?: string,
    runId?: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);

    const firstMessageId = nanoid();
    const turnId = suppliedTurnId ?? nanoid();
    let hadContent = false;
    const trackingEmit: EmitFn = (event, data) => {
      if (event === 'chat:chunk') hadContent = true;
      emit(event, data);
    };
    const checkpointRun = async (
      phase: import('@kalio/types').ChatRunPhase,
      extra?: Parameters<RunJournalService['checkpoint']>[1],
    ): Promise<void> => {
      if (!runId || !this.runJournal) return;
      await this.runJournal.checkpoint(runId, { phase, ...extra });
    };

    try {
      trackingEmit('agent:start', { sessionId, turnId });
      await checkpointRun('started');

      await this.sessionManager.ensureSession(sessionId, personaId);
      const session = await this.sessions.get(sessionId);
      await this.sessions.registerRuntimeProjectPathForSession(sessionId);
      const runtimeContext = session.runtimeContext ?? {
        runtimeKind: 'chat' as const,
        systemPromptProfile: 'default-chat' as const,
      };
      const pendingRAAppLaunchIntent = readPendingRAAppLaunchIntent(sessionId, personaId, runtimeContext);
      let consumedPendingRAAppLaunchIntent = false;

      if (!this.contextAssembly) {
        throw new Error('ContextAssemblyService is required for chat turns');
      }
      const assembledContext = await this.contextAssembly.assembleForSessionRuntime(personaId, runtimeContext);

      const promptMessage = await this.sessionManager.persistUserMessage(sessionId, content, attachments, { turnId });
      const promptMessageId = promptMessage?.id;

      trackingEmit('chat:context', {
        sessionId,
        systemPrompt: assembledContext.effectiveSystemPrompt,
        toolNames: assembledContext.toolMetas.map((tool) => tool.name),
      });

      const systemMaxToolAttempts = await this.credentialsService.getMaxToolAttempts();
      const maxToolAttempts = assembledContext.personaConfig?.maxToolAttempts ?? systemMaxToolAttempts;
      const maxEmptyNoToolRetries = Math.max(5, maxToolAttempts * 2);

      const loopResult = await this.llmTurnRuntime.runAgentLoop({
        runtimeKind: 'chat',
        sessionId,
        turnId,
        promptMessageId,
        personaId,
        effectiveSystemPrompt: assembledContext.effectiveSystemPrompt,
        toolMetas: assembledContext.toolMetas,
        model: assembledContext.model,
        abortSignal: controller.signal,
        emit: trackingEmit,
        maxIterations: maxToolAttempts,
        maxEmptyNoToolRetries,
        firstMessageId,
        auditDomain: 'chat',
        transformToolCall: pendingRAAppLaunchIntent
          ? (toolCall) => {
              if (consumedPendingRAAppLaunchIntent || toolCall.name !== 'run_raapp') {
                return toolCall;
              }
              consumedPendingRAAppLaunchIntent = true;
              const requestedId = typeof toolCall.args['id'] === 'string' ? toolCall.args['id'].trim() : '';
              if (requestedId && requestedId !== pendingRAAppLaunchIntent.appId) {
                this.logger.warn(
                  `Overriding run_raapp target for session ${sessionId} from "${requestedId}" to "${pendingRAAppLaunchIntent.appId}"`,
                );
              }
              return {
                ...toolCall,
                args: {
                  ...toolCall.args,
                  id: pendingRAAppLaunchIntent.appId,
                },
              };
            }
          : undefined,
        callbacks: {
          onBeforeIteration: async () => {
            await checkpointRun('llm_streaming');
          },
          onToolPending: async () => {
            await checkpointRun('tool_pending');
          },
          onToolRunning: async () => {
            await checkpointRun('tool_running');
          },
          onEscalation: (message) => {
            void this.audit.log({
              sessionId,
              type: 'escalation',
              label: 'Agent Escalation',
              data: { message },
            });
          },
          onIterationLimitReached: async ({ iterationCount, currentLimit }) => {
            await checkpointRun('tool_pending');
            return this.agentBudgetApprovals.requestAdditionalBudget(
              {
                sessionId,
                turnId,
                promptMessageId,
                vfsSessionId: undefined,
                messageId: firstMessageId,
                abortSignal: controller.signal,
                state: new TurnState(),
                emit: trackingEmit,
              },
              {
                currentLimit,
                usedIterations: iterationCount,
                personaId,
                runtimeKind: 'chat',
                requestedBy: 'chat-agent',
              },
            );
          },
        },
      });
      if (consumedPendingRAAppLaunchIntent) {
        await this.sessions.updateRuntimeContext(
          sessionId,
          stripPendingRAAppLaunchRuntimeContext(runtimeContext),
        );
      }

      if (controller.signal.aborted) {
        if (runId) await this.runJournal?.interrupt(runId, 'Turn interrupted by user');
        trackingEmit('chat:error', {
          sessionId,
          code: 'INTERRUPTED',
          message: 'Turn interrupted by user',
          hadContent,
        });
      } else if (loopResult.maxIterationsReached) {
        if (runId) await this.runJournal?.fail(runId, 'MAX_ITERATIONS_REACHED', `Agent loop exceeded ${loopResult.finalLimit} iterations`);
        trackingEmit('chat:error', {
          sessionId,
          code: 'MAX_ITERATIONS_REACHED',
          message: `Agent loop exceeded ${loopResult.finalLimit} iterations`,
          hadContent,
        });
      } else if (loopResult.emptyNoToolRetriesExhausted) {
        if (runId) await this.runJournal?.fail(runId, 'LLM_ERROR', `Agent produced empty output ${maxEmptyNoToolRetries} times in a row`);
        trackingEmit('chat:error', {
          sessionId,
          code: 'LLM_ERROR',
          message: `Agent produced empty output ${maxEmptyNoToolRetries} times in a row`,
          hadContent,
        });
      } else {
        if (runId) await this.runJournal?.complete(runId);
        trackingEmit('chat:complete', { sessionId, messageId: loopResult.lastMessageId });
      }
      trackingEmit('agent:done', { sessionId, turnId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorCode = getChatErrorCode(err);
      this.logger.error(
        `Turn failed session=${sessionId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      if (!(err instanceof TurnErrorAlreadyEmitted)) {
        emit('chat:error', { sessionId, code: errorCode, message, hadContent });
      }
      if (runId) await this.runJournal?.fail(runId, errorCode, message);
      emit('agent:done', { sessionId, turnId });
      void this.audit.log({
        sessionId,
        type: 'error',
        label: firstMessageId,
        data: { message },
      });
    } finally {
      if (this.abortControllers.get(sessionId) === controller) {
        this.abortControllers.delete(sessionId);
      }
    }
  }

  abort(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
  }
}
