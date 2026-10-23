import { Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { EmitFn } from './interfaces/stream-context.interface';
import type { OrdinaryCancellationBatchInput } from '../../database/ordinary-continuation-cancellation';
import { SessionManagerService } from './session-manager.service';
import { AuditService } from './audit.service';
import { TurnErrorAlreadyEmitted } from './turn-error';
import { RunJournalService } from './run-journal.service';
import { ContextAssemblyService } from './context-assembly.service';
import { CredentialsService } from '../credentials/credentials.service';
import { LLMTurnRuntimeService, serializeToolResultContent } from './llm-turn-runtime.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { AgentBudgetApprovalService } from './agent-budget-approval.service';
import { TurnState } from './turn-state';
import { SessionsService } from './sessions.service';
import { RuntimeExecutionScheduler } from '../agent-runtime/runtime-execution.scheduler';
import {
  createRuntimeExecutionLeaseController,
  runtimeExecutionPriority,
  type RuntimeExecutionLeaseController,
} from '../agent-runtime/runtime-execution-lease.controller';
import { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import { NativeApprovalService } from '../agent-runtime/native-approval.service';
import { getChatErrorCode } from './chat-error.utils';
import { createExternalAuditCallback, createNativeApprovalCallback } from './runtime-provider-callbacks';
import { bindExternalRuntime } from './runtime-external-binding';
import {
  readPendingRAAppLaunchInputs,
  readPendingRAAppLaunchIntent,
  stripPendingRAAppLaunchRuntimeContext,
} from './raapp-launch-intent';

import { normalizeClientMessageId, readExecutionCwd, runCheckpoint } from './chat-input.helpers';
import type { SessionContinuationAdmission } from './session-execution-admission';
import { readApprovedContinuation, runApprovedToolContinuation } from './chat-resumed-worker';

/** Socket-facing orchestrator; persists drafts and delegates the journalled LLM loop. */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly abortControllers = new Map<string, AbortController>();
  private continuationAdmission?: SessionContinuationAdmission;

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly credentialsService: CredentialsService,
    private readonly audit: AuditService,
    private readonly llmTurnRuntime: LLMTurnRuntimeService,
    private readonly agentBudgetApprovals: AgentBudgetApprovalService,
    private readonly sessions: SessionsService,
    @Optional() private readonly runJournal?: RunJournalService,
    @Optional() private readonly contextAssembly?: ContextAssemblyService,
    @Optional() private readonly toolDispatch?: ToolDispatchService,
    @Optional() private readonly hitlRequests?: HitlRequestService,
    @Optional() private readonly runtimeScheduler?: RuntimeExecutionScheduler,
    @Optional() private readonly executionProfiles?: ExecutionProfileService,
    @Optional() private readonly nativeApprovals?: NativeApprovalService,
  ) {}

  async approveAndResumeTool(
    requestId: string,
    sessionId: string,
    message: string | undefined,
    emit: EmitFn,
  ): Promise<boolean> {
    const version = this.continuationAdmission?.capture();
    if (this.nativeApprovals && await this.nativeApprovals.resolve(requestId, sessionId, 'accept', message)) {
      return true;
    }
    if (!this.hitlRequests || !this.continuationAdmission) return false;
    const pending = await this.hitlRequests.getById(requestId);
    if (!pending || pending.sessionId !== sessionId || pending.status !== 'pending') return false;
    const continuation = readApprovedContinuation({ ...pending, status: 'approved' });
    if (!continuation) return false;
    return this.resumeContinuation(continuation, emit, version, async () => {
      const approved = await this.hitlRequests!.resolve(pending.id, pending.revision, 'approved', message ? { message } : undefined);
      return approved ? this.hitlRequests!.getById(requestId) : null;
    });
  }

  async cancelPendingTool(requestId: string, sessionId: string, message?: string): Promise<boolean> {
    if (this.nativeApprovals && await this.nativeApprovals.resolve(requestId, sessionId, 'cancel', message)) {
      return true;
    }
    if (!this.hitlRequests) return false;
    const pending = await this.hitlRequests.getById(requestId);
    if (!pending || pending.sessionId !== sessionId || pending.status !== 'pending') return false;
    return this.hitlRequests.resolve(
      pending.id,
      pending.revision,
      'cancelled',
      message ? { message } : undefined,
    );
  }

  async hasPendingToolConfirmation(requestId: string, sessionId: string): Promise<boolean> {
    const request = await this.hitlRequests?.getById(requestId);
    return request?.sessionId === sessionId && request.kind === 'tool_confirmation' && request.status === 'pending';
  }

  setContinuationAdmission(admission: SessionContinuationAdmission): void {
    this.continuationAdmission = admission;
  }

  /** Called after worker cleanup, while the pipeline still fences new admission. */
  async cancelPendingContinuations(sessionId: string): Promise<void> {
    if (!this.hitlRequests) throw new Error('ORDINARY_CANCELLATION_UNAVAILABLE');
    const pending = (await this.hitlRequests.listPending(sessionId)).filter(request => request.kind === 'tool_confirmation');
    const requests: OrdinaryCancellationBatchInput['requests'][number][] = [];
    const runs = new Map<string, OrdinaryCancellationBatchInput['requests'][number]['expectedRun']>();
    for (const request of pending) {
      if (request.runId && request.turnId && !runs.has(request.runId)) {
        const run = await this.runJournal?.getTurn(sessionId, request.turnId);
        if (run && typeof run.revision !== 'number') throw new Error('ORDINARY_CANCELLATION_CONFLICT');
        runs.set(request.runId, run && run.id === request.runId && typeof run.revision === 'number'
          ? { id: run.id, turnId: run.turnId, revision: run.revision } : null);
      }
      const toolName = request.payload?.['toolName'];
      requests.push({ requestId: request.id, expectedRequestRevision: request.revision,
        expectedRun: request.runId ? runs.get(request.runId) ?? null : null,
        serializedToolResult: request.toolCallId && typeof toolName === 'string' ? serializeToolResultContent(toolName, {
          callId: request.toolCallId, toolName, status: 'cancelled', errorMessage: 'Turn interrupted by user',
        }) : null,
      });
    }
    const run = pending.length === 0 ? await this.runJournal?.getCurrentRun(sessionId) : null;
    if (run && typeof run.revision !== 'number') throw new Error('ORDINARY_CANCELLATION_CONFLICT');
    const result = await this.hitlRequests.cancelOrdinaryContinuationsRequired({ sessionId, requests,
      expectedRunWithoutConfirmations: run && typeof run.revision === 'number'
        ? { id: run.id, turnId: run.turnId, revision: run.revision } : null });
    if (result !== 'committed') throw new Error('ORDINARY_CANCELLATION_CONFLICT');
  }

  async resumeApprovedTool(requestId: string, emit: EmitFn, version = this.continuationAdmission?.capture()): Promise<boolean> {
    if (!this.hitlRequests || !this.toolDispatch || !this.contextAssembly || !this.continuationAdmission) return false;
    const continuation = readApprovedContinuation(await this.hitlRequests.getById(requestId));
    if (!continuation) return false;
    return this.resumeContinuation(continuation, emit, version);
  }

  private async resumeContinuation(
    continuation: NonNullable<ReturnType<typeof readApprovedContinuation>>,
    emit: EmitFn,
    version: number | undefined,
    approve?: Parameters<typeof runApprovedToolContinuation>[0]['approve'],
  ): Promise<boolean> {
    if (!this.hitlRequests || !this.toolDispatch || !this.contextAssembly || !this.continuationAdmission
      || (continuation.runtimeKind === 'chat' && (!continuation.approved.runId || !this.runJournal))) return false;
    return this.continuationAdmission.run(continuation.approved.sessionId, continuation.turnId, (controller) =>
      runApprovedToolContinuation({
        ...continuation, controller, emit, approve,
        hitlRequests: this.hitlRequests!, toolDispatch: this.toolDispatch!, contextAssembly: this.contextAssembly!,
        sessionManager: this.sessionManager, sessions: this.sessions, llmTurnRuntime: this.llmTurnRuntime, audit: this.audit,
        runJournal: this.runJournal, runtimeScheduler: this.runtimeScheduler,
        executionProfiles: this.executionProfiles, nativeApprovals: this.nativeApprovals,
      }), version);
  }

  async handleTurn(
    sessionId: string,
    content: string,
    personaId: string,
    emit: EmitFn,
    attachments?: import('@kalio/types').ChatAttachment[],
    suppliedTurnId?: string,
    runId?: string,
    clientMessageId?: string,
    suppliedController?: AbortController,
  ): Promise<void> {
    const controller = suppliedController ?? new AbortController();
    this.abortControllers.set(sessionId, controller);
    let executionLeaseController: RuntimeExecutionLeaseController | undefined;

    const firstMessageId = nanoid();
    const turnId = suppliedTurnId ?? nanoid();
    let hadContent = false;
    const trackingEmit: EmitFn = (event, data) => {
      if (event === 'chat:chunk') hadContent = true;
      emit(event, data);
    };
    const checkpointRun = runCheckpoint(this.runJournal, runId);

    try {
      controller.signal.throwIfAborted();
      await this.sessionManager.ensureSession(sessionId, personaId);
      controller.signal.throwIfAborted();
      const session = await this.sessions.get(sessionId);
      controller.signal.throwIfAborted();
      const executionProfile = this.executionProfiles
        ? await this.executionProfiles.assertEnabled(session.executionProfileId ?? '')
        : undefined;
      await this.sessions.registerRuntimeProjectPathForSession(sessionId);
      controller.signal.throwIfAborted();
      const runtimeContext = session.runtimeContext ?? {
        runtimeKind: 'chat' as const,
        systemPromptProfile: 'default-chat' as const,
      };
      executionLeaseController = createRuntimeExecutionLeaseController(this.runtimeScheduler, {
        projectId: session.projectId ?? 'system:none',
        priority: runtimeExecutionPriority(runtimeContext.runtimeKind),
        label: `chat:${sessionId}:${turnId}`,
      });
      const pendingRAAppLaunchIntent = readPendingRAAppLaunchIntent(sessionId, personaId, runtimeContext);
      const pendingRAAppInputs = readPendingRAAppLaunchInputs(runtimeContext);
      let consumedPendingRAAppLaunchIntent = false;

      if (!this.contextAssembly) {
        throw new Error('ContextAssemblyService is required for chat turns');
      }

      const promptMessage = await this.sessionManager.persistUserMessage(sessionId, content, attachments, {
        turnId,
        messageId: normalizeClientMessageId(clientMessageId),
      });
      await executionLeaseController.acquire();
      controller.signal.throwIfAborted();
      const promptMessageId = promptMessage?.id;
      trackingEmit('agent:start', { sessionId, turnId, promptMessageId });
      await checkpointRun('started', {
        runtimeKind: runtimeContext.runtimeKind,
        ...(executionProfile ? {
          provider: executionProfile.kind,
          model: executionProfile.model || undefined,
          executionProfileId: executionProfile.id,
        } : {}),
        ...(session.externalThreadId ? { externalThreadId: session.externalThreadId } : {}),
      });

      const assembledContext = await this.contextAssembly.assembleForSessionRuntime(personaId, runtimeContext);

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
        runId,
        turnId,
         promptMessageId,
         personaId,
         effectiveSystemPrompt: assembledContext.effectiveSystemPrompt,
          toolMetas: assembledContext.toolMetas,
          model: assembledContext.model,
          providerToolNames: assembledContext.personaConfig?.providerToolNames,
          executionProfile,
         externalThreadId: session.externalThreadId,
          providerCompletesTurn: executionProfile?.kind === 'codex-app-server' || executionProfile?.kind === 'claude-agent-sdk' || executionProfile?.kind === 'devin-api' || executionProfile?.kind === 'devin-cli-acp',
          onExternalRuntimeLost: () => controller.abort(),
          cwd: readExecutionCwd(runtimeContext),
          onExternalThreadBound: async (externalThreadId, binding) => bindExternalRuntime({
            sessions: this.sessions, runJournal: this.runJournal, sessionId, runId, externalThreadId, binding,
          }),
          onNativeApprovalRequested: createNativeApprovalCallback(this.nativeApprovals, {
            sessionId, turnId, runId, emit: trackingEmit, abortSignal: controller.signal, hitlRequests: this.hitlRequests,
          }),
          onExternalAudit: createExternalAuditCallback(this.audit, sessionId),
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
              const args: Record<string, unknown> = {
                ...toolCall.args,
                id: pendingRAAppLaunchIntent.appId,
              };
              if (pendingRAAppInputs) args.inputs = pendingRAAppInputs;
              return {
                ...toolCall,
                args,
              };
            }
          : undefined,
        callbacks: {
          onBeforeIteration: async (iteration, messageId, currentLimit) => {
            await executionLeaseController?.acquire();
            trackingEmit('agent:budget_progress', {
              sessionId,
              turnId,
              messageId,
              usedIterations: iteration,
              currentLimit,
              status: 'running',
              runtimeKind: 'chat',
              personaId,
              updatedAt: Date.now(),
            });
            await checkpointRun('llm_streaming');
          },
          onToolPending: async () => {
            await checkpointRun('tool_pending');
          },
          onWaitingForHuman: async () => {
            await checkpointRun('tool_pending', { status: 'waiting_for_human' });
            executionLeaseController?.release();
          },
          onToolRunning: async () => {
            await executionLeaseController?.acquire();
            await checkpointRun('tool_running', { status: 'active' });
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
            executionLeaseController?.release();
            trackingEmit('agent:budget_progress', {
              sessionId,
              turnId,
              messageId: firstMessageId,
              usedIterations: iterationCount,
              currentLimit,
              status: 'exhausted',
              runtimeKind: 'chat',
              personaId,
              updatedAt: Date.now(),
            });
            await checkpointRun('tool_pending', { status: 'waiting_for_human' });
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
        if (runId) await this.runJournal?.complete(runId, {
          finalText: loopResult.finalText,
          structuredOutput: loopResult.structuredOutput,
          messageId: loopResult.lastMessageId,
        });
        controller.signal.throwIfAborted();
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
      if (controller.signal.aborted) {
        if (runId) await this.runJournal?.interrupt(runId, 'Turn interrupted because the external agent runtime was lost.');
        if (!(err instanceof TurnErrorAlreadyEmitted)) {
          emit('chat:error', {
            sessionId,
            code: 'INTERRUPTED',
            message: 'Turn interrupted because the external agent runtime was lost.',
            hadContent,
          });
        }
      } else if (!(err instanceof TurnErrorAlreadyEmitted)) {
        emit('chat:error', { sessionId, code: errorCode, message, hadContent });
      }
      if (!controller.signal.aborted && runId) await this.runJournal?.fail(runId, errorCode, message);
      emit('agent:done', { sessionId, turnId });
      void this.audit.log({
        sessionId,
        type: 'error',
        label: firstMessageId,
        data: { message },
      });
    } finally {
      executionLeaseController?.release();
      if (this.abortControllers.get(sessionId) === controller) {
        this.abortControllers.delete(sessionId);
      }
    }
  }

  abort(sessionId: string): void {
    this.continuationAdmission?.abort(sessionId);
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
  }
}
